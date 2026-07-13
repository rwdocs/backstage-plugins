/**
 * Integration test for the comments subsystem wired the same way plugin.ts wires it:
 * the page router (createRouter) and the comments router (createCommentsRouter) mounted
 * as sibling routers on one app, against a real SQLite database.
 *
 * This drives a lifecycle over HTTP: POST → GET thread → PATCH resolve → DELETE reply.
 */
import * as http from "http";
import express from "express";
import request from "supertest";
import { mockServices, TestDatabases } from "@backstage/backend-test-utils";
import { catalogServiceMock } from "@backstage/plugin-catalog-node/testUtils";
import { MiddlewareFactory } from "@backstage/backend-defaults/rootHttpRouter";
import { resolvePackagePath } from "@backstage/backend-plugin-api";
import { createSite } from "@rwdocs/core";
import { Hub } from "../hub";
import { CommentStore } from "./CommentStore";
import { createRouter } from "../router";
import { createCommentsRouter } from "./router";

jest.mock("@rwdocs/core", () => ({
  createSite: jest.fn(),
  renderCommentBody: jest.fn(async (md: string) => `<p>${md}</p>`),
}));

const mockCreateSite = createSite as jest.MockedFunction<typeof createSite>;

const ARCH = "component:default/arch";
const DOC = "section:default/root#guide";

const databases = TestDatabases.create({ ids: ["SQLITE_3"] });

// All servers created by buildApp are registered here and torn down after each test.
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  servers.length = 0;
});

async function buildApp(opts?: { entities?: unknown[] }) {
  const knex = await databases.init("SQLITE_3");
  await knex.migrate.latest({
    directory: resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations"),
  });
  const store = new CommentStore(knex);

  const mockSite = {
    getNavigation: jest.fn().mockResolvedValue([]),
    renderPage: jest.fn().mockResolvedValue({ title: "Test", content: "<p>test</p>" }),
    reload: jest.fn(),
  };
  mockCreateSite.mockReturnValue(mockSite as any);

  const hub = new Hub({ projectDir: "/test/docs", entity: ARCH });

  const catalog = catalogServiceMock({
    entities: (opts?.entities ?? [
      {
        apiVersion: "backstage.io/v1alpha1",
        kind: "Component",
        metadata: { name: "arch", namespace: "default" },
      },
      {
        apiVersion: "backstage.io/v1alpha1",
        kind: "User",
        metadata: { name: "mock", namespace: "default" },
        spec: { profile: { displayName: "Mock User" } },
      },
    ]) as any,
  });

  // Mirror plugin.ts: page router and comments router mounted as siblings. The site read gate is
  // exercised in router.test.ts; here it always allows, so the comment routes are what is under test.
  const router = await createRouter({
    logger: mockServices.logger.mock(),
    httpAuth: mockServices.httpAuth(),
    hub,
    authorizer: { assertReadable: async () => {} } as any,
  });
  const commentsRouter = createCommentsRouter({
    store,
    logger: mockServices.logger.mock(),
    httpAuth: mockServices.httpAuth(),
    auth: mockServices.auth(),
    userInfo: mockServices.userInfo(),
    permissions: mockServices.permissions(),
    permissionsRegistry: mockServices.permissionsRegistry.mock(),
    catalog,
    commentsEnabled: true,
  });

  const app = express();
  app.use(router);
  app.use(commentsRouter);
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const statusByName: Record<string, number> = {
      InputError: 400,
      NotFoundError: 404,
      NotAllowedError: 403,
      ServiceUnavailableError: 503,
    };
    const status = statusByName[err.name] ?? 500;
    res.status(status).json({ error: { name: err.name, message: err.message } });
  });
  app.use(
    MiddlewareFactory.create({
      logger: mockServices.logger.mock(),
      config: mockServices.rootConfig(),
    }).error(),
  );

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, () => r()));
  servers.push(server);
  return { server, store, knex };
}

describe("comments integration (page + comments routers as siblings)", () => {
  it("POST a comment, GET the thread, PATCH resolve, DELETE a reply", async () => {
    const { server } = await buildApp();
    const agent = request(server);

    // POST a root comment
    const postRes = await agent
      .post("/comments")
      .send({ siteRef: ARCH, documentId: DOC, body: "root comment", selectors: [] });
    expect(postRes.status).toBe(201);
    const rootId = postRes.body.id;
    expect(rootId).toBeDefined();
    expect(postRes.body.documentId).toBe(DOC);
    expect(postRes.body.status).toBe("open");

    // POST a reply
    const replyRes = await agent
      .post("/comments")
      .send({ siteRef: ARCH, documentId: DOC, body: "reply", selectors: [], parentId: rootId });
    expect(replyRes.status).toBe(201);
    const replyId = replyRes.body.id;
    expect(replyRes.body.parentId).toBe(rootId);

    // GET thread: both comments visible
    const getRes = await agent.get("/comments").query({ siteRef: ARCH, documentId: DOC });
    expect(getRes.status).toBe(200);
    expect(getRes.body).toHaveLength(2);
    const ids = getRes.body.map((c: any) => c.id);
    expect(ids).toContain(rootId);
    expect(ids).toContain(replyId);

    // PATCH root → resolved (collaborative; default mock user != author of root)
    // The default mock user is user:default/mock. The root was created as user:default/mock (mockServices.userInfo default).
    const patchRes = await agent.patch(`/comments/${rootId}`).send({ status: "resolved" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe("resolved");

    // DELETE the reply (author is user:default/mock, which matches the default caller)
    const delRes = await agent.delete(`/comments/${replyId}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.deletedAt).toBeDefined();
    expect(delRes.body.documentId).toBe(DOC);

    // GET thread after delete: reply excluded (soft-deleted), root still present
    const getAfterRes = await agent.get("/comments").query({ siteRef: ARCH, documentId: DOC });
    expect(getAfterRes.status).toBe(200);
    expect(getAfterRes.body).toHaveLength(1);
    expect(getAfterRes.body[0].id).toBe(rootId);
  });

  it("GET /comments/config returns enabled: true when mounted alongside the page router", async () => {
    const { server } = await buildApp();
    const res = await request(server).get("/comments/config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true });
  });

  it("POST /comments requires a valid documentId with #", async () => {
    const { server } = await buildApp();
    const res = await request(server)
      .post("/comments")
      .send({ siteRef: ARCH, documentId: "no-hash", body: "test", selectors: [] });
    expect(res.status).toBe(400);
  });

  it("GET /comments returns 404 when site entity not in catalog", async () => {
    // Build with empty catalog; seed a comment via the app's own store so the
    // entity-visibility guard is actually exercised over real data (not a separate DB).
    const { server, store } = await buildApp({ entities: [] });
    await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "x",
      selectors: [],
    });

    const res = await request(server).get("/comments").query({ siteRef: ARCH, documentId: DOC });
    expect(res.status).toBe(404);
  });

  it("GET /health still works on the same router", async () => {
    const { server } = await buildApp();
    const res = await request(server).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
