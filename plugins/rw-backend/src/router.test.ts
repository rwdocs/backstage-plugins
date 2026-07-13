import * as http from "http";
import { mockServices } from "@backstage/backend-test-utils";
import { NotFoundError } from "@backstage/errors";
import express from "express";
import request from "supertest";
import { createRouter } from "./router";
import { Hub } from "./hub";
import { createSite } from "@rwdocs/core";

jest.mock("@rwdocs/core");

const mockCreateSite = createSite as jest.MockedFunction<typeof createSite>;

const authorizer = { assertReadable: jest.fn() };

async function makeServer(hub: Hub): Promise<http.Server> {
  const router = await createRouter({
    logger: mockServices.logger.mock(),
    httpAuth: mockServices.httpAuth.mock(),
    hub,
    authorizer: authorizer as any,
  });
  const app = express().use(router);
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const statusByName: Record<string, number> = {
      InputError: 400,
      NotFoundError: 404,
      ServiceUnavailableError: 503,
    };
    const status = statusByName[err.name] ?? 500;
    res.status(status).json({ error: { name: err.name, message: err.message } });
  });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, () => r()));
  return server;
}

describe("createRouter", () => {
  const mockSite = {
    getNavigation: jest.fn(),
    renderPage: jest.fn(),
    pagePathFor: jest.fn(),
    getPageMarkdown: jest.fn(),
    reload: jest.fn(),
  };

  let server: http.Server;

  beforeAll(async () => {
    mockCreateSite.mockReturnValue(mockSite as any);
    const hub = new Hub({
      projectDir: "/test/docs",
      entity: "component:default/test",
    });
    server = await makeServer(hub);
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    mockSite.getNavigation.mockReset();
    mockSite.renderPage.mockReset();
    mockSite.pagePathFor.mockReset();
    mockSite.getPageMarkdown.mockReset();
    mockCreateSite.mockReturnValue(mockSite as any);
    authorizer.assertReadable.mockReset();
  });

  const prefix = "/site/default/component/test";

  describe("site read authorization", () => {
    // The gate lives in the site middleware, so it covers every site-scoped route — including any
    // added later, and including /config, which would otherwise reveal that a site exists to a
    // caller who may not read it.
    it.each([
      ["config", `${prefix}/config`],
      ["navigation", `${prefix}/navigation`],
      ["pages root", `${prefix}/pages/`],
      ["a page", `${prefix}/pages/guide`],
      ["markdown", `${prefix}/markdown?sectionRef=section:default/root`],
    ])("404s %s when the caller may not read the site entity", async (_name, path) => {
      authorizer.assertReadable.mockRejectedValue(
        new NotFoundError("No documentation site found for entity: default/component/test"),
      );

      const res = await request(server).get(path);

      expect(res.status).toBe(404);
      // Byte-identical to the response for a site that does not exist, so the route is not an
      // existence oracle.
      expect(res.body.error.message).toBe(
        "No documentation site found for entity: default/component/test",
      );
    });

    it("gives a refused caller the same response for a site that exists and one that does not", async () => {
      // The gate runs before the Hub lookup, so both paths answer identically — a caller who may
      // not read a site cannot use the 404 to discover whether it exists.
      authorizer.assertReadable.mockImplementation(async (_req: unknown, siteRef: string) => {
        throw new NotFoundError(`No documentation site found for entity: ${siteRef}`);
      });

      const existing = await request(server).get(`${prefix}/pages/guide`);
      const missing = await request(server).get("/site/default/component/nonexistent/pages/guide");

      expect(existing.status).toBe(missing.status);
      expect(existing.body.error.name).toBe(missing.body.error.name);
      expect(existing.body.error.message).toBe(
        "No documentation site found for entity: default/component/test",
      );
      expect(missing.body.error.message).toBe(
        "No documentation site found for entity: default/component/nonexistent",
      );
    });

    it("does not read the site when the caller is refused", async () => {
      authorizer.assertReadable.mockRejectedValue(new NotFoundError("No documentation site found"));

      await request(server).get(`${prefix}/pages/guide`);

      expect(mockSite.renderPage).not.toHaveBeenCalled();
      expect(mockSite.getNavigation).not.toHaveBeenCalled();
    });

    it("authorizes against the site entity path from the URL", async () => {
      mockSite.getNavigation.mockResolvedValue({ items: [] });

      await request(server).get(`${prefix}/navigation`);

      expect(authorizer.assertReadable).toHaveBeenCalledWith(
        expect.anything(),
        "default/component/test",
      );
    });

    it("leaves /health ungated — it is not site-scoped", async () => {
      const res = await request(server).get("/health");

      expect(res.status).toBe(200);
      expect(authorizer.assertReadable).not.toHaveBeenCalled();
    });
  });

  describe("GET /health", () => {
    it("returns ok", async () => {
      const res = await request(server).get("/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    });
  });

  describe(`GET ${prefix}/config`, () => {
    it("returns config with liveReloadEnabled false", async () => {
      const res = await request(server).get(`${prefix}/config`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ liveReloadEnabled: false });
    });
  });

  describe(`GET ${prefix}/navigation`, () => {
    const mockNav = [{ title: "Home", path: "/" }];

    it("returns navigation with null scope when no query param", async () => {
      mockSite.getNavigation.mockResolvedValue(mockNav);
      const res = await request(server).get(`${prefix}/navigation`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockNav);
      expect(mockSite.getNavigation).toHaveBeenCalledWith(null);
    });

    it("passes sectionRef query param to getNavigation", async () => {
      mockSite.getNavigation.mockResolvedValue(mockNav);
      const res = await request(server).get(`${prefix}/navigation?sectionRef=api`);
      expect(res.status).toBe(200);
      expect(mockSite.getNavigation).toHaveBeenCalledWith("api");
    });
  });

  describe(`GET ${prefix}/pages`, () => {
    const mockPage = { title: "Home", content: "<p>Welcome</p>" };

    it("renders root page", async () => {
      mockSite.renderPage.mockResolvedValue(mockPage);
      const res = await request(server).get(`${prefix}/pages/`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockPage);
      expect(mockSite.renderPage).toHaveBeenCalledWith("");
    });

    it("renders nested page", async () => {
      mockSite.renderPage.mockResolvedValue(mockPage);
      const res = await request(server).get(`${prefix}/pages/getting-started`);
      expect(res.status).toBe(200);
      expect(mockSite.renderPage).toHaveBeenCalledWith("getting-started");
    });

    it("rejects path traversal with 400", async () => {
      const res = await request(server).get(`${prefix}/pages/a%2F..%2Fb`);
      expect(res.status).toBe(400);
      expect(mockSite.renderPage).not.toHaveBeenCalled();
    });

    it("returns 404 when page not found (missing markdown file)", async () => {
      mockSite.renderPage.mockRejectedValue(new Error("Content not found"));
      const res = await request(server).get(`${prefix}/pages/nonexistent`);
      expect(res.status).toBe(404);
    });

    it("returns 404 when the path is not in the site structure", async () => {
      // @rwdocs/core's ordinary missing-URL case (RenderError::PageNotFound) —
      // e.g. a stale or doubled link. Must be a clean 404, not a 500.
      mockSite.renderPage.mockRejectedValue(new Error("Page not found: /parent/child"));
      const res = await request(server).get(`${prefix}/pages/parent/child`);
      expect(res.status).toBe(404);
    });

    it("returns 500 on unexpected render error", async () => {
      mockSite.renderPage.mockRejectedValue(new Error("disk read failed"));
      const res = await request(server).get(`${prefix}/pages/broken`);
      expect(res.status).toBe(500);
    });

    it("serves scope root page when sectionRef query param is provided", async () => {
      mockSite.getNavigation.mockResolvedValue({
        items: [],
        scope: {
          path: "/domains/billing",
          title: "Billing",
          section: { kind: "domain", name: "billing" },
        },
      });

      const mockScopedPage = { title: "Billing", content: "<p>Billing docs</p>" };
      mockSite.renderPage.mockResolvedValue(mockScopedPage);

      await request(server).get(`${prefix}/pages/?sectionRef=domain:default/billing`);
      expect(mockSite.renderPage).toHaveBeenCalledWith("domains/billing");
    });
  });

  describe(`GET ${prefix}/markdown`, () => {
    it("resolves a page's identity and returns its markdown", async () => {
      mockSite.pagePathFor.mockResolvedValue("domains/billing/overview");
      mockSite.getPageMarkdown.mockResolvedValue({ markdown: "# Overview\n" });

      const res = await request(server)
        .get(`${prefix}/markdown`)
        .query({ sectionRef: "domain:default/billing", subpath: "overview" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ markdown: "# Overview\n" });
      expect(mockSite.pagePathFor).toHaveBeenCalledWith("domain:default/billing", "overview");
      expect(mockSite.getPageMarkdown).toHaveBeenCalledWith("domains/billing/overview");
    });

    it("serves a section root, whose resolved path is the falsy empty string", async () => {
      // The site root resolves to "". Testing absence with `if (!path)` instead of
      // `path === null` would 404 the homepage.
      mockSite.pagePathFor.mockResolvedValue("");
      mockSite.getPageMarkdown.mockResolvedValue({ markdown: "# Home\n" });

      const res = await request(server)
        .get(`${prefix}/markdown`)
        .query({ sectionRef: "component:default/test" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ markdown: "# Home\n" });
      // An omitted subpath is the section root, not a bad request.
      expect(mockSite.pagePathFor).toHaveBeenCalledWith("component:default/test", "");
      expect(mockSite.getPageMarkdown).toHaveBeenCalledWith("");
    });

    it("returns 400 when sectionRef is missing", async () => {
      const res = await request(server).get(`${prefix}/markdown`).query({ subpath: "overview" });
      expect(res.status).toBe(400);
      expect(mockSite.pagePathFor).not.toHaveBeenCalled();
    });

    it("returns 400 for a traversing subpath", async () => {
      const res = await request(server)
        .get(`${prefix}/markdown`)
        .query({ sectionRef: "domain:default/billing", subpath: "../../etc/passwd" });
      expect(res.status).toBe(400);
      expect(mockSite.pagePathFor).not.toHaveBeenCalled();
    });

    it("returns 404 when no section carries the ref", async () => {
      mockSite.pagePathFor.mockResolvedValue(null);

      const res = await request(server)
        .get(`${prefix}/markdown`)
        .query({ sectionRef: "domain:default/nope", subpath: "overview" });

      expect(res.status).toBe(404);
      expect(mockSite.getPageMarkdown).not.toHaveBeenCalled();
    });

    it("returns 404 for a virtual page with no markdown source", async () => {
      mockSite.pagePathFor.mockResolvedValue("domains/billing");
      mockSite.getPageMarkdown.mockResolvedValue(null);

      const res = await request(server)
        .get(`${prefix}/markdown`)
        .query({ sectionRef: "domain:default/billing", subpath: "" });

      expect(res.status).toBe(404);
    });

    it("returns 404 when the resolved path names no page", async () => {
      // pagePathFor resolves, it does not verify: a real section ref with a
      // subpath naming no page yields a well-formed path, and the read rejects.
      mockSite.pagePathFor.mockResolvedValue("domains/billing/ghost");
      mockSite.getPageMarkdown.mockRejectedValue(
        new Error("Page not found: domains/billing/ghost"),
      );

      const res = await request(server)
        .get(`${prefix}/markdown`)
        .query({ sectionRef: "domain:default/billing", subpath: "ghost" });

      expect(res.status).toBe(404);
    });

    it.each([["S3: storage unavailable"], ["some unexpected failure"]])(
      "returns 503 when pagePathFor rejects with %p",
      async (message) => {
        // pagePathFor only rejects when the site can't be loaded — it resolves to
        // null for an unknown ref — so every rejection is an availability failure,
        // as with getNavigation. Anything else must not read as a missing page.
        mockSite.pagePathFor.mockRejectedValue(new Error(message));

        const res = await request(server)
          .get(`${prefix}/markdown`)
          .query({ sectionRef: "domain:default/billing", subpath: "overview" });

        expect(res.status).toBe(503);
        expect(res.body.error.name).toBe("ServiceUnavailableError");
      },
    );

    it("returns 500 on an unexpected getPageMarkdown error", async () => {
      mockSite.pagePathFor.mockResolvedValue("domains/billing/overview");
      mockSite.getPageMarkdown.mockRejectedValue(new Error("kaboom"));

      const res = await request(server)
        .get(`${prefix}/markdown`)
        .query({ sectionRef: "domain:default/billing", subpath: "overview" });

      expect(res.status).toBe(500);
    });

    it("returns 503 when getPageMarkdown throws a storage error", async () => {
      mockSite.pagePathFor.mockResolvedValue("domains/billing/overview");
      mockSite.getPageMarkdown.mockRejectedValue(
        new Error("Storage error: S3: storage unavailable"),
      );

      const res = await request(server)
        .get(`${prefix}/markdown`)
        .query({ sectionRef: "domain:default/billing", subpath: "overview" });

      expect(res.status).toBe(503);
      expect(res.body.error.name).toBe("ServiceUnavailableError");
    });
  });

  describe("storage errors", () => {
    it("returns 503 when getNavigation throws storage error", async () => {
      mockSite.getNavigation.mockRejectedValue(new Error("S3: storage unavailable"));
      const res = await request(server).get(`${prefix}/navigation`);
      expect(res.status).toBe(503);
      expect(res.body.error.name).toBe("ServiceUnavailableError");
    });

    it("returns 503 when renderPage throws storage error", async () => {
      mockSite.renderPage.mockRejectedValue(new Error("Storage error: S3: storage unavailable"));
      const res = await request(server).get(`${prefix}/pages/guide`);
      expect(res.status).toBe(503);
      expect(res.body.error.name).toBe("ServiceUnavailableError");
    });

    it("prefers 503 over 404 when a storage error message embeds a not-found phrase", async () => {
      // Storage (availability) is checked before the not-found phrases, so a
      // transient failure whose inner text happens to contain "Page not found"
      // still surfaces as 503, not 404.
      mockSite.renderPage.mockRejectedValue(new Error("Storage error: Page not found in cache"));
      const res = await request(server).get(`${prefix}/pages/guide`);
      expect(res.status).toBe(503);
      expect(res.body.error.name).toBe("ServiceUnavailableError");
    });

    it("returns 503 when getNavigation throws on scope resolution", async () => {
      mockSite.getNavigation.mockRejectedValue(new Error("S3: storage unavailable"));
      const res = await request(server).get(`${prefix}/pages/?sectionRef=domain:default/billing`);
      expect(res.status).toBe(503);
      expect(res.body.error.name).toBe("ServiceUnavailableError");
    });
  });

  describe("unknown entity ref", () => {
    it("returns 404 for non-existent entity", async () => {
      const res = await request(server).get("/site/default/component/unknown/config");
      expect(res.status).toBe(404);
    });
  });
});
