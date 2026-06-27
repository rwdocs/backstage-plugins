import { TestDatabases } from "@backstage/backend-test-utils";
import { resolvePackagePath } from "@backstage/backend-plugin-api";
import type { Knex } from "knex";
import { CommentStore } from "./CommentStore";
import { toIso } from "./timestamps";

jest.mock("@rwdocs/core", () => ({
  renderCommentBody: jest.fn(async (md: string) => `<p>${md}</p>`),
}));

const ARCH = "component:default/arch";
const ROOT_PAGE = "section:default/root#guide/intro";

async function freshStore(databases: TestDatabases): Promise<{ store: CommentStore; knex: Knex }> {
  const knex = await databases.init("SQLITE_3");
  const directory = resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations");
  await knex.migrate.latest({ directory });
  return { store: new CommentStore(knex), knex };
}

describe("CommentStore read core", () => {
  const databases = TestDatabases.create({ ids: ["SQLITE_3"] });

  it("create stores a row, renders body_html, and stores section_ref verbatim", async () => {
    const { store } = await freshStore(databases);
    const row = await store.create(ARCH, {
      pageRef: ROOT_PAGE,
      authorRef: "user:default/alice",
      authorProfile: { displayName: "Alice" },
      body: "hello",
      selectors: [],
    });
    expect(row.id).toMatch(/[0-9a-f-]{36}/);
    expect(row.site_ref).toBe(ARCH);
    expect(row.page_ref).toBe(ROOT_PAGE);
    expect(row.section_ref).toBe("section:default/root"); // verbatim; old code collapsed root → site_ref (ARCH)
    expect(row.body_html).toBe("<p>hello</p>");
    expect(row.status).toBe("open");
  });

  it("create stores section_ref verbatim for an embedded section", async () => {
    const { store } = await freshStore(databases);
    const row = await store.create(ARCH, {
      pageRef: "domain:default/billing#overview",
      authorRef: "user:default/alice",
      body: "x",
      selectors: [],
    });
    expect(row.section_ref).toBe("domain:default/billing");
  });

  it("list returns the full thread for a page, ORDER BY created_at ASC", async () => {
    const { store } = await freshStore(databases);
    const a = await store.create(ARCH, {
      pageRef: ROOT_PAGE,
      authorRef: "user:default/a",
      body: "1",
      selectors: [],
    });
    const b = await store.create(ARCH, {
      pageRef: ROOT_PAGE,
      authorRef: "user:default/b",
      body: "2",
      selectors: [],
    });
    const rows = await store.list(ARCH, { pageRef: ROOT_PAGE });
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id]);
  });

  it("list scopes by site_ref (synthetic-root collision avoided)", async () => {
    const { store } = await freshStore(databases);
    await store.create(ARCH, {
      pageRef: ROOT_PAGE,
      authorRef: "user:default/a",
      body: "arch",
      selectors: [],
    });
    await store.create("component:default/other", {
      pageRef: ROOT_PAGE,
      authorRef: "user:default/a",
      body: "other",
      selectors: [],
    });
    const rows = await store.list(ARCH, { pageRef: ROOT_PAGE });
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe("arch");
  });

  it("list returns same-created_at rows in id-ascending order (deterministic tiebreaker)", async () => {
    const { store, knex } = await freshStore(databases);
    const t = new Date("2024-01-01T00:00:00.000Z");
    const a = await store.create(ARCH, {
      pageRef: ROOT_PAGE,
      authorRef: "user:default/a",
      body: "first",
      selectors: [],
    });
    const b = await store.create(ARCH, {
      pageRef: ROOT_PAGE,
      authorRef: "user:default/b",
      body: "second",
      selectors: [],
    });
    // Force identical created_at so only the id tiebreaker determines order.
    await knex("comments").where({ id: a.id }).update({ created_at: t });
    await knex("comments").where({ id: b.id }).update({ created_at: t });
    const rows = await store.list(ARCH, { pageRef: ROOT_PAGE });
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id]); // uuid v7 is time-ordered, a was created first
  });

  it("get returns by global id without a siteRef", async () => {
    const { store } = await freshStore(databases);
    const row = await store.create(ARCH, {
      pageRef: ROOT_PAGE,
      authorRef: "user:default/a",
      body: "x",
      selectors: [],
    });
    const got = await store.get(row.id);
    expect(got?.id).toBe(row.id);
    expect(await store.get("00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });
});

describe("CommentStore mutations", () => {
  const databases = TestDatabases.create({ ids: ["SQLITE_3"] });

  it("resolve stamps resolved_at + resolved_by; reopen clears both", async () => {
    const { store } = await freshStore(databases);
    const c = await store.create(ARCH, {
      pageRef: ROOT_PAGE,
      authorRef: "user:default/a",
      body: "x",
      selectors: [],
    });

    const resolved = await store.update(c.id, {
      status: "resolved",
      resolverRef: "user:default/bob",
    });
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolved_by).toBe("user:default/bob"); // may differ from author
    expect(resolved?.resolved_at).not.toBeNull();

    const reopened = await store.update(c.id, { status: "open" });
    expect(reopened?.status).toBe("open");
    expect(reopened?.resolved_at).toBeNull();
    expect(reopened?.resolved_by).toBeNull();
  });

  it("idempotent re-resolve keeps the original resolved_at/resolved_by", async () => {
    const { store } = await freshStore(databases);
    const c = await store.create(ARCH, {
      pageRef: ROOT_PAGE,
      authorRef: "user:default/a",
      body: "x",
      selectors: [],
    });
    const first = await store.update(c.id, { status: "resolved", resolverRef: "user:default/bob" });
    const again = await store.update(c.id, {
      status: "resolved",
      resolverRef: "user:default/carol",
    });
    expect(again?.resolved_by).toBe("user:default/bob"); // unchanged
    expect(again?.resolved_at).toEqual(first?.resolved_at); // original resolution timestamp preserved
  });

  it("a body change re-renders body_html and bumps updated_at", async () => {
    const { store } = await freshStore(databases);
    const c = await store.create(ARCH, {
      pageRef: ROOT_PAGE,
      authorRef: "user:default/a",
      body: "x",
      selectors: [],
    });
    // Capture updated_at timestamp before the update (as ISO string for cross-driver comparison).
    const beforeIso = toIso(c.updated_at)!;
    const beforeMs = Date.parse(beforeIso);

    // Delay 1 ms so the DB clock can advance.
    await new Promise((r) => setTimeout(r, 1));

    const updated = await store.update(c.id, { body: "changed" });
    expect(updated?.body).toBe("changed");
    expect(updated?.body_html).toBe("<p>changed</p>");

    const afterIso = toIso(updated!.updated_at)!;
    const afterMs = Date.parse(afterIso);
    expect(afterMs).toBeGreaterThanOrEqual(beforeMs + 1);
  });

  it("softDelete sets deleted_at (and list excludes it); restore clears it", async () => {
    const { store } = await freshStore(databases);
    const reply = await store.create(ARCH, {
      pageRef: ROOT_PAGE,
      parentId: "p",
      authorRef: "user:default/a",
      body: "r",
      selectors: [],
    });
    await store.softDelete(reply.id);
    expect(await store.list(ARCH, { pageRef: ROOT_PAGE })).toHaveLength(0);
    const restored = await store.restore(reply.id);
    expect(restored?.deleted_at).toBeNull();
    expect(await store.list(ARCH, { pageRef: ROOT_PAGE })).toHaveLength(1);
  });

  it("softDelete on an already-deleted row returns undefined and does not bump updated_at", async () => {
    const { store } = await freshStore(databases);
    const reply = await store.create(ARCH, {
      pageRef: ROOT_PAGE,
      parentId: "p",
      authorRef: "user:default/a",
      body: "r",
      selectors: [],
    });
    const first = await store.softDelete(reply.id);
    expect(first?.deleted_at).not.toBeNull();
    const firstUpdatedIso = toIso(first!.updated_at)!;

    // Delay so the DB clock would advance if a second write occurred.
    await new Promise((r) => setTimeout(r, 5));

    const second = await store.softDelete(reply.id);
    expect(second).toBeUndefined();

    // The row's updated_at must NOT have moved — the second delete was a no-op.
    const after = await store.get(reply.id);
    expect(toIso(after!.updated_at)).toBe(firstUpdatedIso);
  });

  it("restore on a non-deleted row returns undefined", async () => {
    const { store } = await freshStore(databases);
    const reply = await store.create(ARCH, {
      pageRef: ROOT_PAGE,
      parentId: "p",
      authorRef: "user:default/a",
      body: "r",
      selectors: [],
    });
    expect(await store.restore(reply.id)).toBeUndefined();
  });

  it("two racing soft-deletes: exactly one wins, the other sees undefined", async () => {
    const { store } = await freshStore(databases);
    const reply = await store.create(ARCH, {
      pageRef: ROOT_PAGE,
      parentId: "p",
      authorRef: "user:default/a",
      body: "r",
      selectors: [],
    });

    const race = async () =>
      store.transaction(async (tx) => {
        // Lock the row so one transaction blocks until the other commits — this
        // serialises the two writers.  The inline deleted_at guard is intentionally
        // absent: softDelete's own whereNull("deleted_at") is the only thing that
        // decides which racer wins.
        await store.get(reply.id, { executor: tx, forUpdate: true });
        return store.softDelete(reply.id, tx);
      });

    const [a, b] = await Promise.all([race(), race()]);
    const results = [a, b];
    const winners = results.filter((r) => r !== undefined);
    const losers = results.filter((r) => r === undefined);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(winners[0]!.deleted_at).not.toBeNull();
  });
});

describe("participantsOf", () => {
  const databases = TestDatabases.create({ ids: ["SQLITE_3"] });

  it("returns distinct authors across the root and its replies", async () => {
    const { store } = await freshStore(databases);
    const root = await store.create("component:default/s", {
      pageRef: "sec#a",
      authorRef: "user:default/alice",
      body: "root",
      selectors: [],
    });
    await store.create("component:default/s", {
      pageRef: "sec#a",
      parentId: root.id,
      authorRef: "user:default/bob",
      body: "reply 1",
      selectors: [],
    });
    await store.create("component:default/s", {
      pageRef: "sec#a",
      parentId: root.id,
      authorRef: "user:default/alice", // duplicate author — must dedupe
      body: "reply 2",
      selectors: [],
    });
    const participants = await store.participantsOf(root.id);
    // creation order: alice (root) then bob (reply); alice's later reply is deduped
    expect(participants).toEqual(["user:default/alice", "user:default/bob"]);
  });

  it("returns just the root author for a reply-less thread", async () => {
    const { store } = await freshStore(databases);
    const root = await store.create("component:default/s", {
      pageRef: "sec#a",
      authorRef: "user:default/alice",
      body: "root",
      selectors: [],
    });
    expect(await store.participantsOf(root.id)).toEqual(["user:default/alice"]);
  });

  it("excludes soft-deleted replies' authors", async () => {
    const { store } = await freshStore(databases);
    const root = await store.create("component:default/s", {
      pageRef: "sec#a",
      authorRef: "user:default/alice",
      body: "root",
      selectors: [],
    });
    const reply = await store.create("component:default/s", {
      pageRef: "sec#a",
      parentId: root.id,
      authorRef: "user:default/carol",
      body: "reply",
      selectors: [],
    });
    await store.softDelete(reply.id);
    expect(await store.participantsOf(root.id)).toEqual(["user:default/alice"]);
  });
});
