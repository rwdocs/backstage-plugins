import { createTestDb } from "./__testUtils__/testDb";

describe("siteIndex migrations", () => {
  it("sections table carries the effective-ownership columns + owner index", async () => {
    const knex = await createTestDb();
    try {
      const cols = await knex("sections").columnInfo();
      expect(cols.entity_ref).toBeDefined();
      expect(cols.entity_owner_ref).toBeDefined();
      // entity_ref is NOT NULL, entity_owner_ref is nullable
      expect(cols.entity_ref.nullable).toBe(false);
      expect(cols.entity_owner_ref.nullable).toBe(true);

      // knex.raw returns the row array directly on the better-sqlite3 backend; one row = index exists.
      const idx = await knex.raw(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='sections_owner_idx'",
      );
      expect(idx).toHaveLength(1);
    } finally {
      await knex.destroy();
    }
  });
});
