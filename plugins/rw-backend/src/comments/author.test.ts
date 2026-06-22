import { mockCredentials, mockServices } from "@backstage/backend-test-utils";
import { catalogServiceMock } from "@backstage/plugin-catalog-node/testUtils";
import { resolveAuthor } from "./author";

const credentials = mockCredentials.user("user:default/alice");

describe("resolveAuthor", () => {
  const userInfo = mockServices.userInfo.mock({
    getUserInfo: async () => ({ userEntityRef: "user:default/alice", ownershipEntityRefs: [] }),
  });
  const auth = mockServices.auth();

  it("returns authorRef + profile from the catalog entity", async () => {
    const catalog = catalogServiceMock({
      entities: [
        {
          apiVersion: "backstage.io/v1alpha1",
          kind: "User",
          metadata: { name: "alice", namespace: "default" },
          spec: { profile: { displayName: "Alice", picture: "http://a/x.png" } },
        },
      ],
    });
    const out = await resolveAuthor({ userInfo, auth, catalog, credentials });
    expect(out.authorRef).toBe("user:default/alice");
    expect(out.authorProfile).toEqual({ displayName: "Alice", picture: "http://a/x.png" });
  });

  it("returns authorRef + profile with picture only when displayName is absent", async () => {
    const catalog = catalogServiceMock({
      entities: [
        {
          apiVersion: "backstage.io/v1alpha1",
          kind: "User",
          metadata: { name: "alice", namespace: "default" },
          spec: { profile: { picture: "http://a/x.png" } },
        },
      ],
    });
    const out = await resolveAuthor({ userInfo, auth, catalog, credentials });
    expect(out.authorRef).toBe("user:default/alice");
    expect(out.authorProfile).toEqual({ picture: "http://a/x.png" });
  });

  it("returns authorRef with no profile when the catalog entity is absent", async () => {
    const catalog = catalogServiceMock({ entities: [] });
    const out = await resolveAuthor({ userInfo, auth, catalog, credentials });
    expect(out.authorRef).toBe("user:default/alice");
    expect(out.authorProfile).toBeUndefined();
  });

  it("returns authorRef with no profile when catalog.getEntityByRef throws", async () => {
    const catalog = {
      ...catalogServiceMock({ entities: [] }),
      getEntityByRef: jest.fn().mockRejectedValue(new Error("catalog unavailable")),
    } as any;
    const out = await resolveAuthor({ userInfo, auth, catalog, credentials });
    expect(out.authorRef).toBe("user:default/alice");
    expect(out.authorProfile).toBeUndefined();
  });
});
