import { TestDatabases } from "@backstage/backend-test-utils";
import { resolvePackagePath } from "@backstage/backend-plugin-api";
import type { Knex } from "knex";
import { LatestChangesStore } from "./LatestChangesStore";

async function freshStore(
  databases: TestDatabases,
): Promise<{ store: LatestChangesStore; knex: Knex }> {
  const knex = await databases.init("SQLITE_3");
  const directory = resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations");
  await knex.migrate.latest({ directory });
  return { store: new LatestChangesStore(knex), knex };
}

async function seedSection(
  knex: Knex,
  siteRef: string,
  sectionRef: string,
  entityRef: string,
): Promise<void> {
  await knex("sections").insert({
    site_ref: siteRef,
    section_ref: sectionRef,
    section_path: "",
    parent_section_ref: null,
    entity_ref: entityRef,
    entity_owner_ref: null,
  });
}

async function seedPage(
  knex: Knex,
  row: { site: string; section: string; subpath: string; title: string; lm: number | null },
): Promise<void> {
  await knex("pages").insert({
    site_ref: row.site,
    section_ref: row.section,
    subpath: row.subpath,
    title: row.title,
    last_modified: row.lm,
  });
}

describe("LatestChangesStore", () => {
  const databases = TestDatabases.create({ ids: ["SQLITE_3"] });

  it("returns pages newest-first with entity_ref + section_path joined", async () => {
    const { store, knex } = await freshStore(databases);
    await seedSection(
      knex,
      "component:default/s",
      "component:default/s",
      "component:default/owner",
    );
    await seedPage(knex, {
      site: "component:default/s",
      section: "component:default/s",
      subpath: "a",
      title: "A",
      lm: 1000,
    });
    await seedPage(knex, {
      site: "component:default/s",
      section: "component:default/s",
      subpath: "b",
      title: "B",
      lm: 3000,
    });
    await seedPage(knex, {
      site: "component:default/s",
      section: "component:default/s",
      subpath: "c",
      title: "C",
      lm: 2000,
    });

    const page = await store.latestChangesPage({ limit: 10 });

    expect(page.rows.map((r) => r.title)).toEqual(["B", "C", "A"]);
    expect(page.rows[0].entity_ref).toBe("component:default/owner");
    expect(page.rows[0].section_path).toBe("");
    expect(page.hasMore).toBe(false);
  });

  it("excludes NULL and non-positive last_modified", async () => {
    const { store, knex } = await freshStore(databases);
    await seedSection(
      knex,
      "component:default/s",
      "component:default/s",
      "component:default/owner",
    );
    await seedPage(knex, {
      site: "component:default/s",
      section: "component:default/s",
      subpath: "dated",
      title: "Dated",
      lm: 5000,
    });
    await seedPage(knex, {
      site: "component:default/s",
      section: "component:default/s",
      subpath: "null",
      title: "Null",
      lm: null,
    });
    await seedPage(knex, {
      site: "component:default/s",
      section: "component:default/s",
      subpath: "zero",
      title: "Zero",
      lm: 0,
    });

    const page = await store.latestChangesPage({ limit: 10 });
    expect(page.rows.map((r) => r.title)).toEqual(["Dated"]);
  });

  it("drops a page whose section is absent (inner join)", async () => {
    const { store, knex } = await freshStore(databases);
    // No section row inserted for this page.
    await seedPage(knex, {
      site: "component:default/s",
      section: "component:default/orphan",
      subpath: "x",
      title: "Orphan",
      lm: 9000,
    });
    const page = await store.latestChangesPage({ limit: 10 });
    expect(page.rows).toEqual([]);
  });

  it("paginates via the keyset cursor with a stable total order", async () => {
    const { store, knex } = await freshStore(databases);
    await seedSection(
      knex,
      "component:default/s",
      "component:default/s",
      "component:default/owner",
    );
    // Two pages share last_modified=1000 to exercise the tiebreak.
    await seedPage(knex, {
      site: "component:default/s",
      section: "component:default/s",
      subpath: "a",
      title: "A",
      lm: 1000,
    });
    await seedPage(knex, {
      site: "component:default/s",
      section: "component:default/s",
      subpath: "b",
      title: "B",
      lm: 1000,
    });
    await seedPage(knex, {
      site: "component:default/s",
      section: "component:default/s",
      subpath: "c",
      title: "C",
      lm: 2000,
    });

    const first = await store.latestChangesPage({ limit: 2 });
    expect(first.rows.map((r) => r.title)).toEqual(["C", "A"]); // 2000, then 1000/subpath "a"
    expect(first.hasMore).toBe(true);

    const last = first.rows[first.rows.length - 1];
    const second = await store.latestChangesPage({
      limit: 2,
      lastKey: [Number(last.last_modified), last.site_ref, last.section_ref, last.subpath],
    });
    expect(second.rows.map((r) => r.title)).toEqual(["B"]); // 1000/subpath "b"
    expect(second.hasMore).toBe(false);
  });

  it("seeks across a section_ref boundary when last_modified and site_ref tie", async () => {
    const { store, knex } = await freshStore(databases);
    // Two sections in the SAME site, sharing last_modified — exercises the
    // site_ref/section_ref branches of the nested seek predicate (the other
    // pagination test above only ever varies subpath).
    await seedSection(
      knex,
      "component:default/s",
      "component:default/sectionA",
      "component:default/ownerA",
    );
    await seedSection(
      knex,
      "component:default/s",
      "component:default/sectionB",
      "component:default/ownerB",
    );
    await seedPage(knex, {
      site: "component:default/s",
      section: "component:default/sectionA",
      subpath: "x",
      title: "A-page",
      lm: 1000,
    });
    await seedPage(knex, {
      site: "component:default/s",
      section: "component:default/sectionB",
      subpath: "x",
      title: "B-page",
      lm: 1000,
    });

    const first = await store.latestChangesPage({ limit: 1 });
    expect(first.rows.map((r) => r.title)).toEqual(["A-page"]);
    expect(first.hasMore).toBe(true);

    const last = first.rows[0];
    const second = await store.latestChangesPage({
      limit: 1,
      lastKey: [Number(last.last_modified), last.site_ref, last.section_ref, last.subpath],
    });
    expect(second.rows.map((r) => r.title)).toEqual(["B-page"]);
    expect(second.hasMore).toBe(false);
  });

  it("hasAnyDated reflects the fill state", async () => {
    const { store, knex } = await freshStore(databases);
    await seedSection(
      knex,
      "component:default/s",
      "component:default/s",
      "component:default/owner",
    );

    await seedPage(knex, {
      site: "component:default/s",
      section: "component:default/s",
      subpath: "n",
      title: "N",
      lm: null,
    });
    expect(await store.hasAnyDated()).toBe(false);

    await seedPage(knex, {
      site: "component:default/s",
      section: "component:default/s",
      subpath: "d",
      title: "D",
      lm: 7000,
    });
    expect(await store.hasAnyDated()).toBe(true);
  });
});
