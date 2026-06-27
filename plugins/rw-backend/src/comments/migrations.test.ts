import { TestDatabases } from "@backstage/backend-test-utils";
import { resolvePackagePath } from "@backstage/backend-plugin-api";

describe("comments migration", () => {
  const databases = TestDatabases.create({ ids: ["SQLITE_3"] });

  it("creates the comments table with the expected columns", async () => {
    const knex = await databases.init("SQLITE_3");
    const directory = resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations");
    await knex.migrate.latest({ directory });

    expect(await knex.schema.hasTable("comments")).toBe(true);
    for (const col of [
      "id",
      "site_ref",
      "page_ref",
      "section_ref",
      "parent_id",
      "author_ref",
      "author_profile",
      "body",
      "body_html",
      "selectors",
      "status",
      "created_at",
      "updated_at",
      "resolved_at",
      "resolved_by",
      "deleted_at",
    ]) {
      expect(await knex.schema.hasColumn("comments", col)).toBe(true);
    }
  });

  it("creates the page-scoped composite indexes referencing page_ref", async () => {
    // Guards the squashed baseline: the two composite indexes the inbox/page
    // queries rely on must exist under their page_ref names. A future knex/SQLite
    // change silently dropping them would turn those reads into full table scans.
    const knex = await databases.init("SQLITE_3");
    const directory = resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations");
    await knex.migrate.latest({ directory });

    const indexes: Array<{ name: string; sql: string | null }> = await knex
      .from("sqlite_master")
      .where({ type: "index", tbl_name: "comments" })
      .select("name", "sql");
    const byName = new Map(indexes.map((i) => [i.name, i.sql ?? ""]));

    for (const name of ["comments_site_page_idx", "comments_site_page_status_idx"]) {
      expect(byName.has(name)).toBe(true);
      expect(byName.get(name)).toContain("page_ref");
      expect(byName.get(name)).not.toContain("document_id");
    }
  });

  it("drops the comments table on rollback", async () => {
    const knex = await databases.init("SQLITE_3");
    const directory = resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations");
    await knex.migrate.latest({ directory });
    expect(await knex.schema.hasTable("comments")).toBe(true);

    await knex.migrate.rollback({ directory }, true);
    expect(await knex.schema.hasTable("comments")).toBe(false);
  });
});
