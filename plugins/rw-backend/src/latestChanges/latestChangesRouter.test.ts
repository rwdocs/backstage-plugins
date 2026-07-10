import * as http from "http";
import express from "express";
import request from "supertest";
import { mockServices } from "@backstage/backend-test-utils";
import { MiddlewareFactory } from "@backstage/backend-defaults/rootHttpRouter";
import { createLatestChangesRouter } from "./latestChangesRouter";
import type { LatestChangesStore } from "./LatestChangesStore";
import { encodeLatestChangesCursor } from "./latestChangesCursor";

// All servers are registered here and torn down after each test.
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  servers.length = 0;
});

async function buildApp(
  store: Pick<LatestChangesStore, "latestChangesPage" | "hasAnyDated">,
): Promise<http.Server> {
  const app = express();
  app.use(
    createLatestChangesRouter({
      httpAuth: mockServices.httpAuth(),
      store: store as LatestChangesStore,
    }),
  );
  app.use(
    MiddlewareFactory.create({
      logger: mockServices.logger.mock(),
      config: mockServices.rootConfig(),
    }).error(),
  );

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, () => r()));
  servers.push(server);
  return server;
}

describe("createLatestChangesRouter", () => {
  it("returns items + hasAnyDated and no cursor when the page is not full", async () => {
    const store = {
      latestChangesPage: jest.fn().mockResolvedValue({
        rows: [
          {
            site_ref: "component:default/s",
            section_ref: "component:default/s",
            subpath: "guides/a",
            title: "A",
            last_modified: 1_700_000_000_000,
            entity_ref: "component:default/owner",
            section_path: "docs",
          },
        ],
        hasMore: false,
      }),
      hasAnyDated: jest.fn().mockResolvedValue(true),
    };
    const server = await buildApp(store);
    const res = await request(server).get("/pages/latest");
    expect(res.status).toBe(200);
    expect(res.body.hasAnyDated).toBe(true);
    expect(res.body.items).toEqual([
      {
        entityRef: "component:default/owner",
        viewerPath: "docs/guides/a",
        title: "A",
        lastModified: new Date(1_700_000_000_000).toISOString(),
      },
    ]);
    expect(res.body.pageInfo).toEqual({});
  });

  it("emits a nextCursor when the page is full", async () => {
    const store = {
      latestChangesPage: jest.fn().mockResolvedValue({
        rows: [
          {
            site_ref: "component:default/s",
            section_ref: "component:default/s",
            subpath: "a",
            title: "A",
            last_modified: 1000,
            entity_ref: "component:default/o",
            section_path: "",
          },
        ],
        hasMore: true,
      }),
      hasAnyDated: jest.fn().mockResolvedValue(true),
    };
    const server = await buildApp(store);
    const res = await request(server).get("/pages/latest?limit=1");
    expect(res.status).toBe(200);
    expect(res.body.pageInfo.nextCursor).toEqual(expect.any(String));
  });

  it("clamps limit above the max", async () => {
    const latestChangesPage = jest.fn().mockResolvedValue({ rows: [], hasMore: false });
    const store = { latestChangesPage, hasAnyDated: jest.fn().mockResolvedValue(false) };
    const server = await buildApp(store);
    await request(server).get("/pages/latest?limit=9999");
    expect(latestChangesPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });

  it("decodes a real cursor and passes its lastKey to the store", async () => {
    const latestChangesPage = jest.fn().mockResolvedValue({ rows: [], hasMore: false });
    const store = { latestChangesPage, hasAnyDated: jest.fn().mockResolvedValue(true) };
    const server = await buildApp(store);
    const cursor = encodeLatestChangesCursor({
      lastKey: [1_700_000_000_000, "component:default/s", "component:default/s", "guides/a"],
    });
    await request(server).get(`/pages/latest?cursor=${encodeURIComponent(cursor)}`);
    expect(latestChangesPage).toHaveBeenCalledWith(
      expect.objectContaining({
        lastKey: [1_700_000_000_000, "component:default/s", "component:default/s", "guides/a"],
      }),
    );
  });

  it("short-circuits hasAnyDated to true when a cursor is present, without calling the store", async () => {
    const hasAnyDated = jest.fn().mockResolvedValue(false);
    const store = {
      latestChangesPage: jest.fn().mockResolvedValue({ rows: [], hasMore: false }),
      hasAnyDated,
    };
    const server = await buildApp(store);
    const cursor = encodeLatestChangesCursor({
      lastKey: [1_700_000_000_000, "component:default/s", "component:default/s", "guides/a"],
    });
    const res = await request(server).get(`/pages/latest?cursor=${encodeURIComponent(cursor)}`);
    expect(res.body.hasAnyDated).toBe(true);
    expect(hasAnyDated).not.toHaveBeenCalled();
  });

  it("rejects a malformed cursor with 400", async () => {
    const store = {
      latestChangesPage: jest.fn().mockResolvedValue({ rows: [], hasMore: false }),
      hasAnyDated: jest.fn().mockResolvedValue(false),
    };
    const server = await buildApp(store);
    const res = await request(server).get("/pages/latest?cursor=%%%bad%%%");
    expect(res.status).toBe(400);
  });
});
