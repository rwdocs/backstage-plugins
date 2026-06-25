import type { Knex } from "knex";
import { createTestDb } from "./__testUtils__/testDb";
import { RegistryStore } from "./RegistryStore";

describe("RegistryStore", () => {
  let knex: Knex;
  beforeEach(async () => (knex = await createTestDb()));
  afterEach(async () => knex.destroy());

  it("swapSite replaces sections and pages for the site atomically", async () => {
    const store = new RegistryStore(knex);
    await store.swapSite(
      "component:default/a",
      [
        {
          site_ref: "component:default/a",
          section_ref: "s1",
          section_path: "",
          parent_section_ref: null,
          entity_ref: "component:default/a",
          entity_owner_ref: null,
        },
      ],
      [{ site_ref: "component:default/a", section_ref: "s1", subpath: "", title: "Home" }],
    );
    // seed site b before second swap on a
    await store.swapSite(
      "component:default/b",
      [
        {
          site_ref: "component:default/b",
          section_ref: "sb1",
          section_path: "b",
          parent_section_ref: null,
          entity_ref: "component:default/b",
          entity_owner_ref: null,
        },
      ],
      [{ site_ref: "component:default/b", section_ref: "sb1", subpath: "bp", title: "B Home" }],
    );
    await store.swapSite(
      "component:default/a",
      [
        {
          site_ref: "component:default/a",
          section_ref: "s2",
          section_path: "x",
          parent_section_ref: "s1",
          entity_ref: "component:default/a",
          entity_owner_ref: null,
        },
      ],
      [{ site_ref: "component:default/a", section_ref: "s2", subpath: "p", title: "P" }],
    );

    expect(
      await knex("sections").where({ site_ref: "component:default/a" }).pluck("section_ref"),
    ).toEqual(["s2"]);
    expect(
      await knex("pages").where({ site_ref: "component:default/a" }).pluck("section_ref"),
    ).toEqual(["s2"]);
    // site b must be untouched by the second swap on a
    expect(await knex("sections").where({ site_ref: "component:default/b" })).toHaveLength(1);
    expect(await knex("pages").where({ site_ref: "component:default/b" })).toHaveLength(1);
  });
});
