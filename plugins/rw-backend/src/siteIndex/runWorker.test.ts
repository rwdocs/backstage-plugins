import type { Knex } from "knex";
import { createTestDb } from "./__testUtils__/testDb";
import { SiteRefreshStore } from "./SiteRefreshStore";
import { RegistryStore } from "./RegistryStore";
import { SectionOwnershipStore } from "./SectionOwnershipStore";
import { runWorker } from "./runWorker";

function fakeSite() {
  return {
    listSections: async () => [{ sectionRef: "component:default/docs", path: "", ancestors: [] }],
    listPages: async () => [{ sectionRef: "component:default/docs", subpath: "", title: "Home" }],
  };
}

const fakeSectionOwnershipStore = (
  claims: Awaited<ReturnType<SectionOwnershipStore["listForSite"]>> = [],
) => ({
  listForSite: async (_siteRef: string) => claims,
});

const deps = (knex: Knex, makeSite: any, now?: () => Date) => ({
  logger: { warn() {}, info() {}, debug() {} } as any,
  siteRefreshStore: new SiteRefreshStore(knex),
  registryStore: new RegistryStore(knex),
  sectionOwnershipStore: fakeSectionOwnershipStore(),
  makeSite,
  now,
  rng: () => 0.5,
});

describe("runWorker", () => {
  let knex: Knex;
  beforeEach(async () => (knex = await createTestDb()));
  afterEach(async () => knex.destroy());

  it("builds a due site: writes sections/pages and marks built", async () => {
    const store = new SiteRefreshStore(knex);
    await store.upsertSite("component:default/docs", new Date("2026-06-24T00:00:00Z"));
    await runWorker(
      deps(
        knex,
        () => fakeSite(),
        () => new Date("2026-06-24T00:01:00Z"),
      ),
    );

    expect(await knex("sections").pluck("section_ref")).toEqual(["component:default/docs"]);
    expect(await knex("pages").pluck("title")).toEqual(["Home"]);
    const row = await knex("site_refresh").where({ site_ref: "component:default/docs" }).first();
    expect(row.last_built_at).not.toBeNull();
    expect(row.result_hash).not.toBeNull();
  });

  it("records an error and does not throw when site load fails", async () => {
    const store = new SiteRefreshStore(knex);
    await store.upsertSite("component:default/docs", new Date("2026-06-24T00:00:00Z"));
    const makeSite = () => ({
      listSections: async () => {
        throw new Error("s3 down");
      },
      listPages: async () => [],
    });
    await runWorker(deps(knex, makeSite));
    const row = await knex("site_refresh").where({ site_ref: "component:default/docs" }).first();
    expect(row.errors).toContain("s3 down");
    expect(row.last_built_at).toBeNull();
  });

  it("short-circuits the registry swap when result_hash is unchanged", async () => {
    const store = new SiteRefreshStore(knex);
    await store.upsertSite("component:default/docs", new Date("2026-06-24T00:00:00Z"));
    await runWorker(
      deps(
        knex,
        () => fakeSite(),
        () => new Date("2026-06-24T00:01:00Z"),
      ),
    );
    // make the site due again
    await knex("site_refresh").update({ next_update_at: new Date("2026-06-24T00:00:00Z") });
    let swaps = 0;
    const registryStore = new RegistryStore(knex);
    const orig = registryStore.swapSite.bind(registryStore);
    registryStore.swapSite = async (...a: Parameters<typeof orig>) => {
      swaps++;
      return orig(...a);
    };
    await runWorker({
      ...deps(
        knex,
        () => fakeSite(),
        () => new Date("2026-06-25T00:00:00Z"),
      ),
      registryStore,
      rng: () => 0.5,
    });
    expect(swaps).toBe(0); // unchanged content → no swap
  });

  it("produces the same result_hash regardless of the order listSections returns sections (effective ownership sort)", async () => {
    // Two separate DBs: one where listSections returns sections in forward order,
    // another where they come back reversed. The effective ownership rows differ
    // in insertion order but the resulting hash stored in site_refresh must be
    // identical — proving that runWorker sorts effective before hashing.
    const siteRef = "component:default/docs";

    const sectionsForward = [
      { sectionRef: "component:default/a", path: "a", ancestors: [] },
      { sectionRef: "component:default/b", path: "b", ancestors: [] },
    ];
    const sectionsReversed = [...sectionsForward].reverse();
    const pages = [{ sectionRef: "component:default/a", subpath: "", title: "Home" }];

    const claims = [
      {
        site_ref: siteRef,
        section_ref: "component:default/a",
        entity_ref: siteRef,
        entity_owner_ref: "group:default/owners",
      },
      {
        site_ref: siteRef,
        section_ref: "component:default/b",
        entity_ref: siteRef,
        entity_owner_ref: "group:default/owners",
      },
    ];
    const sectionOwnershipStore = fakeSectionOwnershipStore(claims);

    async function buildAndGetHash(listSectionsResult: typeof sectionsForward) {
      const k = await createTestDb();
      try {
        const store = new SiteRefreshStore(k);
        await store.upsertSite(siteRef, new Date("2026-06-24T00:00:00Z"));
        await runWorker({
          ...deps(
            k,
            () => ({
              listSections: async () => listSectionsResult,
              listPages: async () => pages,
            }),
            () => new Date("2026-06-24T00:01:00Z"),
          ),
          sectionOwnershipStore,
          rng: () => 0.5,
        });
        const row = await k("site_refresh").where({ site_ref: siteRef }).first();
        return row.result_hash as string;
      } finally {
        await k.destroy();
      }
    }

    const hashForward = await buildAndGetHash(sectionsForward);
    const hashReversed = await buildAndGetHash(sectionsReversed);
    expect(hashForward).toBe(hashReversed);
  });

  it("passes section rows carrying effective ownership to swapSite", async () => {
    const siteRef = "component:default/docs";
    const store = new SiteRefreshStore(knex);
    await store.upsertSite(siteRef, new Date("2026-06-24T00:00:00Z"));

    const claim = {
      site_ref: siteRef,
      section_ref: siteRef,
      entity_ref: siteRef,
      entity_owner_ref: "group:default/owners",
    };
    const sectionOwnershipStore = fakeSectionOwnershipStore([claim]);

    let capturedSections: any[] | undefined;
    const registryStore = new RegistryStore(knex);
    const orig = registryStore.swapSite.bind(registryStore);
    registryStore.swapSite = async (sr, sections, pages) => {
      capturedSections = sections;
      return orig(sr, sections, pages);
    };

    await runWorker({
      ...deps(
        knex,
        () => fakeSite(),
        () => new Date("2026-06-24T00:01:00Z"),
      ),
      registryStore,
      sectionOwnershipStore,
    });

    expect(capturedSections).toBeDefined();
    expect(capturedSections!.length).toBe(1);
    expect(capturedSections![0].section_ref).toBe(siteRef);
    // sentinel claim (section_ref === siteRef): section_path relative to root → ""
    expect(capturedSections![0].section_path).toBe("");
    expect(capturedSections![0].entity_ref).toBe(siteRef);
    expect(capturedSections![0].entity_owner_ref).toBe("group:default/owners");
  });
});
