import { createTestDb } from "./__testUtils__/testDb";
import { SectionsReader } from "./SectionsReader";

describe("SectionsReader", () => {
  it("returns the section row for an exact (site_ref, section_ref) key", async () => {
    const knex = await createTestDb();
    await knex("sections").insert({
      site_ref: "component:default/site",
      section_ref: "sec-1",
      section_path: "guide",
      parent_section_ref: null,
      entity_ref: "component:default/site",
      entity_owner_ref: "group:default/team",
    });
    const reader = new SectionsReader(knex);
    const row = await reader.getSection("component:default/site", "sec-1");
    expect(row).toMatchObject({
      section_path: "guide",
      entity_ref: "component:default/site",
      entity_owner_ref: "group:default/team",
    });
  });

  it("returns undefined when no row matches", async () => {
    const knex = await createTestDb();
    const reader = new SectionsReader(knex);
    expect(await reader.getSection("component:default/site", "missing")).toBeUndefined();
  });

  it("scopes by site_ref: same section_ref in two sites returns each site's own row", async () => {
    const knex = await createTestDb();
    await knex("sections").insert({
      site_ref: "component:default/siteA",
      section_ref: "shared-ref",
      section_path: "path-a",
      parent_section_ref: null,
      entity_ref: "component:default/siteA",
      entity_owner_ref: "group:default/team-a",
    });
    await knex("sections").insert({
      site_ref: "component:default/siteB",
      section_ref: "shared-ref",
      section_path: "path-b",
      parent_section_ref: null,
      entity_ref: "component:default/siteB",
      entity_owner_ref: "group:default/team-b",
    });
    const reader = new SectionsReader(knex);
    const rowA = await reader.getSection("component:default/siteA", "shared-ref");
    const rowB = await reader.getSection("component:default/siteB", "shared-ref");
    expect(rowA).toMatchObject({
      section_path: "path-a",
      entity_owner_ref: "group:default/team-a",
    });
    expect(rowB).toMatchObject({
      section_path: "path-b",
      entity_owner_ref: "group:default/team-b",
    });
  });
});
