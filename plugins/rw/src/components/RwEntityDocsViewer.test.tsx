import { screen, waitFor } from "@testing-library/react";
import { renderInTestApp, TestApiProvider } from "@backstage/test-utils";
import { EntityProvider } from "@backstage/plugin-catalog-react";
import { Entity } from "@backstage/catalog-model";
import { RwEntityDocsViewer } from "./RwEntityDocsViewer";
import { rwApiRef } from "../api/RwClient";
import type { RwApi } from "../api/RwClient";

jest.mock("@rwdocs/viewer/embed.css", () => ({}));

function createMockRwApi(overrides?: Partial<RwApi>): RwApi {
  return {
    getBaseUrl: jest.fn().mockResolvedValue("http://localhost:7007/api/rw"),
    getSiteBaseUrl: jest
      .fn()
      .mockImplementation((entityRef: string) =>
        Promise.resolve(`http://localhost:7007/api/rw/site/${entityRef}`),
      ),
    getFetch: jest.fn().mockReturnValue(jest.fn()),
    ...overrides,
  };
}

function makeEntity(annotations?: Record<string, string>): Entity {
  return {
    apiVersion: "backstage.io/v1alpha1",
    kind: "Component",
    metadata: {
      name: "my-service",
      namespace: "default",
      annotations: annotations ?? {},
    },
  };
}

describe("RwEntityDocsViewer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows error when annotation is missing", async () => {
    const mockApi = createMockRwApi();
    const entity = makeEntity();

    await renderInTestApp(
      <TestApiProvider apis={[[rwApiRef, mockApi]]}>
        <EntityProvider entity={entity}>
          <RwEntityDocsViewer />
        </EntityProvider>
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/rwdocs.org\/ref/).length).toBeGreaterThan(0);
    });
  });

  it("resolves base URL and renders viewer for self-ref annotation", async () => {
    const mockApi = createMockRwApi();
    const entity = makeEntity({ "rwdocs.org/ref": "." });

    await renderInTestApp(
      <TestApiProvider apis={[[rwApiRef, mockApi]]}>
        <EntityProvider entity={entity}>
          <RwEntityDocsViewer />
        </EntityProvider>
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(mockApi.getSiteBaseUrl).toHaveBeenCalledWith("default/component/my-service");
    });
  });

  it("resolves base URL for explicit entity ref annotation", async () => {
    const mockApi = createMockRwApi();
    const entity = makeEntity({ "rwdocs.org/ref": "default/component/other-docs" });

    await renderInTestApp(
      <TestApiProvider apis={[[rwApiRef, mockApi]]}>
        <EntityProvider entity={entity}>
          <RwEntityDocsViewer />
        </EntityProvider>
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(mockApi.getSiteBaseUrl).toHaveBeenCalledWith("default/component/other-docs");
    });
  });

  it("shows error when getSiteBaseUrl rejects", async () => {
    const mockApi = createMockRwApi({
      getSiteBaseUrl: jest.fn().mockRejectedValue(new Error("network error")),
    });
    const entity = makeEntity({ "rwdocs.org/ref": "." });

    await renderInTestApp(
      <TestApiProvider apis={[[rwApiRef, mockApi]]}>
        <EntityProvider entity={entity}>
          <RwEntityDocsViewer />
        </EntityProvider>
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/network error/).length).toBeGreaterThan(0);
    });
  });
});
