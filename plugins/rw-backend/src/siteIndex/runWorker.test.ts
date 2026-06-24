import type { Knex } from "knex";
import { createTestDb } from "./__testUtils__/testDb";
import { SiteRefreshStore } from "./SiteRefreshStore";
import { RegistryStore } from "./RegistryStore";
import { runWorker } from "./runWorker";

function fakeSite() {
  return {
    listSections: async () => [{ sectionRef: "component:default/docs", path: "", ancestors: [] }],
    listPages: async () => [{ sectionRef: "component:default/docs", subpath: "", title: "Home" }],
  };
}

const deps = (knex: Knex, makeSite: any, now?: () => Date) => ({
  logger: { warn() {}, info() {}, debug() {} } as any,
  siteRefreshStore: new SiteRefreshStore(knex),
  registryStore: new RegistryStore(knex),
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
});
