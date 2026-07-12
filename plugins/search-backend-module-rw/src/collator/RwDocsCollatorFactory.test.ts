import { Readable } from "stream";
import { mockServices } from "@backstage/backend-test-utils";
import { RwDocsCollatorFactory } from "./RwDocsCollatorFactory";

// Mock @rwdocs/core
jest.mock("@rwdocs/core", () => ({
  createSite: jest.fn(),
}));

import { createSite } from "@rwdocs/core";

const mockedCreateSite = createSite as jest.MockedFunction<typeof createSite>;

interface MockSection {
  sectionRef: string;
  path: string;
  ancestors?: string[];
}

interface MockPage {
  sectionRef: string;
  subpath: string;
}

/** A site that hands out pages the way `@rwdocs/core` does: each page carries its
 *  site `path`, `hasContent`, and the `anchors` chain — every enclosing section,
 *  innermost first, paired with the page's path relative to *that* section. The
 *  chain is derived here from the section tree rather than hand-written, so the
 *  fixtures can't drift from rw's real semantics.
 *
 *  `documents` is keyed by site path; a `null` entry is a virtual page (a directory
 *  with no markdown behind it), which rw reports as `hasContent: false`. */
function createMockSite(options: {
  sections?: MockSection[];
  pages?: MockPage[];
  documents?: Record<string, { title: string; text: string } | null>;
}) {
  const sections = (options.sections ?? []).map((section) => ({ ancestors: [], ...section }));
  const byRef = new Map(sections.map((section) => [section.sectionRef, section]));
  const docs = options.documents ?? {};

  const join = (...parts: string[]) => parts.filter((part) => part !== "").join("/");
  const relativeTo = (path: string, prefix: string) => {
    if (!prefix) return path;
    if (path === prefix) return ""; // the section's own root page
    return path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : path;
  };

  const pages = (options.pages ?? []).map((page) => {
    const section = byRef.get(page.sectionRef)!;
    const path = join(section.path, page.subpath);
    return {
      ...page,
      path,
      title: "",
      lastModified: "2026-07-12T00:00:00+00:00",
      hasContent: docs[path] !== null,
      anchors: [section.sectionRef, ...section.ancestors].map((ref) => ({
        sectionRef: ref,
        subpath: relativeTo(path, byRef.get(ref)?.path ?? ""),
      })),
    };
  });

  return {
    listPages: jest.fn().mockResolvedValue(pages),
    renderSearchDocument: jest.fn().mockImplementation(async (path: string) => docs[path] ?? null),
  } as any;
}

/** The common case: a single root section, so a page's subpath is its site path. */
function createFlatSite(documents: Record<string, { title: string; text: string } | null>) {
  return createMockSite({
    sections: [{ sectionRef: "section:default/root", path: "" }],
    pages: Object.keys(documents).map((subpath) => ({
      sectionRef: "section:default/root",
      subpath,
    })),
    documents,
  });
}

function createMockCatalog(entities: any[] = []) {
  return {
    queryEntities: jest.fn().mockResolvedValue({
      items: entities,
      totalItems: entities.length,
      pageInfo: {},
    }),
  } as any;
}

function makeEntity(name: string, annotation: string, kind = "component", namespace = "default") {
  return {
    apiVersion: "backstage.io/v1alpha1",
    kind,
    metadata: {
      name,
      namespace,
      annotations: { "rwdocs.org/ref": annotation },
    },
  };
}

async function collectDocuments(readable: Readable): Promise<any[]> {
  const docs: any[] = [];
  for await (const doc of readable) {
    docs.push(doc);
  }
  return docs;
}

describe("RwDocsCollatorFactory", () => {
  const logger = mockServices.logger.mock();
  const auth = {
    getOwnServiceCredentials: jest.fn().mockResolvedValue({ credentials: "mock" }),
  } as any;

  function makeFactory(catalog: any, data: any = { rw: { s3: { bucket: "docs" } } }) {
    return RwDocsCollatorFactory.fromConfig(mockServices.rootConfig({ data }), {
      logger,
      auth,
      catalog,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("has correct type and visibilityPermission", () => {
    const factory = makeFactory(createMockCatalog(), {
      rw: { projectDir: "/docs", entity: "component:default/test" },
    });
    expect(factory.type).toBe("rw");
    expect(factory.visibilityPermission).toBeDefined();
    expect(factory.visibilityPermission?.name).toBe("catalog.entity.read");
  });

  it("indexes entity with self-reference annotation '.'", async () => {
    const catalog = createMockCatalog([makeEntity("arch", ".")]);
    mockedCreateSite.mockReturnValue(createFlatSite({ index: { title: "Home", text: "Welcome" } }));

    const docs = await collectDocuments(await makeFactory(catalog).getCollator());

    expect(docs).toHaveLength(1);
    expect(docs[0].location).toBe("/catalog/default/component/arch/docs/index");
    expect(docs[0].siteRef).toBe("component:default/arch");
  });

  it("indexes pages from a single entity", async () => {
    const catalog = createMockCatalog([makeEntity("my-docs", ".")]);
    mockedCreateSite.mockReturnValue(
      createFlatSite({
        index: { title: "Home", text: "Welcome to the docs" },
        "guide/getting-started": { title: "Getting Started", text: "Follow these steps" },
      }),
    );

    const factory = makeFactory(catalog, {
      rw: { projectDir: "/docs", entity: "component:default/my-docs" },
    });
    const docs = await collectDocuments(await factory.getCollator());

    expect(docs).toHaveLength(2);
    expect(docs[0]).toEqual({
      title: "Home",
      text: "Welcome to the docs",
      location: "/catalog/default/component/my-docs/docs/index",
      siteRef: "component:default/my-docs",
      sectionRef: "section:default/root",
      subpath: "index",
      entityRef: "component:default/my-docs",
      authorization: { resourceRef: "component:default/my-docs" },
    });
    expect(docs[1]).toMatchObject({
      title: "Getting Started",
      location: "/catalog/default/component/my-docs/docs/guide/getting-started",
      subpath: "guide/getting-started",
    });
  });

  describe("attribution across entities sharing one site", () => {
    // arch hosts the site; billing claims a domain section; payment-gateway claims a
    // system section nested inside billing.
    const archSite = () =>
      createMockSite({
        sections: [
          { sectionRef: "section:default/root", path: "" },
          {
            sectionRef: "domain:default/billing",
            path: "domains/billing",
            ancestors: ["section:default/root"],
          },
          {
            sectionRef: "system:default/payment-gateway",
            path: "domains/billing/systems/payment-gateway",
            ancestors: ["domain:default/billing", "section:default/root"],
          },
        ],
        pages: [
          { sectionRef: "section:default/root", subpath: "guide" },
          { sectionRef: "domain:default/billing", subpath: "overview" },
          { sectionRef: "system:default/payment-gateway", subpath: "" },
          { sectionRef: "system:default/payment-gateway", subpath: "migration" },
        ],
        documents: {
          guide: { title: "Guide", text: "Guide" },
          "domains/billing/overview": { title: "Overview", text: "Overview" },
          "domains/billing/systems/payment-gateway": { title: "Payment Gateway", text: "PG" },
          "domains/billing/systems/payment-gateway/migration": {
            title: "Migration",
            text: "Migration",
          },
        },
      });

    const entities = [
      makeEntity("arch", "."),
      makeEntity("billing", "component:default/arch#domain:default/billing", "Domain"),
      makeEntity(
        "payment-gateway",
        "component:default/arch#system:default/payment-gateway",
        "System",
      ),
    ];

    it("indexes each page once, for the entity claiming the nearest section", async () => {
      const catalog = createMockCatalog(entities);
      mockedCreateSite.mockReturnValue(archSite());

      const docs = await collectDocuments(await makeFactory(catalog).getCollator());

      // Four pages, four documents — not one per page per entity that can reach it.
      expect(docs).toHaveLength(4);
      expect(docs.map((doc) => [doc.title, doc.entityRef, doc.location])).toEqual([
        ["Guide", "component:default/arch", "/catalog/default/component/arch/docs/guide"],
        ["Overview", "domain:default/billing", "/catalog/default/domain/billing/docs/overview"],
        [
          "Payment Gateway",
          "system:default/payment-gateway",
          "/catalog/default/system/payment-gateway/docs/",
        ],
        [
          "Migration",
          "system:default/payment-gateway",
          "/catalog/default/system/payment-gateway/docs/migration",
        ],
      ]);
    });

    it("keeps the site identity while attributing to the nearest entity", async () => {
      const catalog = createMockCatalog(entities);
      mockedCreateSite.mockReturnValue(archSite());

      const docs = await collectDocuments(await makeFactory(catalog).getCollator());
      const migration = docs.find((doc) => doc.title === "Migration");

      // The page belongs to one site and one section regardless of which entity
      // surfaces it, so a hit resolves back to content the same way for all of them.
      expect(migration).toMatchObject({
        siteRef: "component:default/arch",
        sectionRef: "system:default/payment-gateway",
        subpath: "migration",
        entityRef: "system:default/payment-gateway",
        authorization: { resourceRef: "system:default/payment-gateway" },
      });
    });

    it("loads the shared site once, not once per entity", async () => {
      const catalog = createMockCatalog(entities);
      mockedCreateSite.mockReturnValue(archSite());

      await collectDocuments(await makeFactory(catalog).getCollator());

      expect(mockedCreateSite).toHaveBeenCalledTimes(1);
    });

    it("skips pages no entity claims, and says so", async () => {
      // Nothing documents the site as a whole, so pages outside the claimed section
      // have no entity to link to.
      const catalog = createMockCatalog([entities[2]]);
      mockedCreateSite.mockReturnValue(archSite());

      const docs = await collectDocuments(await makeFactory(catalog).getCollator());

      expect(docs.map((doc) => doc.title)).toEqual(["Payment Gateway", "Migration"]);
      // Loudly: a silent drop turns a misconfigured catalog into a clean-looking
      // run that indexes nothing.
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("2 unowned page(s)"));
    });

    it("indexes the whole site for an entity that points at it unscoped without hosting it", async () => {
      // The common "show me the shared arch site" annotation: billing points at
      // arch's site with no section, and arch itself carries no annotation. Its Docs
      // tab renders the whole site, so search must find those pages under it.
      const catalog = createMockCatalog([
        makeEntity("billing", "component:default/arch", "Domain"),
      ]);
      mockedCreateSite.mockReturnValue(archSite());

      const docs = await collectDocuments(await makeFactory(catalog).getCollator());

      expect(docs).toHaveLength(4);
      expect(new Set(docs.map((doc) => doc.entityRef))).toEqual(
        new Set(["domain:default/billing"]),
      );
      expect(docs[0].location).toBe("/catalog/default/domain/billing/docs/guide");
    });

    it("prefers the hosting entity over one that merely points at the site", async () => {
      const catalog = createMockCatalog([
        makeEntity("viewer", "component:default/arch", "Domain"),
        makeEntity("arch", "."),
      ]);
      mockedCreateSite.mockReturnValue(archSite());

      const docs = await collectDocuments(await makeFactory(catalog).getCollator());

      // Both surface the unclaimed pages; the host owns them, and the page is still
      // indexed exactly once.
      expect(docs).toHaveLength(4);
      expect(docs[0].entityRef).toBe("component:default/arch");
    });

    it("warns when an entity claims a section the site does not have", async () => {
      // A typo, or a section the docs repo has since renamed. The entity's pages
      // land on the site's owner; without the warning this is undiagnosable.
      const catalog = createMockCatalog([
        makeEntity("arch", "."),
        makeEntity("billing", "component:default/arch#domain:default/biling", "Domain"),
      ]);
      mockedCreateSite.mockReturnValue(archSite());

      const docs = await collectDocuments(await makeFactory(catalog).getCollator());

      expect(docs).toHaveLength(4);
      expect(new Set(docs.map((doc) => doc.entityRef))).toEqual(
        new Set(["component:default/arch"]),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("claims domain:default/biling, which has no pages"),
      );
    });

    it("does not load a site for an entity whose annotation claims nothing", async () => {
      // In projectDir mode a non-matching entity is filtered earlier; here the site
      // is real but the entity claims nothing indexable, so loading it would walk
      // every page to emit zero documents.
      const catalog = createMockCatalog([makeEntity("arch", ".")]);
      mockedCreateSite.mockReturnValue(archSite());

      await collectDocuments(await makeFactory(catalog).getCollator());

      expect(mockedCreateSite).toHaveBeenCalledTimes(1);
    });
  });

  it("resolves a section claimed by two entities to the same one every run", async () => {
    const catalog = createMockCatalog([
      makeEntity("zebra", "component:default/arch#domain:default/billing", "Domain"),
      makeEntity("alpha", "component:default/arch#domain:default/billing", "Domain"),
    ]);
    mockedCreateSite.mockReturnValue(
      createMockSite({
        sections: [
          { sectionRef: "section:default/root", path: "" },
          {
            sectionRef: "domain:default/billing",
            path: "domains/billing",
            ancestors: ["section:default/root"],
          },
        ],
        pages: [{ sectionRef: "domain:default/billing", subpath: "overview" }],
        documents: { "domains/billing/overview": { title: "Overview", text: "Overview" } },
      }),
    );

    const docs = await collectDocuments(await makeFactory(catalog).getCollator());

    // Lexicographically first wins, so a hit doesn't flip between entities run to run.
    expect(docs).toHaveLength(1);
    expect(docs[0].entityRef).toBe("domain:default/alpha");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("claim domain:default/billing"),
    );
  });

  it("skips entity that does not match in projectDir mode", async () => {
    const catalog = createMockCatalog([makeEntity("other-docs", "component:default/other-docs")]);

    const factory = makeFactory(catalog, {
      rw: { projectDir: "/docs", entity: "component:default/my-docs" },
    });
    const docs = await collectDocuments(await factory.getCollator());

    expect(docs).toHaveLength(0);
    expect(mockedCreateSite).not.toHaveBeenCalled();
  });

  it("keeps crawling when one site cannot be created", async () => {
    const catalog = createMockCatalog([makeEntity("broken", "."), makeEntity("healthy", ".")]);

    mockedCreateSite.mockImplementationOnce(() => {
      throw new Error("site creation failed");
    });
    mockedCreateSite.mockReturnValue(createFlatSite({ index: { title: "Home", text: "text" } }));

    const docs = await collectDocuments(await makeFactory(catalog).getCollator());

    expect(docs).toHaveLength(1);
    expect(docs[0].entityRef).toBe("component:default/healthy");
  });

  it("keeps crawling when a site's storage is unreachable", async () => {
    const catalog = createMockCatalog([makeEntity("broken", "."), makeEntity("healthy", ".")]);

    const brokenSite = createFlatSite({});
    brokenSite.listPages.mockRejectedValue(new Error("S3: storage unavailable"));
    mockedCreateSite.mockReturnValueOnce(brokenSite);
    mockedCreateSite.mockReturnValue(createFlatSite({ index: { title: "Home", text: "text" } }));

    const docs = await collectDocuments(await makeFactory(catalog).getCollator());

    expect(docs).toHaveLength(1);
    expect(docs[0].entityRef).toBe("component:default/healthy");
  });

  it("skips page when renderSearchDocument returns null", async () => {
    const catalog = createMockCatalog([makeEntity("my-docs", ".")]);

    // A virtual page — a directory with no markdown behind it.
    mockedCreateSite.mockReturnValue(
      createFlatSite({ index: { title: "Home", text: "Welcome" }, missing: null }),
    );

    const docs = await collectDocuments(await makeFactory(catalog).getCollator());

    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe("Home");
  });

  it("skips page when renderSearchDocument throws", async () => {
    const catalog = createMockCatalog([makeEntity("my-docs", ".")]);

    const documents = {
      index: { title: "Home", text: "Welcome" },
      bad: { title: "Bad", text: "Bad" },
    };
    const site = createFlatSite(documents);
    site.renderSearchDocument.mockImplementation(async (path: string) => {
      if (path === "bad") throw new Error("render failed");
      return documents[path as keyof typeof documents];
    });
    mockedCreateSite.mockReturnValue(site);

    const docs = await collectDocuments(await makeFactory(catalog).getCollator());

    // The failing page is dropped; the healthy one still lands.
    expect(docs.map((doc) => doc.subpath)).toEqual(["index"]);
  });

  it("uses custom type from config", () => {
    const factory = makeFactory(createMockCatalog(), {
      rw: { s3: { bucket: "docs" } },
      search: { collators: { rw: { type: "techdocs" } } },
    });
    expect(factory.type).toBe("techdocs");
  });

  it("uses custom locationTemplate from config", async () => {
    const catalog = createMockCatalog([makeEntity("my-docs", ".")]);
    mockedCreateSite.mockReturnValue(createFlatSite({ index: { title: "Home", text: "text" } }));

    const factory = makeFactory(catalog, {
      rw: { s3: { bucket: "docs" } },
      search: { collators: { rw: { locationTemplate: "/docs/:namespace/:kind/:name/:path" } } },
    });
    const docs = await collectDocuments(await factory.getCollator());

    expect(docs[0].location).toBe("/docs/default/component/my-docs/index");
  });

  it("lowercases kind in location URL", async () => {
    const catalog = createMockCatalog([makeEntity("my-docs", ".", "System")]);
    mockedCreateSite.mockReturnValue(createFlatSite({ index: { title: "Home", text: "text" } }));

    const docs = await collectDocuments(await makeFactory(catalog).getCollator());

    expect(docs[0].location).toBe("/catalog/default/system/my-docs/docs/index");
  });

  it("indexes multiple sites", async () => {
    const catalog = createMockCatalog([makeEntity("docs-1", "."), makeEntity("docs-2", ".")]);
    mockedCreateSite.mockReturnValue(createFlatSite({ index: { title: "Home", text: "text" } }));

    const docs = await collectDocuments(await makeFactory(catalog).getCollator());

    expect(docs).toHaveLength(2);
    expect(docs.map((doc) => doc.siteRef)).toEqual([
      "component:default/docs-1",
      "component:default/docs-2",
    ]);
    expect(catalog.queryEntities).toHaveBeenCalledTimes(1);
  });

  it("paginates through multiple pages of entities", async () => {
    const catalog = {
      queryEntities: jest
        .fn()
        .mockResolvedValueOnce({
          items: [makeEntity("docs-1", ".")],
          totalItems: 2,
          pageInfo: { nextCursor: "cursor-1" },
        })
        .mockResolvedValueOnce({
          items: [makeEntity("docs-2", ".")],
          totalItems: 2,
          pageInfo: {},
        }),
    } as any;

    mockedCreateSite.mockReturnValue(createFlatSite({ index: { title: "Home", text: "text" } }));

    const docs = await collectDocuments(await makeFactory(catalog).getCollator());

    expect(docs).toHaveLength(2);
    expect(catalog.queryEntities).toHaveBeenCalledTimes(2);
    expect(catalog.queryEntities).toHaveBeenNthCalledWith(
      2,
      { cursor: "cursor-1" },
      expect.anything(),
    );
  });
});
