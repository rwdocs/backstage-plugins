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
      "document_id",
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

  it("drops the comments table on rollback", async () => {
    const knex = await databases.init("SQLITE_3");
    const directory = resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations");
    await knex.migrate.latest({ directory });
    expect(await knex.schema.hasTable("comments")).toBe(true);

    await knex.migrate.rollback({ directory }, true);
    expect(await knex.schema.hasTable("comments")).toBe(false);
  });
});
