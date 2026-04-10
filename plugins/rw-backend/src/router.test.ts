import { mockServices } from "@backstage/backend-test-utils";
import express from "express";
import request from "supertest";
import { createRouter } from "./router";
import { Hub } from "./hub";
import { createSite } from "@rwdocs/core";

jest.mock("@rwdocs/core");

const mockCreateSite = createSite as jest.MockedFunction<typeof createSite>;

function makeApp(hub: Hub) {
  return createRouter({
    logger: mockServices.logger.mock(),
    httpAuth: mockServices.httpAuth.mock(),
    hub,
  }).then((router) => {
    const app = express().use(router);
    app.use(
      (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const statusByName: Record<string, number> = {
          InputError: 400,
          NotFoundError: 404,
          ServiceUnavailableError: 503,
        };
        const status = statusByName[err.name] ?? 500;
        res.status(status).json({ error: { name: err.name, message: err.message } });
      },
    );
    return app;
  });
}

describe("createRouter", () => {
  const mockSite = {
    getNavigation: jest.fn(),
    renderPage: jest.fn(),
    reload: jest.fn(),
  };

  let app: express.Express;

  beforeAll(async () => {
    mockCreateSite.mockReturnValue(mockSite as any);
    const hub = new Hub({
      projectDir: "/test/docs",
      entity: "component:default/test",
    });
    app = await makeApp(hub);
  });

  beforeEach(() => {
    mockSite.getNavigation.mockReset();
    mockSite.renderPage.mockReset();
    mockCreateSite.mockReturnValue(mockSite as any);
  });

  const prefix = "/site/default/component/test";

  describe("GET /health", () => {
    it("returns ok", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    });
  });

  describe(`GET ${prefix}/config`, () => {
    it("returns config with liveReloadEnabled false", async () => {
      const res = await request(app).get(`${prefix}/config`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ liveReloadEnabled: false });
    });
  });

  describe(`GET ${prefix}/navigation`, () => {
    const mockNav = [{ title: "Home", path: "/" }];

    it("returns navigation with null scope when no query param", async () => {
      mockSite.getNavigation.mockResolvedValue(mockNav);
      const res = await request(app).get(`${prefix}/navigation`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockNav);
      expect(mockSite.getNavigation).toHaveBeenCalledWith(null);
    });

    it("passes sectionRef query param to getNavigation", async () => {
      mockSite.getNavigation.mockResolvedValue(mockNav);
      const res = await request(app).get(`${prefix}/navigation?sectionRef=api`);
      expect(res.status).toBe(200);
      expect(mockSite.getNavigation).toHaveBeenCalledWith("api");
    });
  });

  describe(`GET ${prefix}/pages`, () => {
    const mockPage = { title: "Home", content: "<p>Welcome</p>" };

    it("renders root page", async () => {
      mockSite.renderPage.mockResolvedValue(mockPage);
      const res = await request(app).get(`${prefix}/pages/`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockPage);
      expect(mockSite.renderPage).toHaveBeenCalledWith("");
    });

    it("renders nested page", async () => {
      mockSite.renderPage.mockResolvedValue(mockPage);
      const res = await request(app).get(`${prefix}/pages/getting-started`);
      expect(res.status).toBe(200);
      expect(mockSite.renderPage).toHaveBeenCalledWith("getting-started");
    });

    it("rejects path traversal with 400", async () => {
      const res = await request(app).get(`${prefix}/pages/a%2F..%2Fb`);
      expect(res.status).toBe(400);
      expect(mockSite.renderPage).not.toHaveBeenCalled();
    });

    it("returns 404 when page not found", async () => {
      mockSite.renderPage.mockRejectedValue(new Error("Content not found"));
      const res = await request(app).get(`${prefix}/pages/nonexistent`);
      expect(res.status).toBe(404);
    });

    it("returns 500 on unexpected render error", async () => {
      mockSite.renderPage.mockRejectedValue(new Error("disk read failed"));
      const res = await request(app).get(`${prefix}/pages/broken`);
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

      await request(app).get(`${prefix}/pages/?sectionRef=domain:default/billing`);
      expect(mockSite.renderPage).toHaveBeenCalledWith("domains/billing");
    });
  });

  describe("storage errors", () => {
    it("returns 503 when getNavigation throws storage error", async () => {
      mockSite.getNavigation.mockRejectedValue(new Error("S3: storage unavailable"));
      const res = await request(app).get(`${prefix}/navigation`);
      expect(res.status).toBe(503);
      expect(res.body.error.name).toBe("ServiceUnavailableError");
    });

    it("returns 503 when renderPage throws storage error", async () => {
      mockSite.renderPage.mockRejectedValue(new Error("Storage error: S3: storage unavailable"));
      const res = await request(app).get(`${prefix}/pages/guide`);
      expect(res.status).toBe(503);
      expect(res.body.error.name).toBe("ServiceUnavailableError");
    });

    it("returns 503 when getNavigation throws on scope resolution", async () => {
      mockSite.getNavigation.mockRejectedValue(new Error("S3: storage unavailable"));
      const res = await request(app).get(`${prefix}/pages/?sectionRef=domain:default/billing`);
      expect(res.status).toBe(503);
      expect(res.body.error.name).toBe("ServiceUnavailableError");
    });
  });

  describe("unknown entity ref", () => {
    it("returns 404 for non-existent entity", async () => {
      const res = await request(app).get("/site/default/component/unknown/config");
      expect(res.status).toBe(404);
    });
  });
});
