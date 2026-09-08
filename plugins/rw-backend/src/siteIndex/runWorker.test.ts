import type { Knex } from "knex";
import { createTestDb } from "./__testUtils__/testDb";
import { SiteRefreshStore } from "./SiteRefreshStore";
import { RegistryStore } from "./RegistryStore";
import { SectionOwnershipStore } from "./SectionOwnershipStore";
import { runWorker } from "./runWorker";

function fakeSite() {
  return {
    listSections: async () => [{ sectionRef: "component:default/docs", path: "", ancestors: [] }],
    listPages: async () => [
      {
        sectionRef: "component:default/docs",
        subpath: "",
        path: "",
        anchors: [{ sectionRef: "component:default/docs", subpath: "" }],
        hasContent: true,
        title: "Home",
        lastModified: "2026-06-24T00:00:00Z",
      },
    ],
    pagePathFor: async () => "",
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

const root = "section:default/root";
const shared = "system:default/shared";
const independent = "component:default/independent";
const deep = "component:default/deep";
const siteRef = "component:default/docs";

function collisionSite(nested = false) {
  const sections = [
    { sectionRef: root, path: "", ancestors: [] },
    { sectionRef: shared, path: "a", ancestors: [root] },
    { sectionRef: shared, path: "a-b", ancestors: [root] },
    { sectionRef: independent, path: "a-b/unique", ancestors: [shared, root] },
    ...(nested
      ? [
          { sectionRef: shared, path: "a/nested", ancestors: [shared, root] },
          { sectionRef: deep, path: "a/nested/deep", ancestors: [shared, shared, root] },
        ]
      : []),
  ];
  function page(sectionRef: string, subpath: string, path: string, title: string) {
    return {
      sectionRef,
      subpath,
      path,
      title,
      hasContent: true,
      lastModified: "2026-06-24T00:00:00Z",
      anchors: sections
        .filter((s) => s.path === "" || path === s.path || path.startsWith(`${s.path}/`))
        .sort((a, b) => b.path.length - a.path.length)
        .map((s) => ({
          sectionRef: s.sectionRef,
          subpath: s.path ? path.slice(s.path.length).replace(/^\//, "") : path,
        })),
    };
  }
  const pages = [
    page(root, "", "", "Home"),
    page(shared, "", "a", "Winner"),
    page(shared, "", "a-b", "Loser"),
    page(shared, "q", "a/q", "Winner q"),
    page(shared, "q", "a-b/q", "Loser q"),
    page(shared, "only", "a-b/only", "Loser only"),
    page(independent, "p", "a-b/unique/p", "Independent p"),
    ...(nested ? [page(deep, "p", "a/nested/deep/p", "Deep p")] : []),
  ];
  return {
    sections,
    pages,
    listSections: async () => sections,
    listPages: async () => pages,
    pagePathFor: jest.fn(async (ref: string) =>
      ref === shared ? "a" : (sections.find((s) => s.sectionRef === ref)?.path ?? null),
    ),
  };
}

describe("runWorker", () => {
  let knex: Knex;
  beforeEach(async () => (knex = await createTestDb()));
  afterEach(async () => knex.destroy());

  it.each([false, true])(
    "commits canonical duplicate identities and stable ownership (nested=%s)",
    async (nested) => {
      const site = collisionSite(nested);
      const sectionOwnershipStore = new SectionOwnershipStore(knex);
      await sectionOwnershipStore.swapSite(siteRef, [
        {
          site_ref: siteRef,
          section_ref: shared,
          entity_ref: shared,
          entity_owner_ref: "group:default/shared-owners",
        },
        {
          site_ref: siteRef,
          section_ref: siteRef,
          entity_ref: siteRef,
          entity_owner_ref: "group:default/host-owners",
        },
      ]);
      await new SiteRefreshStore(knex).upsertSite(siteRef, new Date("2026-06-24T00:00:00Z"));
      const workerDeps = {
        ...deps(
          knex,
          () => site,
          () => new Date("2026-06-24T00:01:00Z"),
        ),
        sectionOwnershipStore,
        logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn() } as any,
      };
      await runWorker(workerDeps);
      const titles = await knex("pages").pluck("title");
      expect(titles).toEqual(
        expect.arrayContaining(["Home", "Winner", "Winner q", "Independent p"]),
      );
      expect(titles.sort()).toEqual(
        ["Home", "Winner", "Winner q", "Independent p", ...(nested ? ["Deep p"] : [])].sort(),
      );
      expect(await knex("pages").where({ title: "Loser" })).toHaveLength(0);
      const refresh = await knex("site_refresh").where({ site_ref: siteRef }).first();
      expect(refresh.last_built_at).not.toBeNull();
      expect(refresh.result_hash).not.toBeNull();
      expect(await knex("sections").where({ section_ref: independent }).first()).toMatchObject({
        entity_ref: siteRef,
        parent_section_ref: root,
        section_path: "a-b/unique",
      });
      expect(await knex("sections").where({ section_ref: shared }).first()).toMatchObject({
        entity_ref: shared,
        parent_section_ref: root,
        section_path: "",
      });
      const deepRows = await knex("sections")
        .where({ section_ref: deep })
        .select("entity_ref", "parent_section_ref", "section_path");
      expect(deepRows).toEqual(
        nested
          ? [
              {
                entity_ref: shared,
                parent_section_ref: shared,
                section_path: "nested/deep",
              },
            ]
          : [],
      );
      expect(workerDeps.logger.warn).toHaveBeenCalledTimes(1);
      expect(workerDeps.logger.warn).toHaveBeenCalledWith(expect.stringContaining(siteRef), {
        siteRef,
        collidingRefs: 1,
        omittedSections: nested ? 2 : 1,
        omittedPages: 3,
      });

      await knex("site_refresh").update({ next_update_at: new Date("2026-06-24T00:00:00Z") });
      site.sections.reverse();
      site.pages.reverse();
      await expect(site.pagePathFor(shared)).resolves.toBe("a");
      const swap = jest.spyOn(workerDeps.registryStore, "swapSite");
      await runWorker({ ...workerDeps, now: () => new Date("2026-06-25T00:00:00Z") });
      const rebuilt = await knex("site_refresh").where({ site_ref: siteRef }).first();
      expect(rebuilt.result_hash).toBe(refresh.result_hash);
      expect(rebuilt.last_built_at).not.toBeNull();
      expect(rebuilt.last_built_at).not.toEqual(refresh.last_built_at);
      expect(swap).not.toHaveBeenCalled();
    },
  );

  it.each(["null", "rejected"])(
    "keeps the prior registry and records a failed collision lookup (%s)",
    async (failure) => {
      const workerDeps = deps(knex, fakeSite, () => new Date("2026-06-24T00:01:00Z"));
      await workerDeps.siteRefreshStore.upsertSite(siteRef, new Date("2026-06-24T00:00:00Z"));
      await runWorker(workerDeps);
      const before = await knex("site_refresh").where({ site_ref: siteRef }).first();
      expect(before.result_hash).not.toBeNull();
      const sectionsBefore = await knex("sections").select("*");
      const pagesBefore = await knex("pages").select("*");
      await knex("site_refresh").update({ next_update_at: new Date("2026-06-24T00:00:00Z") });
      const site = collisionSite();
      if (failure === "null") site.pagePathFor.mockResolvedValue(null);
      else site.pagePathFor.mockRejectedValue(new Error("lookup failed"));
      const swap = jest.spyOn(workerDeps.registryStore, "swapSite");
      await runWorker({
        ...workerDeps,
        makeSite: () => site,
        now: () => new Date("2026-06-25T00:00:00Z"),
      });
      const after = await knex("site_refresh").where({ site_ref: siteRef }).first();
      expect(after.errors).toContain(
        failure === "null"
          ? `Cannot resolve canonical section root for ${shared}`
          : "lookup failed",
      );
      expect(after.result_hash).toBe(before.result_hash);
      expect(after.last_built_at).toEqual(before.last_built_at);
      expect(swap).not.toHaveBeenCalled();
      expect(await knex("sections").select("*")).toEqual(sectionsBefore);
      expect(await knex("pages").select("*")).toEqual(pagesBefore);
    },
  );

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
      pagePathFor: async () => null,
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

    const sectionsForward = [
      { sectionRef: "component:default/a", path: "a", ancestors: [] },
      { sectionRef: "component:default/b", path: "b", ancestors: [] },
    ];
    const sectionsReversed = [...sectionsForward].reverse();
    const pages = [
      {
        sectionRef: "component:default/a",
        subpath: "",
        path: "a",
        anchors: [{ sectionRef: "component:default/a", subpath: "" }],
        hasContent: true,
        title: "Home",
        lastModified: "2026-06-24T00:00:00Z",
      },
    ];

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
              pagePathFor: async () => "a",
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
    expect(hashForward).not.toBeNull();
    expect(hashReversed).not.toBeNull();
    expect(hashForward).toBe(hashReversed);
  });

  it("passes section rows carrying effective ownership to swapSite", async () => {
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
