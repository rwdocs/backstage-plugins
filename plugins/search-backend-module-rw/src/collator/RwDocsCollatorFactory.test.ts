import { Readable } from "stream";
import { mockServices } from "@backstage/backend-test-utils";
import { RwDocsCollatorFactory } from "./RwDocsCollatorFactory";

// Mock @rwdocs/core
jest.mock("@rwdocs/core", () => ({
  createSite: jest.fn(),
}));

import { createSite } from "@rwdocs/core";

const mockedCreateSite = createSite as jest.MockedFunction<typeof createSite>;

function createMockSite(options: {
  navigation?: {
    items: Array<{ title: string; path: string; children?: any[] }>;
    scope?: { path: string; title: string; section: { kind: string; name: string } };
  };
  documents?: Record<string, { title: string; text: string } | null>;
}) {
  const nav = options.navigation ?? { items: [] };
  const docs = options.documents ?? {};
  return {
    getNavigation: jest.fn().mockReturnValue(nav),
    renderSearchDocument: jest.fn().mockImplementation(async (path: string) => {
      return docs[path] ?? null;
    }),
  } as any;
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("has correct type and visibilityPermission", () => {
    const factory = RwDocsCollatorFactory.fromConfig(
      mockServices.rootConfig({
        data: { rw: { projectDir: "/docs", entity: "component:default/test" } },
      }),
      { logger, auth, catalog: createMockCatalog() },
    );
    expect(factory.type).toBe("rw");
    expect(factory.visibilityPermission).toBeDefined();
    expect(factory.visibilityPermission?.name).toBe("catalog.entity.read");
  });

  it("indexes entity with self-reference annotation '.'", async () => {
    const catalog = createMockCatalog([makeEntity("arch", ".")]);

    const site = createMockSite({
      navigation: { items: [{ title: "Home", path: "index" }] },
      documents: { index: { title: "Home", text: "Welcome" } },
    });
    mockedCreateSite.mockReturnValue(site);

    const factory = RwDocsCollatorFactory.fromConfig(
      mockServices.rootConfig({
        data: { rw: { s3: { bucket: "docs" } } },
      }),
      { logger, auth, catalog },
    );

    const collator = await factory.getCollator();
    const docs = await collectDocuments(collator);

    expect(docs).toHaveLength(1);
    expect(docs[0].location).toBe("/catalog/default/component/arch/docs/index");
  });

  it("indexes pages from a single entity", async () => {
    const catalog = createMockCatalog([makeEntity("my-docs", "component:default/my-docs")]);

    const site = createMockSite({
      navigation: {
        items: [
          { title: "Home", path: "index" },
          {
            title: "Guide",
            path: "guide",
            children: [{ title: "Getting Started", path: "guide/getting-started" }],
          },
        ],
      },
      documents: {
        index: { title: "Home", text: "Welcome to the docs" },
        "guide/getting-started": { title: "Getting Started", text: "Follow these steps" },
      },
    });
    mockedCreateSite.mockReturnValue(site);

    const factory = RwDocsCollatorFactory.fromConfig(
      mockServices.rootConfig({
        data: { rw: { projectDir: "/docs", entity: "component:default/my-docs" } },
      }),
      { logger, auth, catalog },
    );

    const collator = await factory.getCollator();
    const docs = await collectDocuments(collator);

    expect(docs).toHaveLength(2);
    expect(docs[0]).toEqual({
      title: "Home",
      text: "Welcome to the docs",
      location: "/catalog/default/component/my-docs/docs/index",
      authorization: { resourceRef: "component:default/my-docs" },
    });
    expect(docs[1]).toEqual({
      title: "Getting Started",
      text: "Follow these steps",
      location: "/catalog/default/component/my-docs/docs/guide/getting-started",
      authorization: { resourceRef: "component:default/my-docs" },
    });
  });

  it("passes sectionRef to getNavigation", async () => {
    const catalog = createMockCatalog([
      makeEntity("viewer", "component:default/my-docs#domains/billing"),
    ]);

    const site = createMockSite({
      navigation: { items: [{ title: "Billing", path: "domains/billing" }] },
      documents: {
        "domains/billing": { title: "Billing", text: "Billing docs" },
      },
    });
    mockedCreateSite.mockReturnValue(site);

    const factory = RwDocsCollatorFactory.fromConfig(
      mockServices.rootConfig({
        data: { rw: { s3: { bucket: "docs" } } },
      }),
      { logger, auth, catalog },
    );

    const collator = await factory.getCollator();
    await collectDocuments(collator);

    expect(site.getNavigation).toHaveBeenCalledWith("domains/billing");
  });

  it("strips scope path prefix from location URLs", async () => {
    const catalog = createMockCatalog([
      makeEntity("payment-gateway", "component:default/arch#system:default/payment-gateway", "System"),
    ]);

    const site = createMockSite({
      navigation: {
        items: [
          { title: "Migration", path: "domains/billing/systems/payment-gateway/migration" },
        ],
        scope: {
          path: "/domains/billing/systems/payment-gateway",
          title: "Payment Gateway",
          section: { kind: "system", name: "payment-gateway" },
        },
      },
      documents: {
        "domains/billing/systems/payment-gateway/migration": {
          title: "Migration",
          text: "Migration docs",
        },
      },
    });
    mockedCreateSite.mockReturnValue(site);

    const factory = RwDocsCollatorFactory.fromConfig(
      mockServices.rootConfig({
        data: { rw: { s3: { bucket: "docs" } } },
      }),
      { logger, auth, catalog },
    );

    const collator = await factory.getCollator();
    const docs = await collectDocuments(collator);

    expect(docs).toHaveLength(1);
    expect(docs[0].location).toBe("/catalog/default/system/payment-gateway/docs/migration");
  });

  it("skips entity that does not match in projectDir mode", async () => {
    const catalog = createMockCatalog([makeEntity("other-docs", "component:default/other-docs")]);

    const factory = RwDocsCollatorFactory.fromConfig(
      mockServices.rootConfig({
        data: { rw: { projectDir: "/docs", entity: "component:default/my-docs" } },
      }),
      { logger, auth, catalog },
    );

    const collator = await factory.getCollator();
    const docs = await collectDocuments(collator);

    expect(docs).toHaveLength(0);
    expect(mockedCreateSite).not.toHaveBeenCalled();
  });

  it("skips entity when site creation fails", async () => {
    const catalog = createMockCatalog([makeEntity("my-docs", "component:default/my-docs")]);

    mockedCreateSite.mockImplementation(() => {
      throw new Error("site creation failed");
    });

    const factory = RwDocsCollatorFactory.fromConfig(
      mockServices.rootConfig({
        data: { rw: { s3: { bucket: "docs" } } },
      }),
      { logger, auth, catalog },
    );

    const collator = await factory.getCollator();
    const docs = await collectDocuments(collator);

    expect(docs).toHaveLength(0);
  });

  it("skips page when renderSearchDocument returns null", async () => {
    const catalog = createMockCatalog([makeEntity("my-docs", "component:default/my-docs")]);

    const site = createMockSite({
      navigation: {
        items: [
          { title: "Home", path: "index" },
          { title: "Missing", path: "missing" },
        ],
      },
      documents: {
        index: { title: "Home", text: "Welcome" },
        missing: null,
      },
    });
    mockedCreateSite.mockReturnValue(site);

    const factory = RwDocsCollatorFactory.fromConfig(
      mockServices.rootConfig({
        data: { rw: { s3: { bucket: "docs" } } },
      }),
      { logger, auth, catalog },
    );

    const collator = await factory.getCollator();
    const docs = await collectDocuments(collator);

    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe("Home");
  });

  it("skips page when renderSearchDocument throws", async () => {
    const catalog = createMockCatalog([makeEntity("my-docs", "component:default/my-docs")]);

    const site = createMockSite({
      navigation: {
        items: [
          { title: "Home", path: "index" },
          { title: "Bad", path: "bad" },
        ],
      },
      documents: {
        index: { title: "Home", text: "Welcome" },
      },
    });
    site.renderSearchDocument.mockImplementation(async (path: string) => {
      if (path === "bad") throw new Error("render failed");
      return { title: "Home", text: "Welcome" };
    });
    mockedCreateSite.mockReturnValue(site);

    const factory = RwDocsCollatorFactory.fromConfig(
      mockServices.rootConfig({
        data: { rw: { s3: { bucket: "docs" } } },
      }),
      { logger, auth, catalog },
    );

    const collator = await factory.getCollator();
    const docs = await collectDocuments(collator);

    expect(docs).toHaveLength(1);
  });

  it("uses custom type from config", () => {
    const factory = RwDocsCollatorFactory.fromConfig(
      mockServices.rootConfig({
        data: {
          rw: { s3: { bucket: "docs" } },
          search: { collators: { rw: { type: "techdocs" } } },
        },
      }),
      { logger, auth, catalog: createMockCatalog() },
    );
    expect(factory.type).toBe("techdocs");
  });

  it("uses custom locationTemplate from config", async () => {
    const catalog = createMockCatalog([makeEntity("my-docs", "component:default/my-docs")]);

    const site = createMockSite({
      navigation: { items: [{ title: "Home", path: "index" }] },
      documents: { index: { title: "Home", text: "text" } },
    });
    mockedCreateSite.mockReturnValue(site);

    const factory = RwDocsCollatorFactory.fromConfig(
      mockServices.rootConfig({
        data: {
          rw: { s3: { bucket: "docs" } },
          search: {
            collators: {
              rw: {
                locationTemplate: "/docs/:namespace/:kind/:name/:path",
              },
            },
          },
        },
      }),
      { logger, auth, catalog },
    );

    const collator = await factory.getCollator();
    const docs = await collectDocuments(collator);

    expect(docs[0].location).toBe("/docs/default/component/my-docs/index");
  });

  it("lowercases kind in location URL", async () => {
    const catalog = createMockCatalog([
      makeEntity("my-docs", "component:default/my-docs", "System"),
    ]);

    const site = createMockSite({
      navigation: { items: [{ title: "Home", path: "index" }] },
      documents: { index: { title: "Home", text: "text" } },
    });
    mockedCreateSite.mockReturnValue(site);

    const factory = RwDocsCollatorFactory.fromConfig(
      mockServices.rootConfig({
        data: { rw: { s3: { bucket: "docs" } } },
      }),
      { logger, auth, catalog },
    );

    const collator = await factory.getCollator();
    const docs = await collectDocuments(collator);

    expect(docs[0].location).toBe("/catalog/default/system/my-docs/docs/index");
  });

  it("indexes multiple entities", async () => {
    const catalog = createMockCatalog([
      makeEntity("docs-1", "component:default/docs-1"),
      makeEntity("docs-2", "component:default/docs-2"),
    ]);

    const site = createMockSite({
      navigation: { items: [{ title: "Home", path: "index" }] },
      documents: { index: { title: "Home", text: "text" } },
    });
    mockedCreateSite.mockReturnValue(site);

    const factory = RwDocsCollatorFactory.fromConfig(
      mockServices.rootConfig({
        data: { rw: { s3: { bucket: "docs" } } },
      }),
      { logger, auth, catalog },
    );

    const collator = await factory.getCollator();
    const docs = await collectDocuments(collator);

    expect(docs).toHaveLength(2);
    expect(catalog.queryEntities).toHaveBeenCalledTimes(1);
  });

  it("paginates through multiple pages of entities", async () => {
    const catalog = {
      queryEntities: jest
        .fn()
        .mockResolvedValueOnce({
          items: [makeEntity("docs-1", "component:default/docs-1")],
          totalItems: 2,
          pageInfo: { nextCursor: "cursor-1" },
        })
        .mockResolvedValueOnce({
          items: [makeEntity("docs-2", "component:default/docs-2")],
          totalItems: 2,
          pageInfo: {},
        }),
    } as any;

    const site = createMockSite({
      navigation: { items: [{ title: "Home", path: "index" }] },
      documents: { index: { title: "Home", text: "text" } },
    });
    mockedCreateSite.mockReturnValue(site);

    const factory = RwDocsCollatorFactory.fromConfig(
      mockServices.rootConfig({
        data: { rw: { s3: { bucket: "docs" } } },
      }),
      { logger, auth, catalog },
    );

    const collator = await factory.getCollator();
    const docs = await collectDocuments(collator);

    expect(docs).toHaveLength(2);
    expect(catalog.queryEntities).toHaveBeenCalledTimes(2);
    expect(catalog.queryEntities).toHaveBeenNthCalledWith(
      2,
      { cursor: "cursor-1" },
      expect.anything(),
    );
  });
});
