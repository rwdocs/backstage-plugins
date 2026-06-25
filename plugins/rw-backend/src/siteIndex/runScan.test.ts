import type { Knex } from "knex";
import { createTestDb } from "./__testUtils__/testDb";
import { SectionOwnershipStore } from "./SectionOwnershipStore";
import { SiteRefreshStore } from "./SiteRefreshStore";
import { runScan } from "./runScan";

const RW = "rwdocs.org/ref";

function ent(name: string, ref: string, owner?: string) {
  return {
    kind: "Component",
    metadata: { namespace: "default", name, annotations: { [RW]: ref } },
    relations: owner ? [{ type: "ownedBy", targetRef: owner }] : [],
  } as any;
}

function catalogReturning(items: any[]) {
  return { queryEntities: async () => ({ items, pageInfo: {}, totalItems: items.length }) };
}

const deps = (knex: Knex, catalog: any) => ({
  catalog,
  auth: { getOwnServiceCredentials: async () => ({}) } as any,
  logger: { warn() {}, info() {} } as any,
  siteConfig: { s3: { bucket: "b" } } as any,
  sectionOwnershipStore: new SectionOwnershipStore(knex),
  siteRefreshStore: new SiteRefreshStore(knex),
});

describe("runScan", () => {
  let knex: Knex;
  beforeEach(async () => (knex = await createTestDb()));
  afterEach(async () => knex.destroy());

  it("writes section_ownership links and seeds site_refresh", async () => {
    // entity arch claims section s1 of site docs; entity docs self-hosts its root
    const catalog = catalogReturning([
      ent("arch", "component:default/docs#s1", "group:default/team-a"),
      ent("docs", ".", "group:default/owners"),
    ]);
    await runScan(deps(knex, catalog));

    const links = await knex("section_ownership").orderBy("section_ref");
    expect(links).toEqual([
      {
        site_ref: "component:default/docs",
        section_ref: "component:default/docs",
        entity_ref: "component:default/docs",
        entity_owner_ref: "group:default/owners",
      },
      {
        site_ref: "component:default/docs",
        section_ref: "s1",
        entity_ref: "component:default/arch",
        entity_owner_ref: "group:default/team-a",
      },
    ]);
    expect(await knex("site_refresh").pluck("site_ref")).toEqual(["component:default/docs"]);
  });

  it("prunes a vanished site's queue row but leaves section_ownership orphans", async () => {
    await runScan(deps(knex, catalogReturning([ent("docs", ".", "group:default/o")])));
    // second scan: docs is gone, only other appears
    await runScan(deps(knex, catalogReturning([ent("other", ".", "group:default/o")])));

    expect(await knex("site_refresh").pluck("site_ref")).toEqual(["component:default/other"]);
    // orphan link for the vanished site remains
    expect(await knex("section_ownership").pluck("site_ref")).toContain("component:default/docs");
  });

  it("does NOT prune when iteration fails", async () => {
    await runScan(deps(knex, catalogReturning([ent("docs", ".", "group:default/o")])));
    const failing = {
      queryEntities: async () => {
        throw new Error("catalog down");
      },
    };
    await runScan(deps(knex, failing));
    // queue row survives the failed scan
    expect(await knex("site_refresh").pluck("site_ref")).toEqual(["component:default/docs"]);
  });

  it("deduplicates section links (last-claim-wins) when two entities share the same section", async () => {
    // Both arch-a and arch-b claim section s1 of the same site; arch-b appears last → wins.
    const catalog = catalogReturning([
      ent("arch-a", "component:default/docs#s1", "group:default/team-a"),
      ent("arch-b", "component:default/docs#s1", "group:default/team-b"),
    ]);
    await runScan(deps(knex, catalog));

    const links = await knex("section_ownership").where({ section_ref: "s1" });
    expect(links).toHaveLength(1);
    expect(links[0].entity_ref).toBe("component:default/arch-b");
    // site_refresh row must exist (no PK crash)
    expect(await knex("site_refresh").pluck("site_ref")).toEqual(["component:default/docs"]);
  });

  it("skips foreign sites when projectDir mode constrains to onlySiteRef", async () => {
    // projectDir mode: siteConfig.entity pins the site to component:default/docs.
    // A foreign entity claims a different site (component:default/other); it must be ignored.
    const catalog = catalogReturning([
      ent("docs", ".", "group:default/owners"),
      ent("foreign", "component:default/other", "group:default/other-owners"),
    ]);
    const projectDirDeps = {
      ...deps(knex, catalog),
      siteConfig: { projectDir: "/fake", entity: "component:default/docs" } as any,
    };
    await runScan(projectDirDeps);

    // Only the configured site lands in site_refresh
    const siteRefs = await knex("site_refresh").pluck("site_ref");
    expect(siteRefs).toEqual(["component:default/docs"]);
    expect(siteRefs).not.toContain("component:default/other");

    // Only the configured site's ownership row lands in section_ownership
    const ownershipSiteRefs = await knex("section_ownership").pluck("site_ref");
    expect(ownershipSiteRefs.every((r: string) => r === "component:default/docs")).toBe(true);
    expect(ownershipSiteRefs).not.toContain("component:default/other");
  });

  it("does NOT prune a site whose per-site write failed", async () => {
    // Seed a site in the queue via a clean first scan.
    await runScan(deps(knex, catalogReturning([ent("docs", ".", "group:default/o")])));
    expect(await knex("site_refresh").pluck("site_ref")).toEqual(["component:default/docs"]);

    // Second scan: docs is still in the catalog but swapSite throws for it.
    const realSectionOwnershipStore = new SectionOwnershipStore(knex);
    const faultySectionOwnershipStore = {
      ...realSectionOwnershipStore,
      swapSite: async () => {
        throw new Error("db write error");
      },
    };
    // Use a spy to confirm pruneMissing is never called.
    const realSiteRefreshStore = new SiteRefreshStore(knex);
    let pruneCallCount = 0;
    const spySiteRefreshStore = {
      ...realSiteRefreshStore,
      transaction: realSiteRefreshStore.transaction.bind(realSiteRefreshStore),
      pruneMissing: async (d: Date) => {
        pruneCallCount++;
        return realSiteRefreshStore.pruneMissing(d);
      },
      upsertSite: realSiteRefreshStore.upsertSite.bind(realSiteRefreshStore),
    };

    await runScan({
      ...deps(knex, catalogReturning([ent("docs", ".", "group:default/o")])),
      sectionOwnershipStore: faultySectionOwnershipStore as any,
      siteRefreshStore: spySiteRefreshStore as any,
    });

    expect(pruneCallCount).toBe(0);
    // The site_refresh row must still exist (not pruned).
    expect(await knex("site_refresh").pluck("site_ref")).toEqual(["component:default/docs"]);
  });
});
