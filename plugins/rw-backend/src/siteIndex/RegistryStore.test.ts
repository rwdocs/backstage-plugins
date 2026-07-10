import type { Knex } from "knex";
import { createTestDb } from "./__testUtils__/testDb";
import { RegistryStore } from "./RegistryStore";
import type { SectionRow } from "./types";

const section = (over: Partial<SectionRow>): SectionRow => ({
  site_ref: "component:default/a",
  section_ref: "s1",
  section_path: "",
  parent_section_ref: null,
  entity_ref: "component:default/a",
  entity_owner_ref: null,
  ...over,
});

describe("RegistryStore", () => {
  let knex: Knex;
  beforeEach(async () => (knex = await createTestDb()));
  afterEach(async () => knex.destroy());

  it("swapSite replaces sections and pages for the site atomically", async () => {
    const store = new RegistryStore(knex);
    await store.swapSite(
      "component:default/a",
      [section({ section_ref: "s1" })],
      [
        {
          site_ref: "component:default/a",
          section_ref: "s1",
          subpath: "",
          title: "Home",
          last_modified: null,
        },
      ],
    );
    // seed site b before second swap on a
    await store.swapSite(
      "component:default/b",
      [
        section({
          site_ref: "component:default/b",
          section_ref: "sb1",
          section_path: "b",
          entity_ref: "component:default/b",
        }),
      ],
      [
        {
          site_ref: "component:default/b",
          section_ref: "sb1",
          subpath: "bp",
          title: "B Home",
          last_modified: null,
        },
      ],
    );
    await store.swapSite(
      "component:default/a",
      [section({ section_ref: "s2", section_path: "x", parent_section_ref: "s1" })],
      [
        {
          site_ref: "component:default/a",
          section_ref: "s2",
          subpath: "p",
          title: "P",
          last_modified: null,
        },
      ],
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

  it("persists effective-ownership columns on sections and replaces them on re-swap", async () => {
    const store = new RegistryStore(knex);
    await store.swapSite(
      "component:default/a",
      [
        section({
          section_ref: "section:default/s1",
          section_path: "s1",
          entity_ref: "component:default/e1",
          entity_owner_ref: "group:default/team-a",
        }),
      ],
      [
        {
          site_ref: "component:default/a",
          section_ref: "section:default/s1",
          subpath: "",
          title: "S1",
          last_modified: null,
        },
      ],
    );
    expect(await knex("sections").where({ site_ref: "component:default/a" })).toHaveLength(1);

    // Re-swap the same site with a different section + owner
    await store.swapSite(
      "component:default/a",
      [
        section({
          section_ref: "section:default/s2",
          section_path: "s2",
          entity_ref: "component:default/e2",
          entity_owner_ref: "group:default/team-b",
        }),
      ],
      [
        {
          site_ref: "component:default/a",
          section_ref: "section:default/s2",
          subpath: "",
          title: "S2",
          last_modified: null,
        },
      ],
    );

    const rows = await knex("sections").where({ site_ref: "component:default/a" });
    expect(rows).toHaveLength(1);
    expect(rows[0].section_ref).toBe("section:default/s2");
    expect(rows[0].entity_ref).toBe("component:default/e2");
    expect(rows[0].entity_owner_ref).toBe("group:default/team-b");
  });
});
