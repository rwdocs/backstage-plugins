import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { TestApiProvider } from "@backstage/test-utils";
import { catalogApiRef } from "@backstage/plugin-catalog-react";
import { useSectionRefResolver } from "./useSectionRefResolver";
import { ANNOTATION_KEY } from "./constants";
import { parseEntityRef, type Entity } from "@backstage/catalog-model";

const mockEntityRoute = jest.fn(
  ({ kind, namespace, name }: { kind: string; namespace: string; name: string }) =>
    `/catalog/${namespace}/${kind}/${name}`,
);

jest.mock("@backstage/plugin-catalog-react", () => ({
  ...jest.requireActual("@backstage/plugin-catalog-react"),
  entityRouteRef: { id: "mock-entity-route-ref" },
}));

jest.mock("@backstage/core-plugin-api", () => ({
  ...jest.requireActual("@backstage/core-plugin-api"),
  useRouteRef: () => mockEntityRoute,
}));

const SOURCE_ENTITY_REF = "component:default/arch";

function makeEntity(annotations?: Record<string, string>, ref = "domain:default/billing"): Entity {
  const { kind, namespace, name } = parseEntityRef(ref);
  return {
    apiVersion: "backstage.io/v1alpha1",
    kind,
    metadata: { name, namespace, annotations },
  };
}

function createMockCatalogApi(entities: Record<string, Entity | undefined>) {
  return {
    getEntitiesByRefs: jest
      .fn()
      .mockImplementation(({ entityRefs }: { entityRefs: string[] }) =>
        Promise.resolve({ items: entityRefs.map((ref) => entities[ref] ?? undefined) }),
      ),
  };
}

function renderWithCatalog(
  catalogApi: { getEntitiesByRefs: jest.Mock },
  rootSectionRef = "section:default/root",
  sourceEntityRef = SOURCE_ENTITY_REF,
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider apis={[[catalogApiRef, catalogApi]]}>{children}</TestApiProvider>
  );
  return renderHook(({ source, root }) => useSectionRefResolver(source, root), {
    wrapper,
    initialProps: { source: sourceEntityRef, root: rootSectionRef },
  });
}

describe("useSectionRefResolver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves section refs to catalog URLs via catalog API", async () => {
    const entity = makeEntity({ [ANNOTATION_KEY]: "." });
    const catalogApi = createMockCatalogApi({ "domain:default/billing": entity });
    const { result } = renderWithCatalog(catalogApi);

    let resolved: Record<string, string> = {};
    await act(async () => {
      resolved = await result.current(["domain:default/billing"]);
    });

    expect(catalogApi.getEntitiesByRefs).toHaveBeenCalledWith({
      entityRefs: ["domain:default/billing"],
    });
    expect(resolved).toEqual({
      "domain:default/billing": "/catalog/default/domain/billing/docs",
    });
  });

  it("preserves ordinary URLs when optional root validation rejects a catalog self-path", async () => {
    const refs = ["domain:default/billing+legacy", "domain:default/ok"];
    const catalogApi = createMockCatalogApi({
      [refs[0]]: makeEntity({ [ANNOTATION_KEY]: "component:default/arch" }, refs[0]),
      [refs[1]]: makeEntity({ [ANNOTATION_KEY]: "component:default/arch" }, refs[1]),
    });
    const { result } = renderWithCatalog(catalogApi, "section:default/root");

    expect(await result.current(refs)).toEqual({
      "domain:default/billing+legacy": "/catalog/default/domain/billing+legacy/docs",
      "domain:default/ok": "/catalog/default/domain/ok/docs",
    });
    expect(catalogApi.getEntitiesByRefs).toHaveBeenCalledWith({ entityRefs: refs });
  });

  it("caches a rejected self-path without making it an eligible root across source changes", async () => {
    const ref = "domain:default/billing+legacy";
    const catalogApi = createMockCatalogApi({
      [ref]: makeEntity({ [ANNOTATION_KEY]: "component:default/arch" }, ref),
    });
    const { result, rerender } = renderWithCatalog(catalogApi);
    expect(await result.current([ref])).toEqual({
      [ref]: "/catalog/default/domain/billing+legacy/docs",
    });
    rerender({ source: SOURCE_ENTITY_REF, root: ref });
    expect(await result.current([ref])).toEqual({
      [ref]: "/catalog/default/component/arch/docs",
    });
    rerender({ source: "component:default/other", root: ref });
    expect(await result.current([ref])).toEqual({
      [ref]: "/catalog/default/component/other/docs",
    });
    expect(catalogApi.getEntitiesByRefs).toHaveBeenCalledTimes(1);
  });

  it("resolves root section ref to the source entity", async () => {
    const catalogApi = createMockCatalogApi({});
    const { result } = renderWithCatalog(catalogApi);

    let resolved: Record<string, string> = {};
    await act(async () => {
      resolved = await result.current(["section:default/root"]);
    });

    expect(catalogApi.getEntitiesByRefs).toHaveBeenCalledWith({
      entityRefs: ["section:default/root"],
    });
    expect(resolved).toEqual({
      "section:default/root": "/catalog/default/component/arch/docs",
    });
  });

  it("resolves a custom-namespace root section ref to the source entity", async () => {
    const catalogApi = createMockCatalogApi({});
    const { result } = renderWithCatalog(catalogApi, "section:acme/root");

    let resolved: Record<string, string> = {};
    await act(async () => {
      resolved = await result.current(["section:acme/root"]);
    });

    expect(catalogApi.getEntitiesByRefs).toHaveBeenCalledWith({
      entityRefs: ["section:acme/root"],
    });
    expect(resolved).toEqual({
      "section:acme/root": "/catalog/default/component/arch/docs",
    });
  });

  it("does not treat a non-section entity named 'root' as the site root", async () => {
    const entity = makeEntity({ [ANNOTATION_KEY]: "." });
    const catalogApi = createMockCatalogApi({ "domain:default/root": entity });
    const { result } = renderWithCatalog(catalogApi);

    let resolved: Record<string, string> = {};
    await act(async () => {
      resolved = await result.current(["domain:default/root"]);
    });

    expect(catalogApi.getEntitiesByRefs).toHaveBeenCalledWith({
      entityRefs: ["domain:default/root"],
    });
    expect(resolved).toEqual({
      "domain:default/root": "/catalog/default/domain/root/docs",
    });
  });

  it.each(["section:commerce/handbook", "domain:commerce/Handbook"])(
    "falls back to the source for the exact authoritative root %s missing from catalog",
    async (rootSectionRef) => {
      const catalogApi = createMockCatalogApi({});
      const { result } = renderWithCatalog(catalogApi, rootSectionRef);
      let resolved: Record<string, string> = {};
      await act(async () => {
        resolved = await result.current([rootSectionRef]);
      });
      expect(resolved).toEqual({ [rootSectionRef]: "/catalog/default/component/arch/docs" });
      expect(catalogApi.getEntitiesByRefs).toHaveBeenCalledWith({ entityRefs: [rootSectionRef] });
    },
  );

  it("resolves a non-root section:default/root through the catalog", async () => {
    const catalogApi = createMockCatalogApi({
      "section:default/root": makeEntity({ [ANNOTATION_KEY]: "." }),
    });
    const { result } = renderWithCatalog(catalogApi, "section:commerce/handbook");
    let resolved: Record<string, string> = {};
    await act(async () => {
      resolved = await result.current(["section:default/root"]);
    });
    expect(resolved).toEqual({ "section:default/root": "/catalog/default/section/root/docs" });
    expect(catalogApi.getEntitiesByRefs).toHaveBeenCalledWith({
      entityRefs: ["section:default/root"],
    });
  });

  it("preserves the catalog root view when the source is scoped (old-version regression)", async () => {
    const root = "domain:default/root";
    const catalogApi = createMockCatalogApi({
      [SOURCE_ENTITY_REF]: makeEntity(
        { [ANNOTATION_KEY]: ".#system:default/payments" },
        SOURCE_ENTITY_REF,
      ),
      [root]: makeEntity({ [ANNOTATION_KEY]: "component:default/arch" }, root),
    });
    const { result } = renderWithCatalog(catalogApi, root);
    expect(await result.current([root, "system:default/payments"])).toEqual({
      [root]: "/catalog/default/domain/root/docs",
    });
    expect(catalogApi.getEntitiesByRefs).toHaveBeenCalledWith({
      entityRefs: [root, "system:default/payments"],
    });
  });

  it.each([
    ["another site", "component:default/other"],
    ["same site, non-root fragment", "component:default/arch#system:default/payments"],
    ["missing annotation", undefined],
    ["invalid annotation", "///invalid///"],
    ["catalog self is not the source", "."],
    ["root fragment with different case", "component:default/arch#domain:default/Root"],
  ])("falls back for %s", async (_description, annotation) => {
    const root = "domain:default/root";
    const catalogApi = createMockCatalogApi({
      [root]: makeEntity(annotation ? { [ANNOTATION_KEY]: annotation } : {}, root),
    });
    const { result } = renderWithCatalog(catalogApi, root);
    expect(await result.current([root])).toEqual({
      [root]: "/catalog/default/component/arch/docs",
    });
  });

  it("accepts a same-site explicit-root fragment", async () => {
    const root = "domain:commerce/Handbook";
    const catalogApi = createMockCatalogApi({
      [root]: makeEntity(
        { [ANNOTATION_KEY]: "component:default/arch#domain:commerce/Handbook" },
        root,
      ),
    });
    const { result } = renderWithCatalog(catalogApi, root);
    expect(await result.current([root])).toEqual({
      [root]: "/catalog/commerce/domain/Handbook/docs",
    });
  });

  it("re-evaluates cached catalog data across source and root changes", async () => {
    const root = "domain:default/root";
    const catalogApi = createMockCatalogApi({
      [root]: makeEntity({ [ANNOTATION_KEY]: "component:default/arch" }, root),
    });
    const { result, rerender } = renderWithCatalog(catalogApi, root);
    expect(await result.current([root])).toEqual({
      [root]: "/catalog/default/domain/root/docs",
    });
    rerender({ source: "component:default/other", root });
    expect(await result.current([root])).toEqual({
      [root]: "/catalog/default/component/other/docs",
    });
    rerender({ source: "component:default/other", root: "section:commerce/new-home" });
    expect(await result.current([root])).toEqual({
      [root]: "/catalog/default/domain/root/docs",
    });
    expect(catalogApi.getEntitiesByRefs).toHaveBeenCalledTimes(1);
  });

  it("caches a missing root without retaining a previous source fallback", async () => {
    const root = "section:commerce/handbook";
    const catalogApi = createMockCatalogApi({});
    const { result, rerender } = renderWithCatalog(catalogApi, root);
    expect(await result.current([root])).toEqual({
      [root]: "/catalog/default/component/arch/docs",
    });
    rerender({ source: "component:default/other", root });
    expect(await result.current([root])).toEqual({
      [root]: "/catalog/default/component/other/docs",
    });
    rerender({ source: "component:default/other", root: "section:commerce/new-home" });
    expect(await result.current([root])).toEqual({});
    expect(catalogApi.getEntitiesByRefs).toHaveBeenCalledTimes(1);
  });

  it("falls back after a failed root lookup and retries it", async () => {
    const root = "domain:default/root";
    const catalogApi = createMockCatalogApi({
      [root]: makeEntity({ [ANNOTATION_KEY]: "component:default/arch" }, root),
    });
    catalogApi.getEntitiesByRefs.mockRejectedValueOnce(new Error("network error"));
    const { result } = renderWithCatalog(catalogApi, root);
    expect(await result.current([root])).toEqual({
      [root]: "/catalog/default/component/arch/docs",
    });
    expect(await result.current([root])).toEqual({ [root]: "/catalog/default/domain/root/docs" });
    expect(catalogApi.getEntitiesByRefs).toHaveBeenCalledTimes(2);
  });

  it("returns empty map for entities without rwdocs annotation", async () => {
    const entity = makeEntity({});
    const catalogApi = createMockCatalogApi({ "domain:default/billing": entity });
    const { result } = renderWithCatalog(catalogApi);

    let resolved: Record<string, string> = {};
    await act(async () => {
      resolved = await result.current(["domain:default/billing"]);
    });

    expect(resolved).toEqual({});
  });

  it("returns empty map for entities not in catalog", async () => {
    const catalogApi = createMockCatalogApi({});
    const { result } = renderWithCatalog(catalogApi);

    let resolved: Record<string, string> = {};
    await act(async () => {
      resolved = await result.current(["domain:default/nonexistent"]);
    });

    expect(resolved).toEqual({});
  });

  it("caches results and does not re-fetch known refs", async () => {
    const entity = makeEntity({ [ANNOTATION_KEY]: "." });
    const catalogApi = createMockCatalogApi({ "domain:default/billing": entity });
    const { result } = renderWithCatalog(catalogApi);

    await act(async () => {
      await result.current(["domain:default/billing"]);
    });

    catalogApi.getEntitiesByRefs.mockClear();

    let resolved: Record<string, string> = {};
    await act(async () => {
      resolved = await result.current(["domain:default/billing"]);
    });

    expect(catalogApi.getEntitiesByRefs).not.toHaveBeenCalled();
    expect(resolved).toEqual({
      "domain:default/billing": "/catalog/default/domain/billing/docs",
    });
  });

  it("does not re-fetch refs that resolved to null (missing)", async () => {
    const catalogApi = createMockCatalogApi({});
    const { result } = renderWithCatalog(catalogApi);

    await act(async () => {
      await result.current(["domain:default/gone"]);
    });

    catalogApi.getEntitiesByRefs.mockClear();

    let resolved: Record<string, string> = {};
    await act(async () => {
      resolved = await result.current(["domain:default/gone"]);
    });

    expect(catalogApi.getEntitiesByRefs).not.toHaveBeenCalled();
    expect(resolved).toEqual({});
  });

  it("returns empty map for empty input", async () => {
    const catalogApi = createMockCatalogApi({});
    const { result } = renderWithCatalog(catalogApi);

    let resolved: Record<string, string> = {};
    await act(async () => {
      resolved = await result.current([]);
    });

    expect(catalogApi.getEntitiesByRefs).not.toHaveBeenCalled();
    expect(resolved).toEqual({});
  });

  it("returns cached results when catalog API fails for new refs", async () => {
    const entity = makeEntity({ [ANNOTATION_KEY]: "." });
    const catalogApi = createMockCatalogApi({ "domain:default/billing": entity });
    const { result } = renderWithCatalog(catalogApi);

    await act(async () => {
      await result.current(["domain:default/billing"]);
    });

    catalogApi.getEntitiesByRefs.mockRejectedValue(new Error("network error"));

    let resolved: Record<string, string> = {};
    await act(async () => {
      resolved = await result.current(["domain:default/billing", "system:default/pay"]);
    });

    expect(resolved).toEqual({
      "domain:default/billing": "/catalog/default/domain/billing/docs",
    });
  });
});
