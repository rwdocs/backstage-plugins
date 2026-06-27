import { TestDatabases } from "@backstage/backend-test-utils";
import { resolvePackagePath } from "@backstage/backend-plugin-api";
import type { Knex } from "knex";
import { v7 as uuidv7 } from "uuid";
import { InboxStore } from "./InboxStore";
import { rawSortValue } from "./mapping";

jest.mock("@rwdocs/core", () => ({
  renderCommentBody: jest.fn(async (md: string) => `<p>${md}</p>`),
}));

const SITE_REF = "component:default/arch";
const SECTION_REF = "section:default/billing";
const OWNER_REF = "group:default/team";
const ENTITY_REF = "domain:default/billing";
const SECTION_PATH = "systems/billing";
const PAGE_REF = `${SECTION_REF}#tobe`;

async function freshStore(databases: TestDatabases): Promise<{ store: InboxStore; knex: Knex }> {
  const knex = await databases.init("SQLITE_3");
  const directory = resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations");
  await knex.migrate.latest({ directory });
  return { store: new InboxStore(knex), knex };
}

async function seedOwnership(knex: Knex): Promise<void> {
  await knex("sections").insert({
    site_ref: SITE_REF,
    section_ref: SECTION_REF,
    section_path: SECTION_PATH,
    parent_section_ref: null,
    entity_ref: ENTITY_REF,
    entity_owner_ref: OWNER_REF,
  });
}

async function seedPage(knex: Knex): Promise<void> {
  await knex("pages").insert({
    site_ref: SITE_REF,
    section_ref: SECTION_REF,
    subpath: "tobe",
    title: "To Be",
  });
}

async function seedComment(
  knex: Knex,
  overrides: Partial<{
    id: string;
    page_ref: string;
    section_ref: string;
    site_ref: string;
    status: string;
    parent_id: string | null;
    deleted_at: Date | null;
    author_ref: string;
    updated_at: Date;
  }> = {},
): Promise<string> {
  const id = overrides.id ?? uuidv7();
  await knex("comments").insert({
    id,
    site_ref: overrides.site_ref ?? SITE_REF,
    page_ref: overrides.page_ref ?? PAGE_REF,
    section_ref: overrides.section_ref ?? SECTION_REF,
    parent_id: overrides.parent_id ?? null,
    author_ref: overrides.author_ref ?? "user:default/alice",
    author_profile: null,
    body: "hello",
    body_html: "<p>hello</p>",
    selectors: "[]",
    status: overrides.status ?? "open",
    created_at: new Date(),
    updated_at: overrides.updated_at ?? new Date(),
    resolved_at: null,
    resolved_by: null,
    deleted_at: overrides.deleted_at ?? null,
  });
  return id;
}

/** Seeds a top-level thread with optional open replies. Returns the thread id. */
async function seedThread(
  knex: Knex,
  updatedAt: Date,
  opts: { replies?: Array<{ status?: string; deleted_at?: Date | null }> } = {},
): Promise<string> {
  const id = await seedComment(knex, { updated_at: updatedAt });
  for (const r of opts.replies ?? []) {
    await seedComment(knex, {
      parent_id: id,
      status: r.status ?? "open",
      deleted_at: r.deleted_at ?? null,
    });
  }
  return id;
}

describe("InboxStore", () => {
  const databases = TestDatabases.create({ ids: ["SQLITE_3"] });

  it("returns owned open threads with entity_ref, relative path, and title", async () => {
    const { store, knex } = await freshStore(databases);
    await seedOwnership(knex);
    await seedPage(knex);
    await seedComment(knex);

    const { rows } = await store.ownedOpenThreadsPage([OWNER_REF], {
      filter: "open",
      sort: "newest",
      limit: 1000,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].entity_ref).toBe(ENTITY_REF);
    expect(rows[0].section_path).toBe(SECTION_PATH);
    expect(rows[0].page_title).toBe("To Be");
  });

  it("excludes threads owned by others, replies, resolved, and deleted", async () => {
    const { store, knex } = await freshStore(databases);

    // Seed ownership for the in-group owner AND a different owner
    await seedOwnership(knex);
    await knex("sections").insert({
      site_ref: SITE_REF,
      section_ref: "section:default/other",
      section_path: "other",
      parent_section_ref: null,
      entity_ref: "domain:default/other",
      entity_owner_ref: "group:default/other-team",
    });

    // Seed a valid open top-level comment
    const goodId = await seedComment(knex, { id: "the-open-top-level-id" });

    // Reply (parent_id set) — should be excluded
    await seedComment(knex, { parent_id: "the-open-top-level-id" });

    // Resolved — should be excluded
    await seedComment(knex, { status: "resolved" });

    // Deleted — should be excluded
    await seedComment(knex, { deleted_at: new Date() });

    // Other-owner section — should be excluded
    await seedComment(knex, {
      section_ref: "section:default/other",
      page_ref: "section:default/other#x",
    });

    const { rows } = await store.ownedOpenThreadsPage([OWNER_REF], {
      filter: "open",
      sort: "newest",
      limit: 1000,
    });
    expect(rows.map((r) => r.id)).toEqual([goodId]);
  });

  it("returns page_title null when no matching page row exists", async () => {
    const { store, knex } = await freshStore(databases);
    await seedOwnership(knex);
    // Seed a comment but deliberately omit the pages row.
    await seedComment(knex);

    const { rows } = await store.ownedOpenThreadsPage([OWNER_REF], {
      filter: "open",
      sort: "newest",
      limit: 1000,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].page_title).toBeNull();
  });

  it("returns [] for empty ownerRefs", async () => {
    const { store } = await freshStore(databases);
    expect(
      (await store.ownedOpenThreadsPage([], { filter: "open", sort: "newest", limit: 1000 })).rows,
    ).toEqual([]);
  });

  it("handles >333 distinct page keys without hitting the SQLite 999-variable limit", async () => {
    // Each pages row lookup uses 3 bind params (site_ref, section_ref, subpath).
    // 334 keys × 3 = 1002 params > SQLite's 999-variable limit, so this test proves
    // the chunked titlesFor path works correctly.
    const { store, knex } = await freshStore(databases);

    // One section owned by OWNER_REF with 334 distinct subpaths.
    await seedOwnership(knex);

    const COUNT = 334;
    const pageRows = Array.from({ length: COUNT }, (_, n) => ({
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      subpath: `subpath-${n}`,
      title: `Title ${n}`,
    }));
    await knex("pages").insert(pageRows);

    const commentRows = Array.from({ length: COUNT }, (_, n) => ({
      id: `comment-${n}-${uuidv7()}`,
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      page_ref: `${SECTION_REF}#subpath-${n}`,
      parent_id: null,
      author_ref: "user:default/alice",
      author_profile: null,
      body: "hello",
      body_html: "<p>hello</p>",
      selectors: "[]",
      status: "open",
      created_at: new Date(),
      updated_at: new Date(),
      resolved_at: null,
      resolved_by: null,
      deleted_at: null,
    }));
    await knex("comments").insert(commentRows);

    let rows: Awaited<ReturnType<typeof store.ownedOpenThreadsPage>>["rows"];
    await expect(
      (async () => {
        rows = (
          await store.ownedOpenThreadsPage([OWNER_REF], {
            filter: "open",
            sort: "newest",
            limit: 1000,
          })
        ).rows;
      })(),
    ).resolves.not.toThrow();
    expect(rows!).toHaveLength(COUNT);
    // Spot-check: every row has a title (no nulls due to chunking errors)
    expect(rows!.every((r) => r.page_title !== null)).toBe(true);
  });
});

const OWNERS = [OWNER_REF];

describe("ownedOpenThreadsPage", () => {
  const databases2 = TestDatabases.create({ ids: ["SQLITE_3"] });

  it("returns a page of limit rows newest-first with hasMore when more remain", async () => {
    const { store, knex } = await freshStore(databases2);
    await seedOwnership(knex);

    await seedThread(knex, new Date("2024-01-01T00:00:00Z"));
    const t2 = await seedThread(knex, new Date("2024-01-02T00:00:00Z"));
    const t3 = await seedThread(knex, new Date("2024-01-03T00:00:00Z"));

    const page = await store.ownedOpenThreadsPage(OWNERS, {
      filter: "open",
      sort: "newest",
      limit: 2,
    });
    expect(page.rows.map((r) => r.id)).toEqual([t3, t2]);
    expect(page.hasMore).toBe(true);
  });

  it("seeks past the cursor key on the next page", async () => {
    const { store, knex } = await freshStore(databases2);
    await seedOwnership(knex);

    const t1 = await seedThread(knex, new Date("2024-01-01T00:00:00Z"));
    await seedThread(knex, new Date("2024-01-02T00:00:00Z"));
    await seedThread(knex, new Date("2024-01-03T00:00:00Z"));

    const first = await store.ownedOpenThreadsPage(OWNERS, {
      filter: "open",
      sort: "newest",
      limit: 2,
    });
    const last = first.rows[first.rows.length - 1];
    const next = await store.ownedOpenThreadsPage(OWNERS, {
      filter: "open",
      sort: "newest",
      limit: 2,
      lastKey: [rawSortValue(last.updated_at), last.id],
    });
    expect(next.rows.map((r) => r.id)).toEqual([t1]);
    expect(next.hasMore).toBe(false);
  });

  it("breaks ties on id when updated_at is equal", async () => {
    const { store, knex } = await freshStore(databases2);
    await seedOwnership(knex);

    const sharedAt = new Date("2024-06-15T12:00:00Z");
    // newest-first desc sort: higher id wins → idA ("zzzzz") sorts before idB ("aaaaa")
    const idA = "zzzzz-thread-a";
    const idB = "aaaaa-thread-b";
    await seedComment(knex, { id: idA, updated_at: sharedAt });
    await seedComment(knex, { id: idB, updated_at: sharedAt });

    const first = await store.ownedOpenThreadsPage(OWNERS, {
      filter: "open",
      sort: "newest",
      limit: 1,
    });
    // Page 1: idA sorts first (desc id tiebreak)
    expect(first.rows[0].id).toBe(idA);

    const next = await store.ownedOpenThreadsPage(OWNERS, {
      filter: "open",
      sort: "newest",
      limit: 1,
      lastKey: [rawSortValue(first.rows[0].updated_at), first.rows[0].id],
    });
    // Page 2: idB is the only remaining row
    expect(next.rows[0].id).toBe(idB);
    expect(next.rows).toHaveLength(1);
  });

  it("filter=unanswered excludes threads with an open reply", async () => {
    const { store, knex } = await freshStore(databases2);
    await seedOwnership(knex);

    const now = new Date("2024-06-15T12:00:00Z");
    // Thread with an open reply — should be excluded by unanswered filter
    const answeredThread = await seedThread(knex, now, { replies: [{ status: "open" }] });
    // Thread with no replies — should appear
    const unansweredThread = await seedThread(knex, now);
    // Thread with only a deleted reply — should appear (deleted reply doesn't count)
    const onlyDeletedReply = await seedThread(knex, now, {
      replies: [{ deleted_at: new Date() }],
    });
    // Thread with only a resolved reply — should appear (resolved reply doesn't count)
    const onlyResolvedReply = await seedThread(knex, now, { replies: [{ status: "resolved" }] });

    const page = await store.ownedOpenThreadsPage(OWNERS, {
      filter: "unanswered",
      sort: "newest",
      limit: 10,
    });
    const ids = page.rows.map((r) => r.id);
    expect(ids).toContain(unansweredThread);
    expect(ids).toContain(onlyDeletedReply);
    expect(ids).toContain(onlyResolvedReply);
    expect(ids).not.toContain(answeredThread);
  });

  it("sorts oldest-first and seeks forward", async () => {
    const { store, knex } = await freshStore(databases2);
    await seedOwnership(knex);

    const t1 = await seedThread(knex, new Date("2024-01-01T00:00:00Z"));
    const t2 = await seedThread(knex, new Date("2024-01-02T00:00:00Z"));
    await seedThread(knex, new Date("2024-01-03T00:00:00Z"));

    const page = await store.ownedOpenThreadsPage(OWNERS, {
      filter: "open",
      sort: "oldest",
      limit: 2,
    });
    expect(page.rows.map((r) => r.id)).toEqual([t1, t2]);
  });

  it("oldest-first second page: seek past lastKey of page 1 (exercises op='>' branch)", async () => {
    const { store, knex } = await freshStore(databases2);
    await seedOwnership(knex);

    const t1 = await seedThread(knex, new Date("2024-01-01T00:00:00Z"));
    const t2 = await seedThread(knex, new Date("2024-01-02T00:00:00Z"));
    const t3 = await seedThread(knex, new Date("2024-01-03T00:00:00Z"));

    // Page 1: oldest first, limit 2 → [t1, t2]
    const first = await store.ownedOpenThreadsPage(OWNERS, {
      filter: "open",
      sort: "oldest",
      limit: 2,
    });
    expect(first.rows.map((r) => r.id)).toEqual([t1, t2]);
    expect(first.hasMore).toBe(true);

    // Page 2: seek past t2's key → [t3], hasMore false
    const lastRow = first.rows[first.rows.length - 1];
    const next = await store.ownedOpenThreadsPage(OWNERS, {
      filter: "open",
      sort: "oldest",
      limit: 2,
      lastKey: [rawSortValue(lastRow.updated_at), lastRow.id],
    });
    expect(next.rows.map((r) => r.id)).toEqual([t3]);
    expect(next.hasMore).toBe(false);
  });

  it("returns empty page for no owners", async () => {
    const { store } = await freshStore(databases2);
    expect(
      await store.ownedOpenThreadsPage([], { filter: "open", sort: "newest", limit: 10 }),
    ).toEqual({
      rows: [],
      hasMore: false,
    });
  });
});

describe("counts", () => {
  const databases3 = TestDatabases.create({ ids: ["SQLITE_3"] });

  it("returns open and unanswered totals", async () => {
    const { store, knex } = await freshStore(databases3);
    await seedOwnership(knex);

    const now = new Date("2024-06-15T12:00:00Z");
    // 3 open threads total:
    // - one with an open reply (answered)
    // - two with no open reply (unanswered)
    await seedThread(knex, now, { replies: [{ status: "open" }] }); // answered
    await seedThread(knex, now); // unanswered
    await seedThread(knex, now, { replies: [{ status: "resolved" }] }); // unanswered (resolved reply)

    const { openCount, unansweredCount } = await store.counts(OWNERS);
    expect(openCount).toBe(3);
    expect(unansweredCount).toBe(2);
  });

  it("excludes resolved and soft-deleted threads from both counts", async () => {
    const { store, knex } = await freshStore(databases3);
    await seedOwnership(knex);

    const now = new Date("2024-06-15T12:00:00Z");
    // Baseline: 1 open unanswered thread (establishes a non-zero starting point)
    await seedThread(knex, now);

    // These must NOT increment either count:
    await seedComment(knex, { status: "resolved", updated_at: now }); // resolved top-level
    await seedComment(knex, { deleted_at: new Date(), updated_at: now }); // soft-deleted top-level

    const { openCount, unansweredCount } = await store.counts(OWNERS);
    // Only the baseline thread counts
    expect(openCount).toBe(1);
    expect(unansweredCount).toBe(1);
  });

  it("returns zeros for no owners", async () => {
    const { store } = await freshStore(databases3);
    expect(await store.counts([])).toEqual({ openCount: 0, unansweredCount: 0 });
  });
});
