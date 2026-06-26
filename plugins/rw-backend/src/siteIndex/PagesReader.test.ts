import { createTestDb } from "./__testUtils__/testDb";
import { PagesReader } from "./PagesReader";

describe("PagesReader", () => {
  it("returns the title for an exact (site_ref, section_ref, subpath) key", async () => {
    const knex = await createTestDb();
    await knex("pages").insert({
      site_ref: "component:default/site",
      section_ref: "sec-1",
      subpath: "setup",
      title: "Setup Guide",
    });
    const reader = new PagesReader(knex);
    const title = await reader.getTitle("component:default/site", "sec-1", "setup");
    expect(title).toBe("Setup Guide");
  });

  it("returns null when no row matches", async () => {
    const knex = await createTestDb();
    const reader = new PagesReader(knex);
    expect(await reader.getTitle("component:default/site", "sec-1", "missing")).toBeNull();
  });

  it("returns the title for the section root page (subpath '')", async () => {
    const knex = await createTestDb();
    await knex("pages").insert({
      site_ref: "component:default/site",
      section_ref: "sec-1",
      subpath: "",
      title: "Биллинг",
    });
    const reader = new PagesReader(knex);
    const title = await reader.getTitle("component:default/site", "sec-1", "");
    expect(title).toBe("Биллинг");
  });

  it("scopes by site_ref: same (section_ref, subpath) under two sites returns each site's title", async () => {
    const knex = await createTestDb();
    await knex("pages").insert({
      site_ref: "component:default/siteA",
      section_ref: "shared-ref",
      subpath: "intro",
      title: "Intro A",
    });
    await knex("pages").insert({
      site_ref: "component:default/siteB",
      section_ref: "shared-ref",
      subpath: "intro",
      title: "Intro B",
    });
    const reader = new PagesReader(knex);
    expect(await reader.getTitle("component:default/siteA", "shared-ref", "intro")).toBe("Intro A");
    expect(await reader.getTitle("component:default/siteB", "shared-ref", "intro")).toBe("Intro B");
  });
});
