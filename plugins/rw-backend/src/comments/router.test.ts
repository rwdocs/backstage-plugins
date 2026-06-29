import * as http from "http";
import express from "express";
import request from "supertest";
import { mockServices, TestDatabases } from "@backstage/backend-test-utils";
import { catalogServiceMock } from "@backstage/plugin-catalog-node/testUtils";
import { MiddlewareFactory } from "@backstage/backend-defaults/rootHttpRouter";
import { resolvePackagePath } from "@backstage/backend-plugin-api";
import { AuthorizeResult } from "@backstage/plugin-permission-common";
import type { PermissionsService } from "@backstage/backend-plugin-api";
import { CommentStore } from "./CommentStore";
import { createCommentsRouter } from "./router";
import { CommentPostProcessor } from "./CommentPostProcessor";

jest.mock("@rwdocs/core", () => ({
  renderCommentBody: jest.fn(async (md: string) => `<p>${md}</p>`),
}));

const ARCH = "component:default/arch";
const DOC = "section:default/root#guide";

const databases = TestDatabases.create({ ids: ["SQLITE_3"] });

// All servers created by buildApp / buildDenyApp are registered here and torn
// down after each test so no handles are left open.
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  servers.length = 0;
});

/**
 * Build an express app whose `permissions.authorize()` always returns DENY.
 * Used to exercise the 403-on-DENY branches in GET /comments, POST /comments,
 * and GET /comments/:id.  `authorizeConditional` is left as allow-all because
 * the DENY tests never reach conditional-evaluation paths.
 */
async function buildDenyApp() {
  const knex = await databases.init("SQLITE_3");
  await knex.migrate.latest({
    directory: resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations"),
  });
  const store = new CommentStore(knex);

  const denyPermissions: PermissionsService = {
    authorize: jest.fn(async (requests) => requests.map(() => ({ result: AuthorizeResult.DENY }))),
    authorizeConditional: jest.fn(async (requests) =>
      requests.map(() => ({ result: AuthorizeResult.ALLOW })),
    ),
  };

  const app = express();
  app.use(
    createCommentsRouter({
      store,
      logger: mockServices.logger.mock(),
      httpAuth: mockServices.httpAuth(),
      auth: mockServices.auth(),
      userInfo: mockServices.userInfo(),
      permissions: denyPermissions,
      permissionsRegistry: mockServices.permissionsRegistry.mock(),
      catalog: catalogServiceMock({
        entities: [
          {
            apiVersion: "backstage.io/v1alpha1",
            kind: "Component",
            metadata: { name: "arch", namespace: "default" },
          },
        ],
      }) as any,
      commentsEnabled: true,
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
  return { server, store };
}

async function buildApp(opts?: { entities?: unknown[] }) {
  const knex = await databases.init("SQLITE_3");
  await knex.migrate.latest({
    directory: resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations"),
  });
  const store = new CommentStore(knex);

  const app = express();
  app.use(
    createCommentsRouter({
      store,
      logger: mockServices.logger.mock(),
      httpAuth: mockServices.httpAuth(),
      auth: mockServices.auth(),
      userInfo: mockServices.userInfo(),
      permissions: mockServices.permissions(), // allow-all by default
      permissionsRegistry: mockServices.permissionsRegistry.mock(),
      catalog: catalogServiceMock({
        entities: (opts?.entities ?? [
          {
            apiVersion: "backstage.io/v1alpha1",
            kind: "Component",
            metadata: { name: "arch", namespace: "default" },
          },
        ]) as any,
      }),
      commentsEnabled: true,
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
  return { server, store };
}

describe("comments router", () => {
  it("POST /comments with missing body returns 400", async () => {
    const { server } = await buildApp();
    const res = await request(server)
      .post("/comments")
      .send({ siteRef: ARCH, documentId: DOC, selectors: [] });
    expect(res.status).toBe(400);
  });

  it("POST /comments with missing documentId returns 400 (not 500)", async () => {
    const { server } = await buildApp();
    const res = await request(server).post("/comments").send({ siteRef: ARCH, body: "hello" });
    expect(res.status).toBe(400);
  });

  it("GET /comments returns the full thread for a page", async () => {
    const { server, store } = await buildApp();
    await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "1",
      selectors: [],
    });
    const res = await request(server).get("/comments").query({ siteRef: ARCH, documentId: DOC });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].documentId).toBe(DOC);
    expect(res.body[0].canResolve).toBe(true);
  });

  it("rejects a documentId with no # as 400", async () => {
    const { server } = await buildApp();
    const res = await request(server)
      .get("/comments")
      .query({ siteRef: ARCH, documentId: "no-hash" });
    expect(res.status).toBe(400);
  });

  it("rejects a documentId with leading # as 400 on GET", async () => {
    const { server } = await buildApp();
    const res = await request(server).get("/comments").query({ siteRef: ARCH, documentId: "#foo" });
    expect(res.status).toBe(400);
  });

  it("rejects a documentId with leading # as 400 on POST", async () => {
    const { server } = await buildApp();
    const res = await request(server)
      .post("/comments")
      .send({ siteRef: ARCH, documentId: "#foo", body: "test", selectors: [] });
    expect(res.status).toBe(400);
  });

  it("404 when the site entity is not visible to the caller", async () => {
    const { server, store } = await buildApp({ entities: [] }); // catalog returns undefined
    await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "1",
      selectors: [],
    });
    const res = await request(server).get("/comments").query({ siteRef: ARCH, documentId: DOC });
    expect(res.status).toBe(404);
  });

  it("POST /comments stamps the author from identity and ignores client author", async () => {
    const { server } = await buildApp({
      entities: [
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
      ],
    });
    const res = await request(server)
      .post("/comments")
      .send({
        siteRef: ARCH,
        documentId: DOC,
        body: "hi",
        selectors: [],
        author: { id: "user:default/EVIL", name: "evil" },
      });
    expect(res.status).toBe(201);
    expect(res.body.author.id).not.toBe("user:default/EVIL");
    expect(res.body.documentId).toBe(DOC);
  });

  it("GET /comments/:id returns a comment by id", async () => {
    const { server, store } = await buildApp();
    const row = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "hello",
      selectors: [],
    });
    const res = await request(server).get(`/comments/${row.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(row.id);
    expect(res.body.documentId).toBe(DOC);
  });

  it("GET /comments/:id returns 404 for missing id", async () => {
    const { server } = await buildApp();
    const res = await request(server).get("/comments/nonexistent-id");
    expect(res.status).toBe(404);
  });

  it("GET /comments/:id returns 404 when comment exists but site entity is not visible", async () => {
    // Build the app with an empty catalog (entity not visible), seed a comment
    // directly into that same app's store, then verify GET /comments/:id → 404.
    const { server, store } = await buildApp({ entities: [] });
    const row = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "hello",
      selectors: [],
    });
    const res = await request(server).get(`/comments/${row.id}`);
    expect(res.status).toBe(404);
  });

  it("GET /comments/:id returns 404 for soft-deleted comment", async () => {
    const { server, store } = await buildApp();
    const parent = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "parent",
      selectors: [],
    });
    const reply = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "reply",
      selectors: [],
      parentId: parent.id,
    });
    await store.softDelete(reply.id);
    const res = await request(server).get(`/comments/${reply.id}`);
    expect(res.status).toBe(404);
  });

  it("PATCH /comments/:id resolve succeeds for non-author (collaborative)", async () => {
    const { server, store } = await buildApp();
    // comment authored by user:default/a; caller is user:default/mock (default mock user)
    const row = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "thread",
      selectors: [],
    });
    const res = await request(server).patch(`/comments/${row.id}`).send({ status: "resolved" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("resolved");
  });

  it("PATCH /comments/:id edit by non-author returns 403 (author floor) via MiddlewareFactory", async () => {
    const { server, store } = await buildApp();
    // comment authored by user:default/a; caller is user:default/mock
    const row = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "original",
      selectors: [],
    });
    const res = await request(server).patch(`/comments/${row.id}`).send({ body: "tampered" });
    // 403 enforced by author floor regardless of allow-all permissions
    expect(res.status).toBe(403);
  });

  it("DELETE /comments/:id by non-author returns 403 (author floor)", async () => {
    const { server, store } = await buildApp();
    const parent = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "parent",
      selectors: [],
    });
    const reply = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "reply",
      selectors: [],
      parentId: parent.id,
    });
    const res = await request(server).delete(`/comments/${reply.id}`);
    expect(res.status).toBe(403);
  });

  it("DELETE /comments/:id returns the soft-deleted row with correct documentId", async () => {
    const { server, store } = await buildApp();
    // create as mock user (the default caller)
    const parent = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "parent",
      selectors: [],
    });
    const reply = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "reply",
      selectors: [],
      parentId: parent.id,
    });
    const res = await request(server).delete(`/comments/${reply.id}`);
    expect(res.status).toBe(200);
    expect(res.body.documentId).toBe(DOC);
    expect(res.body.deletedAt).toBeDefined();
  });

  it("DELETE /comments/:id a second time on an already-deleted reply returns 404", async () => {
    const { server, store } = await buildApp();
    const parent = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "parent",
      selectors: [],
    });
    const reply = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "reply",
      selectors: [],
      parentId: parent.id,
    });
    const first = await request(server).delete(`/comments/${reply.id}`);
    expect(first.status).toBe(200);
    const second = await request(server).delete(`/comments/${reply.id}`);
    expect(second.status).toBe(404);
  });

  it("PATCH /comments/:id edit on soft-deleted row returns 400", async () => {
    const { server, store } = await buildApp();
    const parent = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "parent",
      selectors: [],
    });
    const reply = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "reply",
      selectors: [],
      parentId: parent.id,
    });
    await store.softDelete(reply.id);
    const res = await request(server).patch(`/comments/${reply.id}`).send({ body: "edited" });
    expect(res.status).toBe(400);
  });

  // ── Task 4 regression tests ──────────────────────────────────────────────

  it("PATCH /comments/:id with empty body {} returns 400 (no editable fields)", async () => {
    const { server, store } = await buildApp();
    const row = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "original",
      selectors: [],
    });
    const before = await store.get(row.id);
    const res = await request(server).patch(`/comments/${row.id}`).send({});
    expect(res.status).toBe(400);
    // Store must NOT have been mutated (updated_at unchanged)
    const after = await store.get(row.id);
    expect(after!.updated_at).toBe(before!.updated_at);
  });

  it("PATCH /comments/:id with only unknown fields returns 400 (no editable fields)", async () => {
    const { server, store } = await buildApp();
    const row = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "original",
      selectors: [],
    });
    const before = await store.get(row.id);
    const res = await request(server)
      .patch(`/comments/${row.id}`)
      .send({ unknownField: "surprise" });
    expect(res.status).toBe(400);
    const after = await store.get(row.id);
    expect(after!.updated_at).toBe(before!.updated_at);
  });

  it("PATCH /comments/:id status:resolved on a reply returns 400 (cannot resolve reply)", async () => {
    const { server, store } = await buildApp();
    const parent = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "parent",
      selectors: [],
    });
    const reply = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "reply",
      selectors: [],
      parentId: parent.id,
    });
    const res = await request(server).patch(`/comments/${reply.id}`).send({ status: "resolved" });
    expect(res.status).toBe(400);
    // Reply must remain unresolved
    const after = await store.get(reply.id);
    expect(after!.status).toBe("open");
  });

  it("POST /comments with non-string parentId returns 400 (not 500)", async () => {
    const { server } = await buildApp();
    const res = await request(server)
      .post("/comments")
      .send({
        siteRef: ARCH,
        documentId: DOC,
        body: "hi",
        selectors: [],
        parentId: { evil: true },
      });
    expect(res.status).toBe(400);
  });

  // ── End Task 4 regression tests ──────────────────────────────────────────

  // ── Task 5: error mapping & author-floor via thrown error ────────────────

  it("assertSiteVisible: catalog transport failure → 503", async () => {
    const knex = await databases.init("SQLITE_3");
    await knex.migrate.latest({
      directory: resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations"),
    });
    const store = new CommentStore(knex);

    // Mock catalog whose getEntityByRef rejects (transport/availability failure)
    const failingCatalog = catalogServiceMock.mock({
      getEntityByRef: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });

    const app = express();
    app.use(
      createCommentsRouter({
        store,
        logger: mockServices.logger.mock(),
        httpAuth: mockServices.httpAuth(),
        auth: mockServices.auth(),
        userInfo: mockServices.userInfo(),
        permissions: mockServices.permissions(),
        permissionsRegistry: mockServices.permissionsRegistry.mock(),
        catalog: failingCatalog,
        commentsEnabled: true,
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

    // Seed a comment so we reach assertSiteVisible
    await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "x",
      selectors: [],
    });
    const res = await request(server).get("/comments").query({ siteRef: ARCH, documentId: DOC });
    expect(res.status).toBe(503);
  });

  it("assertSiteVisible: missing entity (returns undefined) → 404, not 503", async () => {
    // entities: [] causes catalogServiceMock to return undefined from getEntityByRef
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

  it("assertAuthorFloor: edit by non-author → 403, store NOT mutated, denied log emitted", async () => {
    const { server, store } = await buildApp();
    const row = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a", // different from mock caller user:default/mock
      body: "original",
      selectors: [],
    });
    const before = await store.get(row.id);
    const res = await request(server).patch(`/comments/${row.id}`).send({ body: "tampered" });
    expect(res.status).toBe(403);
    // Store must NOT have been mutated
    const after = await store.get(row.id);
    expect(after!.body).toBe("original");
    expect(after!.updated_at).toBe(before!.updated_at);
  });

  it("assertAuthorFloor: delete by non-author → 403, store NOT mutated, denied log emitted", async () => {
    const { server, store } = await buildApp();
    const parent = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "parent",
      selectors: [],
    });
    const reply = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "reply",
      selectors: [],
      parentId: parent.id,
    });
    const res = await request(server).delete(`/comments/${reply.id}`);
    expect(res.status).toBe(403);
    // Reply must still exist, not soft-deleted
    const after = await store.get(reply.id);
    expect(after!.deleted_at).toBeNull();
  });

  it("assertAuthorFloor: restore by non-author → 403, store NOT mutated", async () => {
    const { server, store } = await buildApp();
    const parent = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "parent",
      selectors: [],
    });
    const reply = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "reply",
      selectors: [],
      parentId: parent.id,
    });
    await store.softDelete(reply.id);
    const res = await request(server).patch(`/comments/${reply.id}`).send({ status: "open" });
    expect(res.status).toBe(403);
    // Reply must remain soft-deleted
    const after = await store.get(reply.id);
    expect(after!.deleted_at).not.toBeNull();
  });

  // ── End Task 5 tests ──────────────────────────────────────────────────────

  // ── Task 6: permission DENY paths ────────────────────────────────────────

  it("GET /comments returns 403 when authorize() returns DENY for rwCommentReadPermission", async () => {
    // Locks in the branch at router.ts ~:131 — `if (decision[0].result !== AuthorizeResult.ALLOW)`
    // before the store is queried.  Removing that check would let the request through (200).
    const { server, store } = await buildDenyApp();
    await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "should not be visible",
      selectors: [],
    });
    const res = await request(server).get("/comments").query({ siteRef: ARCH, documentId: DOC });
    expect(res.status).toBe(403);
  });

  it("POST /comments returns 403 when authorize() returns DENY for rwCommentCreatePermission", async () => {
    // Locks in the branch at router.ts ~:154 — `if (decision[0].result !== AuthorizeResult.ALLOW)`
    // before the comment is created.  Removing that check would allow the comment to be stored (201).
    const { server } = await buildDenyApp();
    const res = await request(server)
      .post("/comments")
      .send({ siteRef: ARCH, documentId: DOC, body: "denied", selectors: [] });
    expect(res.status).toBe(403);
  });

  it("GET /comments/:id returns 403 when authorize() returns DENY for rwCommentReadPermission", async () => {
    // Locks in the branch at router.ts ~:196 — `if (decision[0].result !== AuthorizeResult.ALLOW)`
    // after the row is fetched but before it is returned.
    // Note: the deny app still has a catalog that knows about the entity, so assertSiteVisible
    // would pass — the permission check fires before assertSiteVisible.
    const { server, store } = await buildDenyApp();
    const row = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/a",
      body: "private",
      selectors: [],
    });
    const res = await request(server).get(`/comments/${row.id}`);
    expect(res.status).toBe(403);
  });

  // ── End Task 6: permission DENY paths ────────────────────────────────────

  // ── Task 6: POST /comments parentId validation (5 reject branches) ───────

  it("POST /comments with non-existent parentId returns 400", async () => {
    // Locks in `!parent` branch of the parentId guard at router.ts ~:167.
    // Removing the guard (or the !parent check) would allow the insert to proceed
    // with a dangling foreign-key-like value.
    const { server } = await buildApp();
    const res = await request(server).post("/comments").send({
      siteRef: ARCH,
      documentId: DOC,
      body: "reply",
      selectors: [],
      parentId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toMatch(/Invalid parentId/);
  });

  it("POST /comments with parentId belonging to a different siteRef returns 400", async () => {
    // Locks in `parent.site_ref !== siteRef` branch at router.ts ~:169.
    // The parent exists but was created under a different site entity.
    const { server, store } = await buildApp();
    const OTHER_SITE = "component:default/other";
    const parent = await store.create(OTHER_SITE, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "root in other site",
      selectors: [],
    });
    const res = await request(server).post("/comments").send({
      siteRef: ARCH,
      documentId: DOC,
      body: "cross-site reply",
      selectors: [],
      parentId: parent.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toMatch(/Invalid parentId/);
  });

  it("POST /comments with parentId belonging to a different documentId returns 400", async () => {
    // Locks in `parent.page_ref !== pageRef` branch at router.ts ~:170.
    // The parent is in the same site but a different document.
    const { server, store } = await buildApp();
    const OTHER_DOC = "section:default/root#other";
    const parent = await store.create(ARCH, {
      pageRef: OTHER_DOC,
      authorRef: "user:default/mock",
      body: "root in other doc",
      selectors: [],
    });
    const res = await request(server).post("/comments").send({
      siteRef: ARCH,
      documentId: DOC,
      body: "cross-doc reply",
      selectors: [],
      parentId: parent.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toMatch(/Invalid parentId/);
  });

  it("POST /comments with parentId that is itself a reply (non-root) returns 400", async () => {
    // Locks in `parent.parent_id !== null` branch at router.ts ~:171.
    // Nested replies are disallowed — only root comments may be parents.
    const { server, store } = await buildApp();
    const root = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "root comment",
      selectors: [],
    });
    const existingReply = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "first reply",
      selectors: [],
      parentId: root.id,
    });
    const res = await request(server).post("/comments").send({
      siteRef: ARCH,
      documentId: DOC,
      body: "nested reply (invalid)",
      selectors: [],
      parentId: existingReply.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toMatch(/Invalid parentId/);
  });

  it("POST /comments with a soft-deleted parentId returns 400", async () => {
    // Locks in `parent.deleted_at !== null` branch at router.ts ~:172.
    // Replying to a deleted comment must be rejected.
    const { server, store } = await buildApp();
    const root = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "root that will be deleted",
      selectors: [],
    });
    await store.softDelete(root.id);
    const res = await request(server).post("/comments").send({
      siteRef: ARCH,
      documentId: DOC,
      body: "reply to deleted parent",
      selectors: [],
      parentId: root.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toMatch(/Invalid parentId/);
  });

  // ── End Task 6: parentId validation tests ────────────────────────────────

  // ── Task 1: request-validation hardening ─────────────────────────────────

  it("POST /comments with parentId: '' (empty string) returns 400 and creates no row", async () => {
    const { server, store } = await buildApp();
    const before = await store.list(ARCH, { pageRef: DOC });
    const res = await request(server).post("/comments").send({
      siteRef: ARCH,
      documentId: DOC,
      body: "hi",
      selectors: [],
      parentId: "",
    });
    expect(res.status).toBe(400);
    const after = await store.list(ARCH, { pageRef: DOC });
    expect(after.length).toBe(before.length);
  });

  it("GET /comments with repeated siteRef param (array) returns 400", async () => {
    const { server } = await buildApp();
    // supertest encodes ?siteRef=a&siteRef=b which Express parses as string[]
    const res = await request(server)
      .get("/comments")
      .query({ siteRef: [ARCH, ARCH], documentId: DOC });
    expect(res.status).toBe(400);
  });

  it("GET /comments with malformed siteRef returns 400, not 503", async () => {
    const { server } = await buildApp();
    const res = await request(server)
      .get("/comments")
      .query({ siteRef: "not a ref", documentId: DOC });
    expect(res.status).toBe(400);
  });

  it("POST /comments with malformed siteRef returns 400, not 503", async () => {
    const { server } = await buildApp();
    const res = await request(server).post("/comments").send({
      siteRef: "not a ref",
      documentId: DOC,
      body: "hello",
      selectors: [],
    });
    expect(res.status).toBe(400);
  });

  it("POST /comments with body just over 16 KiB returns 400", async () => {
    const { server } = await buildApp();
    const oversizedBody = "x".repeat(16 * 1024 + 1);
    const res = await request(server).post("/comments").send({
      siteRef: ARCH,
      documentId: DOC,
      body: oversizedBody,
      selectors: [],
    });
    expect(res.status).toBe(400);
  });

  it("POST /comments with body exactly at 16 KiB succeeds", async () => {
    const { server } = await buildApp();
    const exactBody = "x".repeat(16 * 1024);
    const res = await request(server).post("/comments").send({
      siteRef: ARCH,
      documentId: DOC,
      body: exactBody,
      selectors: [],
    });
    expect(res.status).toBe(201);
  });

  it("PATCH /comments/:id with body just over 16 KiB returns 400", async () => {
    const { server, store } = await buildApp();
    const row = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "original",
      selectors: [],
    });
    const oversizedBody = "x".repeat(16 * 1024 + 1);
    const res = await request(server).patch(`/comments/${row.id}`).send({ body: oversizedBody });
    expect(res.status).toBe(400);
  });

  it("PATCH /comments/:id with body exactly at 16 KiB succeeds", async () => {
    const { server, store } = await buildApp();
    const row = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "original",
      selectors: [],
    });
    const exactBody = "x".repeat(16 * 1024);
    const res = await request(server).patch(`/comments/${row.id}`).send({ body: exactBody });
    expect(res.status).toBe(200);
  });

  // ── End Task 1 tests ──────────────────────────────────────────────────────

  it("GET /comments/config returns enabled: true when comments are on", async () => {
    const { server } = await buildApp();
    const res = await request(server).get("/comments/config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true });
  });

  // ── post-processing wiring ───────────────────────────────────────────────

  async function buildAppWithPostProcessor(postProcessor: CommentPostProcessor) {
    const knex = await databases.init("SQLITE_3");
    await knex.migrate.latest({
      directory: resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations"),
    });
    const store = new CommentStore(knex);

    const app = express();
    app.use(
      createCommentsRouter({
        store,
        logger: mockServices.logger.mock(),
        httpAuth: mockServices.httpAuth(),
        auth: mockServices.auth(),
        userInfo: mockServices.userInfo(),
        permissions: mockServices.permissions(),
        permissionsRegistry: mockServices.permissionsRegistry.mock(),
        catalog: catalogServiceMock({
          entities: [
            {
              apiVersion: "backstage.io/v1alpha1",
              kind: "Component",
              metadata: { name: "arch", namespace: "default" },
            },
          ],
        }),
        commentsEnabled: true,
        postProcessor,
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
    return { server, store };
  }

  it("calls postProcess('created', ...) after a successful create", async () => {
    const postProcess = jest.fn();
    const postProcessor = { postProcess } as unknown as CommentPostProcessor;
    const { server } = await buildAppWithPostProcessor(postProcessor);

    const res = await request(server)
      .post("/comments")
      .send({ siteRef: ARCH, documentId: DOC, body: "hello postProcessor", selectors: [] });
    expect(res.status).toBe(201);

    expect(postProcess).toHaveBeenCalledWith(
      "created",
      expect.objectContaining({ id: expect.any(String) }),
      expect.any(String),
    );
    expect(postProcess).toHaveBeenCalledTimes(1);
  });

  it("calls postProcess('resolved', ...) after a resolve PATCH", async () => {
    const postProcess = jest.fn();
    const postProcessor = { postProcess } as unknown as CommentPostProcessor;
    const { server, store } = await buildAppWithPostProcessor(postProcessor);

    // Seed a top-level comment directly in the store
    const row = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "to be resolved",
      selectors: [],
    });

    const res = await request(server).patch(`/comments/${row.id}`).send({ status: "resolved" });
    expect(res.status).toBe(200);

    expect(postProcess).toHaveBeenCalledWith("resolved", expect.anything(), expect.any(String));
    expect(postProcess).toHaveBeenCalledTimes(1);
  });

  it("does NOT call postProcess('resolved', ...) on reopen (status:'open') or edit (body)", async () => {
    const postProcess = jest.fn();
    const postProcessor = { postProcess } as unknown as CommentPostProcessor;
    const { server, store } = await buildAppWithPostProcessor(postProcessor);

    // Seed a resolved top-level comment to reopen
    const row = await store.create(ARCH, {
      pageRef: DOC,
      authorRef: "user:default/mock",
      body: "comment to test reopen/edit",
      selectors: [],
    });
    await store.update(row.id, { status: "resolved", resolverRef: "user:default/mock" });

    // Reopen
    const reopenRes = await request(server).patch(`/comments/${row.id}`).send({ status: "open" });
    expect(reopenRes.status).toBe(200);

    expect(postProcess).not.toHaveBeenCalledWith("resolved", expect.anything(), expect.anything());

    // Edit (body change by author)
    const editRes = await request(server)
      .patch(`/comments/${row.id}`)
      .send({ body: "edited body" });
    expect(editRes.status).toBe(200);

    expect(postProcess).not.toHaveBeenCalledWith("resolved", expect.anything(), expect.anything());
  });

  // ── End post-processing wiring ───────────────────────────────────────────

  // ── Preserved-seam guard (Task 1) ────────────────────────────────────────
  // This test locks the viewer wire: GET ?documentId= / POST body.documentId /
  // response field documentId must never change, regardless of internal renames.
  it("viewer wire: GET ?documentId= and POST body.documentId; response uses documentId", async () => {
    const { server } = await buildApp();

    // POST a comment using the viewer wire field `documentId`
    const created = await request(server)
      .post("/comments")
      .send({ siteRef: ARCH, documentId: DOC, body: "hi", selectors: [] })
      .expect(201);
    expect(created.body.documentId).toBe(DOC);

    // GET list filters via ?documentId=
    const listed = await request(server)
      .get("/comments")
      .query({ siteRef: ARCH, documentId: DOC })
      .expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].documentId).toBe(DOC);
  });
  // ── End preserved-seam guard ──────────────────────────────────────────────

  it("disabled app returns 404 on /comments and enabled:false on /comments/config", async () => {
    const knex = await databases.init("SQLITE_3");
    await knex.migrate.latest({
      directory: resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations"),
    });
    const store = new CommentStore(knex);
    const disabledApp = express();
    disabledApp.use(
      createCommentsRouter({
        store,
        logger: mockServices.logger.mock(),
        httpAuth: mockServices.httpAuth(),
        auth: mockServices.auth(),
        userInfo: mockServices.userInfo(),
        permissions: mockServices.permissions(),
        permissionsRegistry: mockServices.permissionsRegistry.mock(),
        catalog: catalogServiceMock() as any,
        commentsEnabled: false,
      }),
    );
    disabledApp.use(
      MiddlewareFactory.create({
        logger: mockServices.logger.mock(),
        config: mockServices.rootConfig(),
      }).error(),
    );

    // Use a shared server so both requests reuse the same TCP socket — avoids
    // ephemeral-port exhaustion under parallel jest workers.
    const server = http.createServer(disabledApp);
    await new Promise<void>((r) => server.listen(0, () => r()));
    servers.push(server);
    const agent = request(server);
    const listRes = await agent.get("/comments").query({ siteRef: ARCH, documentId: DOC });
    expect(listRes.status).toBe(404);
    const configRes = await agent.get("/comments/config");
    expect(configRes.status).toBe(200);
    expect(configRes.body).toEqual({ enabled: false });
  });
});
