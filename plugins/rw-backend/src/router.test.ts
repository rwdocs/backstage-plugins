import { mockServices } from "@backstage/backend-test-utils";
import express from "express";
import request from "supertest";
import { createRouter } from "./router";
import { createSite } from "@rwdocs/core";

jest.mock("@rwdocs/core");

const mockCreateSite = createSite as jest.MockedFunction<typeof createSite>;

describe("createRouter", () => {
  let app: express.Express;

  const mockSite = {
    getNavigation: jest.fn(),
    renderPage: jest.fn(),
  };

  beforeAll(async () => {
    mockCreateSite.mockReturnValue(mockSite as any);

    const router = await createRouter({
      logger: mockServices.logger.mock(),
      httpAuth: mockServices.httpAuth.mock(),
      projectDir: "/test/docs",
    });

    app = express().use(router);
    app.use(
      (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const statusByName: Record<string, number> = { InputError: 400, NotFoundError: 404 };
        const status = statusByName[err.name] ?? 500;
        res.status(status).json({ error: { name: err.name, message: err.message } });
      },
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /health", () => {
    it("returns ok", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    });
  });

  describe("GET /config", () => {
    it("returns config with liveReloadEnabled false", async () => {
      const res = await request(app).get("/config");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ liveReloadEnabled: false });
    });
  });

  describe("GET /navigation", () => {
    const mockNav = [{ title: "Home", path: "/" }];

    it("returns navigation with null scope when no query param", async () => {
      mockSite.getNavigation.mockReturnValue(mockNav);
      const res = await request(app).get("/navigation");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockNav);
      expect(mockSite.getNavigation).toHaveBeenCalledWith(null);
    });

    it("passes scope query param to getNavigation", async () => {
      mockSite.getNavigation.mockReturnValue(mockNav);
      const res = await request(app).get("/navigation?scope=api");
      expect(res.status).toBe(200);
      expect(mockSite.getNavigation).toHaveBeenCalledWith("api");
    });
  });

  describe("GET /pages", () => {
    const mockPage = { title: "Home", content: "<p>Welcome</p>" };

    it("renders root page", async () => {
      mockSite.renderPage.mockResolvedValue(mockPage);
      const res = await request(app).get("/pages/");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockPage);
      expect(mockSite.renderPage).toHaveBeenCalledWith("");
    });

    it("renders nested page", async () => {
      mockSite.renderPage.mockResolvedValue(mockPage);
      const res = await request(app).get("/pages/getting-started");
      expect(res.status).toBe(200);
      expect(mockSite.renderPage).toHaveBeenCalledWith("getting-started");
    });

    it("rejects path traversal with 400", async () => {
      // Encode slashes so the ".." segment is not normalized by the HTTP client
      const res = await request(app).get("/pages/a%2F..%2Fb");
      expect(res.status).toBe(400);
      expect(mockSite.renderPage).not.toHaveBeenCalled();
    });

    it("returns 404 when page not found", async () => {
      mockSite.renderPage.mockRejectedValue(new Error("Content not found"));
      const res = await request(app).get("/pages/nonexistent");
      expect(res.status).toBe(404);
    });

    it("returns 500 on unexpected render error", async () => {
      mockSite.renderPage.mockRejectedValue(new Error("disk read failed"));
      const res = await request(app).get("/pages/broken");
      expect(res.status).toBe(500);
    });
  });
});
