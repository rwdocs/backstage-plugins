import * as http from "http";
import express from "express";
import request from "supertest";
import { mockServices, TestDatabases } from "@backstage/backend-test-utils";
import { MiddlewareFactory } from "@backstage/backend-defaults/rootHttpRouter";
import { resolvePackagePath } from "@backstage/backend-plugin-api";
import { AuthorizeResult } from "@backstage/plugin-permission-common";
import type { PermissionsService, UserInfoService } from "@backstage/backend-plugin-api";
import { rwCommentReadPermission } from "@rwdocs/backstage-plugin-rw-common";
import type { Knex } from "knex";
import { CommentStore } from "../comments/CommentStore";
import { InboxStore } from "./InboxStore";
import { insertComment } from "./__testUtils__/testHelpers";
import { createInboxRouter } from "./inboxRouter";

jest.mock("@rwdocs/core", () => ({
  renderCommentBody: jest.fn(async (md: string) => `<p>${md}</p>`),
}));

const databases = TestDatabases.create({ ids: ["SQLITE_3"] });

// All servers are registered here and torn down after each test.
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  servers.length = 0;
});

function makeAllowPermissions(): PermissionsService {
  return mockServices.permissions();
}

function makeDenyPermissions(): PermissionsService {
  // Hand-rolled: only `authorize` is exercised by the inbox endpoint; the
  // jest.fn return types are looser than PermissionsService but tests are not
  // type-gated and this runs correctly. (Noted for the reviewing-tests pass.)
  return {
    authorize: jest.fn(async (requests) => requests.map(() => ({ result: AuthorizeResult.DENY }))),
    authorizeConditional: jest.fn(async (requests) =>
      requests.map(() => ({ result: AuthorizeResult.ALLOW })),
    ),
  } as unknown as PermissionsService;
}

function makeOwnerUserInfo(ownershipEntityRefs: string[]): UserInfoService {
  return {
    getUserInfo: jest.fn(async () => ({
      userEntityRef: "user:default/alice",
      ownershipEntityRefs,
    })),
  };
}

function makeSiteRefreshStore(built: boolean) {
  return { anyBuilt: jest.fn(async () => built) };
}

interface BuildAppResult {
  server: http.Server;
  commentStore: CommentStore;
  inboxStore: InboxStore;
  knex: Knex;
}

async function buildApp(opts?: {
  userInfo?: UserInfoService;
  permissions?: PermissionsService;
  built?: boolean;
  /**
   * Mount, AFTER the inbox router, the two routes from the comments router that
   * would shadow `/comments/inbox` if order were wrong: the `/comments/:id`
   * lookup (enabled mode) and the `/comments/*` catch-all (disabled mode). This
   * reproduces the production composition in plugin.ts so a reordering regression
   * is caught here.
   */
  mountCommentsShadow?: boolean;
}): Promise<BuildAppResult> {
  const knex = await databases.init("SQLITE_3");
  await knex.migrate.latest({
    directory: resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations"),
  });
  const commentStore = new CommentStore(knex);
  const inboxStore = new InboxStore(knex);
  const siteRefreshStore = makeSiteRefreshStore(opts?.built ?? false);

  const userInfo = opts?.userInfo ?? makeOwnerUserInfo(["group:default/bill"]);
  const permissions = opts?.permissions ?? makeAllowPermissions();

  const app = express();
  app.use(
    createInboxRouter({
      httpAuth: mockServices.httpAuth(),
      permissions,
      userInfo,
      store: inboxStore,
      commentStore,
      siteRefreshStore,
    }),
  );
  if (opts?.mountCommentsShadow) {
    const shadow = express.Router();
    shadow.get("/comments/:id", (_req, res) => res.status(404).json({ shadowed: "by-:id" }));
    shadow.all("/comments/*", (_req, res) => res.status(404).json({ shadowed: "by-catch-all" }));
    app.use(shadow);
  }
  app.use(
    MiddlewareFactory.create({
      logger: mockServices.logger.mock(),
      config: mockServices.rootConfig(),
    }).error(),
  );

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, () => r()));
  servers.push(server);
  return { server, commentStore, inboxStore, knex };
}

describe("inbox router", () => {
  const SITE_REF = "component:default/arch";
  const SECTION_REF = "section:default/root";
  const SECTION_PATH = "usage";
  const PAGE_REF = `${SECTION_REF}#guide`;

  it("GET /comments/inbox returns built:false when siteRefreshStore.anyBuilt() is false", async () => {
    const { server } = await buildApp({ built: false });
    const res = await request(server).get("/comments/inbox");
    expect(res.status).toBe(200);
    expect(res.body.built).toBe(false);
    expect(res.body.items).toEqual([]);
    expect(res.body.openCount).toBe(0);
    expect(res.body.unansweredCount).toBe(0);
  });

  it("GET /comments/inbox is reached even when the comments router's shadowing routes follow it", async () => {
    // Regression: in plugin.ts the comments router (with /comments/:id and a
    // /comments/* catch-all) is mounted AFTER the inbox router. If the order were
    // reversed, /comments/inbox would resolve to id="inbox" → 404. Assert the
    // inbox handler still wins under the production mount order.
    const { server } = await buildApp({ mountCommentsShadow: true });
    const res = await request(server).get("/comments/inbox");
    expect(res.status).toBe(200);
    expect(res.body.built).toBe(false);
    expect(res.body).not.toHaveProperty("shadowed");
  });

  it("GET /comments/inbox returns built:true when siteRefreshStore.anyBuilt() is true", async () => {
    const { server } = await buildApp({ built: true });
    const res = await request(server).get("/comments/inbox");
    expect(res.status).toBe(200);
    expect(res.body.built).toBe(true);
  });

  it("GET /comments/inbox returns owned open thread with correct entityRef, viewerPath, and pageTitle", async () => {
    const { server, knex } = await buildApp({ built: true });

    // Register effective ownership for group:default/bill
    await knex("sections").insert({
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      entity_ref: "component:default/arch",
      entity_owner_ref: "group:default/bill",
      section_path: SECTION_PATH,
    });

    // Seed a page title
    await knex("pages").insert({
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      subpath: "guide",
      title: "Architecture Guide",
    });

    // Seed a comment in that section
    const commentId = await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      page_ref: PAGE_REF,
    });

    const res = await request(server).get("/comments/inbox");
    expect(res.status).toBe(200);
    expect(res.body.built).toBe(true);
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item.commentId).toBe(commentId);
    expect(item.entityRef).toBe("component:default/arch");
    // section_path="usage" + subpath of "section:default/root#guide" = "guide" → "usage/guide"
    expect(item.viewerPath).toBe("usage/guide");
    expect(item.pageTitle).toBe("Architecture Guide");
    expect(item.siteRef).toBe(SITE_REF);
    expect(item.pageRef).toBe(PAGE_REF);
    expect(item.replyCount).toBe(0);
    expect(res.body.openCount).toBe(1);
  });

  it("GET /comments/inbox falls back pageTitle to viewerPath when no page title", async () => {
    const { server, knex } = await buildApp({ built: true });

    await knex("sections").insert({
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      entity_ref: "component:default/arch",
      entity_owner_ref: "group:default/bill",
      section_path: SECTION_PATH,
    });

    await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      page_ref: PAGE_REF,
    });

    const res = await request(server).get("/comments/inbox");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    // No page seeded → page_title is null → fallback to viewerPath
    expect(res.body.items[0].pageTitle).toBe("usage/guide");
  });

  it("GET /comments/inbox excludes a comment owned by another group", async () => {
    const { server, knex } = await buildApp({ built: true });

    // Register effective ownership for group:default/other (NOT bill)
    await knex("sections").insert({
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      entity_ref: "component:default/arch",
      entity_owner_ref: "group:default/other",
      section_path: SECTION_PATH,
    });

    await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
    });

    const res = await request(server).get("/comments/inbox");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it("GET /comments/inbox includes reply count for owned threads", async () => {
    const { server, knex } = await buildApp({ built: true });

    await knex("sections").insert({
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      entity_ref: "component:default/arch",
      entity_owner_ref: "group:default/bill",
      section_path: "",
    });

    const parentId = await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
    });
    // Two open replies are counted...
    await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      parent_id: parentId,
    });
    await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      parent_id: parentId,
    });
    // ...but a resolved reply and a soft-deleted reply are NOT (open/non-deleted filter).
    await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      parent_id: parentId,
      status: "resolved",
    });
    await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      parent_id: parentId,
      deleted_at: new Date(),
    });

    const res = await request(server).get("/comments/inbox");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].replyCount).toBe(2);
  });

  it("GET /comments/inbox returns 403 and checks rwCommentReadPermission when permissions DENY", async () => {
    const permissions = makeDenyPermissions();
    const { server } = await buildApp({ permissions });
    const res = await request(server).get("/comments/inbox");
    expect(res.status).toBe(403);
    expect(permissions.authorize).toHaveBeenCalledWith(
      [{ permission: rwCommentReadPermission }],
      expect.anything(),
    );
  });

  it("GET /comments/inbox returns items sorted newest updatedAt first", async () => {
    const { server, knex } = await buildApp({ built: true });

    const olderSectionRef = "section:default/older";
    const newerSectionRef = "section:default/newer";

    await knex("sections").insert([
      {
        site_ref: SITE_REF,
        section_ref: olderSectionRef,
        entity_ref: "component:default/arch",
        entity_owner_ref: "group:default/bill",
        section_path: "",
      },
      {
        site_ref: SITE_REF,
        section_ref: newerSectionRef,
        entity_ref: "component:default/arch",
        entity_owner_ref: "group:default/bill",
        section_path: "",
      },
    ]);

    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-06-01T00:00:00Z");

    await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: olderSectionRef,
      updated_at: older,
    });
    await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: newerSectionRef,
      updated_at: newer,
    });

    const res = await request(server).get("/comments/inbox");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    // First item should have the newer updatedAt
    expect(new Date(res.body.items[0].updatedAt).getTime()).toBeGreaterThan(
      new Date(res.body.items[1].updatedAt).getTime(),
    );
  });

  // ── Cursor-pagination tests ────────────────────────────────────────────────

  it("GET /comments/inbox?limit=2 returns pageInfo.nextCursor when more rows exist", async () => {
    const { server, knex } = await buildApp({ built: true });

    await knex("sections").insert({
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      entity_ref: "component:default/arch",
      entity_owner_ref: "group:default/bill",
      section_path: SECTION_PATH,
    });

    // Insert 3 comments so limit=2 leaves one behind
    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date("2026-03-01T00:00:00Z");
    const t3 = new Date("2026-06-01T00:00:00Z");
    await insertComment(knex, { site_ref: SITE_REF, section_ref: SECTION_REF, updated_at: t1 });
    await insertComment(knex, { site_ref: SITE_REF, section_ref: SECTION_REF, updated_at: t2 });
    await insertComment(knex, { site_ref: SITE_REF, section_ref: SECTION_REF, updated_at: t3 });

    const res = await request(server).get("/comments/inbox?limit=2");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(typeof res.body.openCount).toBe("number");
    expect(typeof res.body.unansweredCount).toBe("number");
    expect(typeof res.body.pageInfo.nextCursor).toBe("string");
  });

  it("GET /comments/inbox follow-up with nextCursor returns next slice with no id overlap", async () => {
    const { server, knex } = await buildApp({ built: true });

    await knex("sections").insert({
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      entity_ref: "component:default/arch",
      entity_owner_ref: "group:default/bill",
      section_path: SECTION_PATH,
    });

    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date("2026-03-01T00:00:00Z");
    const t3 = new Date("2026-06-01T00:00:00Z");
    await insertComment(knex, { site_ref: SITE_REF, section_ref: SECTION_REF, updated_at: t1 });
    await insertComment(knex, { site_ref: SITE_REF, section_ref: SECTION_REF, updated_at: t2 });
    await insertComment(knex, { site_ref: SITE_REF, section_ref: SECTION_REF, updated_at: t3 });

    // Page 1
    const page1 = await request(server).get("/comments/inbox?limit=2");
    expect(page1.status).toBe(200);
    const nextCursor = page1.body.pageInfo.nextCursor as string;
    const page1Ids = page1.body.items.map((i: { commentId: string }) => i.commentId);

    // Page 2
    const page2 = await request(server).get(`/comments/inbox?cursor=${nextCursor}`);
    expect(page2.status).toBe(200);
    expect(page2.body.items.length).toBeGreaterThan(0);
    const page2Ids = page2.body.items.map((i: { commentId: string }) => i.commentId);

    // No overlap
    const overlap = page1Ids.filter((id: string) => page2Ids.includes(id));
    expect(overlap).toHaveLength(0);

    // Counts are preserved in cursor
    expect(page2.body.openCount).toBe(page1.body.openCount);
    expect(page2.body.unansweredCount).toBe(page1.body.unansweredCount);

    // No more pages
    expect(page2.body.pageInfo).not.toHaveProperty("nextCursor");
  });

  it("GET /comments/inbox?filter=unanswered returns only unanswered items; counts carry both totals", async () => {
    const { server, knex } = await buildApp({ built: true });

    const answeredSection = "section:default/answered";
    const unansweredSection = "section:default/unanswered";

    await knex("sections").insert([
      {
        site_ref: SITE_REF,
        section_ref: answeredSection,
        entity_ref: "component:default/arch",
        entity_owner_ref: "group:default/bill",
        section_path: "",
      },
      {
        site_ref: SITE_REF,
        section_ref: unansweredSection,
        entity_ref: "component:default/arch",
        entity_owner_ref: "group:default/bill",
        section_path: "",
      },
    ]);

    // One thread with an open reply (answered), one without (unanswered)
    const answeredId = await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: answeredSection,
    });
    await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: answeredSection,
      parent_id: answeredId,
    });
    await insertComment(knex, { site_ref: SITE_REF, section_ref: unansweredSection });

    const res = await request(server).get("/comments/inbox?filter=unanswered");
    expect(res.status).toBe(200);
    // Only the unanswered thread
    expect(res.body.items).toHaveLength(1);
    // Both totals are present (openCount covers all open, not just unanswered)
    expect(res.body.openCount).toBe(2);
    expect(res.body.unansweredCount).toBe(1);
  });

  it("GET /comments/inbox cursor carries filter across pages (answered thread absent from both pages)", async () => {
    const { server, knex } = await buildApp({ built: true });

    const unansweredSection = "section:default/unans";
    const answeredSection = "section:default/ans";

    await knex("sections").insert([
      {
        site_ref: SITE_REF,
        section_ref: unansweredSection,
        entity_ref: "component:default/arch",
        entity_owner_ref: "group:default/bill",
        section_path: "",
      },
      {
        site_ref: SITE_REF,
        section_ref: answeredSection,
        entity_ref: "component:default/arch",
        entity_owner_ref: "group:default/bill",
        section_path: "",
      },
    ]);

    // Seed 3 unanswered threads and 1 answered thread
    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date("2026-03-01T00:00:00Z");
    const t3 = new Date("2026-05-01T00:00:00Z");
    const t4 = new Date("2026-06-01T00:00:00Z");

    // Three unanswered threads (no replies)
    await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: unansweredSection,
      updated_at: t1,
    });
    await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: unansweredSection,
      updated_at: t2,
    });
    await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: unansweredSection,
      updated_at: t3,
    });

    // One answered thread (has open reply)
    const answeredParent = await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: answeredSection,
      updated_at: t4,
    });
    await insertComment(knex, {
      site_ref: SITE_REF,
      section_ref: answeredSection,
      parent_id: answeredParent,
    });

    // Page 1: filter=unanswered, limit=2
    const page1 = await request(server).get("/comments/inbox?filter=unanswered&limit=2");
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(2);
    const nextCursor = page1.body.pageInfo.nextCursor as string;
    expect(typeof nextCursor).toBe("string");

    const page1Ids = page1.body.items.map((i: { commentId: string }) => i.commentId);
    expect(page1Ids).not.toContain(answeredParent);

    // Page 2: cursor carries the unanswered filter
    const page2 = await request(server).get(`/comments/inbox?cursor=${nextCursor}`);
    expect(page2.status).toBe(200);
    expect(page2.body.items.length).toBeGreaterThanOrEqual(1);
    const page2Ids = page2.body.items.map((i: { commentId: string }) => i.commentId);
    expect(page2Ids).not.toContain(answeredParent);

    // No overlap between pages
    const overlap = page1Ids.filter((id: string) => page2Ids.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it("GET /comments/inbox?cursor=garbage returns 400", async () => {
    const { server } = await buildApp({ built: true });
    const res = await request(server).get("/comments/inbox?cursor=garbage");
    expect(res.status).toBe(400);
  });

  it("GET /comments/inbox built:false response omits nextCursor from pageInfo", async () => {
    const { server } = await buildApp({ built: false });
    const res = await request(server).get("/comments/inbox");
    expect(res.status).toBe(200);
    expect(res.body.built).toBe(false);
    expect(res.body.pageInfo).not.toHaveProperty("nextCursor");
  });
});
