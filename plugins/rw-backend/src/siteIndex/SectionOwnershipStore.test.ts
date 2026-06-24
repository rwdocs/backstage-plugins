import type { Knex } from "knex";
import { createTestDb } from "./__testUtils__/testDb";
import { SectionOwnershipStore } from "./SectionOwnershipStore";

describe("SectionOwnershipStore", () => {
  let knex: Knex;
  beforeEach(async () => (knex = await createTestDb()));
  afterEach(async () => knex.destroy());

  it("swapSite replaces only the given site's links", async () => {
    const store = new SectionOwnershipStore(knex);
    await store.swapSite("component:default/a", [
      {
        site_ref: "component:default/a",
        section_ref: "s1",
        entity_ref: "e1",
        entity_owner_ref: "g1",
      },
    ]);
    await store.swapSite("component:default/b", [
      {
        site_ref: "component:default/b",
        section_ref: "s2",
        entity_ref: "e2",
        entity_owner_ref: null,
      },
    ]);
    // re-swap a with new links
    await store.swapSite("component:default/a", [
      {
        site_ref: "component:default/a",
        section_ref: "s3",
        entity_ref: "e3",
        entity_owner_ref: "g3",
      },
    ]);

    const rows = await knex("section_ownership").orderBy(["site_ref", "section_ref"]);
    expect(rows.map((r) => `${r.site_ref}:${r.section_ref}`)).toEqual([
      "component:default/a:s3",
      "component:default/b:s2",
    ]);
    const rowA = rows.find((r) => r.site_ref === "component:default/a" && r.section_ref === "s3");
    expect(rowA?.entity_ref).toBe("e3");
    expect(rowA?.entity_owner_ref).toBe("g3");
  });
});
