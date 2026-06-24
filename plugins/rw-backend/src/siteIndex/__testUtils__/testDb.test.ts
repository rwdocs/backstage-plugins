import { createTestDb } from "./testDb";

describe("ownership migrations", () => {
  it("creates the four ownership tables", async () => {
    const knex = await createTestDb();
    try {
      for (const t of ["section_ownership", "sections", "pages", "site_refresh"]) {
        expect(await knex.schema.hasTable(t)).toBe(true);
      }
    } finally {
      await knex.destroy();
    }
  });
});
