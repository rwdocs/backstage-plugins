import { TestDatabases } from "@backstage/backend-test-utils";
import { resolvePackagePath } from "@backstage/backend-plugin-api";
import { parseEntityRef } from "@backstage/catalog-model";
import type { Knex } from "knex";
import { v7 as uuidv7 } from "uuid";
import { CommentActivityResolver } from "./CommentActivityResolver";
import { CommentStore } from "./CommentStore";
import { SectionsReader } from "../siteIndex/SectionsReader";
import { PagesReader } from "../siteIndex/PagesReader";

jest.mock("@rwdocs/core", () => ({
  renderCommentBody: jest.fn(async (md: string) => `<p>${md}</p>`),
}));

const SITE_REF = "component:default/arch";
const SECTION_REF = "section:default/root";
const SECTION_PATH = "guide";
const ENTITY_REF = "component:default/arch";
const ENTITY_OWNER_REF = "group:default/owners";
const PAGE_SUBPATH = "intro";
const PAGE_REF = `${SECTION_REF}#${PAGE_SUBPATH}`;
const PAGE_TITLE = "Introduction";
const SECTION_TITLE = "Guide";

async function freshResolver(databases: TestDatabases): Promise<{
  resolver: CommentActivityResolver;
  knex: Knex;
  catalog: jest.Mocked<{ getEntityByRef: jest.Mock }>;
  auth: jest.Mocked<{ getOwnServiceCredentials: jest.Mock }>;
}> {
  const knex = await databases.init("SQLITE_3");
  const directory = resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations");
  await knex.migrate.latest({ directory });

  // Seed sections table
  await knex("sections").insert({
    site_ref: SITE_REF,
    section_ref: SECTION_REF,
    section_path: SECTION_PATH,
    parent_section_ref: null,
    entity_ref: ENTITY_REF,
    entity_owner_ref: ENTITY_OWNER_REF,
  });

  // Seed pages table — one page (subpath) and the section root (empty subpath)
  await knex("pages").insert([
    {
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      subpath: PAGE_SUBPATH,
      title: PAGE_TITLE,
    },
    {
      site_ref: SITE_REF,
      section_ref: SECTION_REF,
      subpath: "",
      title: SECTION_TITLE,
    },
  ]);

  const catalog = { getEntityByRef: jest.fn() } as any;
  const auth = { getOwnServiceCredentials: jest.fn().mockResolvedValue({}) } as any;
  const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;

  const resolver = new CommentActivityResolver({
    sections: new SectionsReader(knex),
    pages: new PagesReader(knex),
    comments: new CommentStore(knex),
    catalog,
    auth,
    logger,
  });

  return { resolver, knex, catalog, auth };
}

function makeCommentRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: uuidv7(),
    parent_id: null,
    site_ref: SITE_REF,
    page_ref: PAGE_REF,
    section_ref: SECTION_REF,
    author_ref: "user:default/jane",
    author_profile: JSON.stringify({ displayName: "Jane Doe" }),
    body: "Hello world",
    body_html: "<p>Hello world</p>",
    selectors: "[]",
    status: "open",
    created_at: now,
    updated_at: now,
    resolved_at: null,
    resolved_by: null,
    deleted_at: null,
    ...overrides,
  };
}

describe("CommentActivityResolver", () => {
  const databases = TestDatabases.create({ ids: ["SQLITE_3"] });

  it("case 1: created top-level with author_profile displayName", async () => {
    const { resolver, knex, catalog } = await freshResolver(databases);
    const row = makeCommentRow({ author_profile: JSON.stringify({ displayName: "Jane Doe" }) });
    await knex("comments").insert(row);

    const activity = await resolver.resolve("created", row as any, row.author_ref as string);

    expect(activity).toBeDefined();
    expect(activity!.action).toBe("created");
    expect(activity!.commentId).toBe(row.id);
    expect(activity!.rootId).toBe(row.id); // top-level: rootId = id
    expect(activity!.parentId).toBeNull();
    expect(activity!.actorName).toBe("Jane Doe");
    expect(activity!.participants).toEqual(["user:default/jane"]);
    expect(activity!.sectionOwnerRef).toBe(ENTITY_OWNER_REF);
    expect(activity!.entityRef).toBe(ENTITY_REF);
    expect(activity!.viewerPath).toBe(`${SECTION_PATH}/${PAGE_SUBPATH}`);
    expect(activity!.bodySnippet).toBe("Hello world");
    expect(activity!.pageTitle).toBe(PAGE_TITLE);
    expect(activity!.sectionTitle).toBe(SECTION_TITLE);
    expect(catalog.getEntityByRef).not.toHaveBeenCalled();
  });

  it("case 2: created with author_profile null falls back to ref name", async () => {
    const { resolver, knex } = await freshResolver(databases);
    const row = makeCommentRow({ author_profile: null });
    await knex("comments").insert(row);

    const activity = await resolver.resolve("created", row as any, row.author_ref as string);

    expect(activity).toBeDefined();
    expect(activity!.actorName).toBe(parseEntityRef(row.author_ref as string).name);
  });

  it("case 3: deleted_at set on trigger row returns undefined", async () => {
    const { resolver, knex } = await freshResolver(databases);
    const now = new Date().toISOString();
    const row = makeCommentRow({ deleted_at: now });
    await knex("comments").insert(row);

    const activity = await resolver.resolve("created", row as any, row.author_ref as string);

    expect(activity).toBeUndefined();
  });

  it("case 4: resolved path calls catalog and returns resolved actorName", async () => {
    const { resolver, knex, catalog, auth } = await freshResolver(databases);
    const row = makeCommentRow({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: "user:default/carol",
    });
    await knex("comments").insert(row);

    catalog.getEntityByRef.mockResolvedValue({
      spec: { profile: { displayName: "Carol R" } },
      metadata: {},
    });

    const activity = await resolver.resolve("resolved", row as any, "user:default/carol");

    expect(activity).toBeDefined();
    expect(activity!.action).toBe("resolved");
    expect(activity!.rootId).toBe(row.id);
    expect(activity!.actorName).toBe("Carol R");
    expect(catalog.getEntityByRef).toHaveBeenCalledWith("user:default/carol", expect.anything());
    expect(auth.getOwnServiceCredentials).toHaveBeenCalled();
  });

  it("case 5: a participantsOf failure degrades to [] and does not suppress the owner notification", async () => {
    const { knex, catalog, auth } = await freshResolver(databases);
    const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
    // A top-level create's owner notification depends on the section, not on participants;
    // a transient participants read failure must not reject the whole resolve.
    const resolver = new CommentActivityResolver({
      sections: new SectionsReader(knex),
      pages: new PagesReader(knex),
      comments: { participantsOf: jest.fn().mockRejectedValue(new Error("db down")) } as any,
      catalog: catalog as any,
      auth: auth as any,
      logger,
    });
    const row = makeCommentRow();

    const activity = await resolver.resolve("created", row as any, row.author_ref as string);

    expect(activity).toBeDefined();
    expect(activity!.participants).toEqual([]);
    expect(activity!.sectionOwnerRef).toBe(ENTITY_OWNER_REF); // owner fields unaffected
    expect(logger.warn).toHaveBeenCalled();
  });

  it("case 6: a section read failure degrades to a null section without suppressing a reply notification", async () => {
    const { knex, catalog, auth } = await freshResolver(databases);
    const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
    // A reply's recipients come from participants, not the section; a transient sections read
    // failure must degrade to a null section (no deep link) rather than rejecting the resolve and
    // dropping a notification the participants were already resolved for.
    const resolver = new CommentActivityResolver({
      sections: { getSection: jest.fn().mockRejectedValue(new Error("db down")) } as any,
      pages: new PagesReader(knex),
      comments: new CommentStore(knex),
      catalog: catalog as any,
      auth: auth as any,
      logger,
    });
    const root = makeCommentRow();
    await knex("comments").insert(root);
    const reply = makeCommentRow({
      parent_id: root.id,
      author_ref: "user:default/bob",
      author_profile: JSON.stringify({ displayName: "Bob" }),
    });
    await knex("comments").insert(reply);

    const activity = await resolver.resolve("created", reply as any, reply.author_ref as string);

    expect(activity).toBeDefined();
    expect(activity!.rootId).toBe(root.id); // reply: rootId = parent_id
    expect(activity!.participants).toEqual(
      expect.arrayContaining(["user:default/jane", "user:default/bob"]),
    );
    expect(activity!.sectionOwnerRef).toBeNull();
    expect(activity!.entityRef).toBeNull();
    expect(activity!.viewerPath).toBe(PAGE_SUBPATH); // bare subpath: no section prefix
    expect(logger.warn).toHaveBeenCalled();
  });

  it("case 7: a section-root comment reads the page title once and reuses it for both fields", async () => {
    const { knex, catalog, auth } = await freshResolver(databases);
    const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
    const getTitle = jest.fn().mockResolvedValue(SECTION_TITLE);
    const resolver = new CommentActivityResolver({
      sections: new SectionsReader(knex),
      pages: { getTitle } as any,
      comments: new CommentStore(knex),
      catalog: catalog as any,
      auth: auth as any,
      logger,
    });
    // page_ref with no "#" → empty subpath (comment on the section root)
    const row = makeCommentRow({ page_ref: SECTION_REF });
    await knex("comments").insert(row);

    const activity = await resolver.resolve("created", row as any, row.author_ref as string);

    expect(activity).toBeDefined();
    expect(activity!.pageTitle).toBe(SECTION_TITLE);
    expect(activity!.sectionTitle).toBe(SECTION_TITLE);
    expect(getTitle).toHaveBeenCalledTimes(1); // deduped: one read for the section root
    expect(getTitle).toHaveBeenCalledWith(SITE_REF, SECTION_REF, "");
  });
});
