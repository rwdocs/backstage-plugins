import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { TestApiProvider } from "@backstage/test-utils";
import { catalogApiRef } from "@backstage/plugin-catalog-react";
import { useSectionRefResolver } from "./useSectionRefResolver";
import { ANNOTATION_KEY } from "./constants";
import type { Entity } from "@backstage/catalog-model";

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

function makeEntity(annotations?: Record<string, string>): Entity {
  return {
    apiVersion: "backstage.io/v1alpha1",
    kind: "Domain",
    metadata: { name: "billing", namespace: "default", annotations },
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

function renderWithCatalog(catalogApi: { getEntitiesByRefs: jest.Mock }) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider apis={[[catalogApiRef, catalogApi]]}>{children}</TestApiProvider>
  );
  return renderHook(() => useSectionRefResolver(SOURCE_ENTITY_REF), { wrapper });
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

  it("resolves root section ref to the source entity", async () => {
    const catalogApi = createMockCatalogApi({});
    const { result } = renderWithCatalog(catalogApi);

    let resolved: Record<string, string> = {};
    await act(async () => {
      resolved = await result.current(["section:default/root"]);
    });

    expect(catalogApi.getEntitiesByRefs).not.toHaveBeenCalled();
    expect(resolved).toEqual({
      "section:default/root": "/catalog/default/component/arch/docs",
    });
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
