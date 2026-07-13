import { mockCredentials, mockServices } from "@backstage/backend-test-utils";
import { catalogEntityReadPermission } from "@backstage/plugin-catalog-common/alpha";
import { AuthorizeResult } from "@backstage/plugin-permission-common";
import { SiteAuthorizer } from "./authorizeSite";

const SITE = "default/component/arch";
const OTHER_SITE = "default/component/billing";

const alice = mockCredentials.user("user:default/alice");
const bob = mockCredentials.user("user:default/bob");

// The authorizer only forwards the request to httpAuth, which is mocked here.
const req = {} as Parameters<SiteAuthorizer["assertReadable"]>[0];

function makeAuthorizer(
  options: {
    decisions?: unknown;
    credentials?: typeof alice;
    now?: () => number;
  } = {},
) {
  const authorize = jest
    .fn()
    .mockResolvedValue(options.decisions ?? [{ result: AuthorizeResult.ALLOW }]);
  const fail = jest.fn();
  const createEvent = jest.fn().mockResolvedValue({ fail, success: jest.fn() });
  const credentials = jest.fn().mockResolvedValue(options.credentials ?? alice);

  const authorizer = new SiteAuthorizer({
    permissions: { authorize, authorizeConditional: jest.fn() } as never,
    httpAuth: mockServices.httpAuth.mock({ credentials }),
    auditor: { createEvent } as never,
    now: options.now,
  });
  return { authorizer, authorize, createEvent, fail, credentials };
}

describe("SiteAuthorizer", () => {
  it("authorizes catalog entity read against the site entity the path names, as the caller", async () => {
    const { authorizer, authorize } = makeAuthorizer();

    await authorizer.assertReadable(req, SITE);

    expect(authorize).toHaveBeenCalledWith(
      [{ permission: catalogEntityReadPermission, resourceRef: "component:default/arch" }],
      // The caller's own credentials, not the plugin's service identity — a service principal is
      // always ALLOWed, so authorizing as one would make the gate a no-op.
      { credentials: alice },
    );
  });

  it.each([
    ["DENY", [{ result: AuthorizeResult.DENY }]],
    ["CONDITIONAL", [{ result: AuthorizeResult.CONDITIONAL }]],
    ["no decision at all", []],
  ])("refuses on %s — only an outright ALLOW may serve docs", async (_name, decisions) => {
    const { authorizer } = makeAuthorizer({ decisions });

    await expect(authorizer.assertReadable(req, SITE)).rejects.toThrow(
      "No documentation site found for entity: default/component/arch",
    );
  });

  it("propagates a permission-backend failure rather than failing open", async () => {
    const { authorizer, authorize } = makeAuthorizer();
    authorize.mockRejectedValue(new Error("permission backend down"));

    await expect(authorizer.assertReadable(req, SITE)).rejects.toThrow("permission backend down");
  });

  describe("auditing", () => {
    it("audits a denial, so an operator can tell a refusal from a missing site", async () => {
      const { authorizer, createEvent, fail } = makeAuthorizer({
        decisions: [{ result: AuthorizeResult.DENY }],
      });

      await expect(authorizer.assertReadable(req, SITE)).rejects.toThrow();

      expect(createEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: "site-read", meta: { siteEntityPath: SITE } }),
      );
      expect(fail).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ name: "NotFoundError" }) }),
      );
    });

    it("does not audit an allowed read", async () => {
      const { authorizer, createEvent } = makeAuthorizer();

      await authorizer.assertReadable(req, SITE);

      expect(createEvent).not.toHaveBeenCalled();
    });

    it("audits a denial once per cache window, so a retrying client cannot flood the audit log", async () => {
      const { authorizer, createEvent } = makeAuthorizer({
        decisions: [{ result: AuthorizeResult.DENY }],
        now: () => 1000,
      });

      await expect(authorizer.assertReadable(req, SITE)).rejects.toThrow();
      await expect(authorizer.assertReadable(req, SITE)).rejects.toThrow();

      expect(createEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe("decision caching", () => {
    it("reuses a decision for the same caller and site instead of re-authorizing", async () => {
      const { authorizer, authorize } = makeAuthorizer({ now: () => 1000 });

      await authorizer.assertReadable(req, SITE);
      await authorizer.assertReadable(req, SITE);
      await authorizer.assertReadable(req, SITE);

      expect(authorize).toHaveBeenCalledTimes(1);
    });

    it("re-authorizes once the decision expires, so a revoked permission takes effect", async () => {
      let clock = 1000;
      const { authorizer, authorize } = makeAuthorizer({ now: () => clock });

      await authorizer.assertReadable(req, SITE);
      clock += 5_001;
      await authorizer.assertReadable(req, SITE);

      expect(authorize).toHaveBeenCalledTimes(2);
    });

    it("does not reuse one caller's decision for another", async () => {
      const { authorizer, authorize, credentials } = makeAuthorizer({ now: () => 1000 });

      await authorizer.assertReadable(req, SITE);
      credentials.mockResolvedValue(bob);
      await authorizer.assertReadable(req, SITE);

      expect(authorize).toHaveBeenCalledTimes(2);
    });

    it("does not reuse a decision across sites", async () => {
      const { authorizer, authorize } = makeAuthorizer({ now: () => 1000 });

      await authorizer.assertReadable(req, SITE);
      await authorizer.assertReadable(req, OTHER_SITE);

      expect(authorize).toHaveBeenCalledTimes(2);
    });

    it("caches a denial as well as an allow", async () => {
      const { authorizer, authorize } = makeAuthorizer({
        decisions: [{ result: AuthorizeResult.DENY }],
        now: () => 1000,
      });

      await expect(authorizer.assertReadable(req, SITE)).rejects.toThrow();
      await expect(authorizer.assertReadable(req, SITE)).rejects.toThrow();

      expect(authorize).toHaveBeenCalledTimes(1);
    });
  });
});
