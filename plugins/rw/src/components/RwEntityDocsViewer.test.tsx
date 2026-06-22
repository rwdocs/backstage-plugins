import { screen, waitFor } from "@testing-library/react";
import { renderInTestApp, TestApiProvider } from "@backstage/test-utils";
import { catalogApiRef, EntityProvider } from "@backstage/plugin-catalog-react";
import { Entity } from "@backstage/catalog-model";
import { RwEntityDocsViewer } from "./RwEntityDocsViewer";
import { rwApiRef } from "../api/RwClient";
import type { RwApi } from "../api/RwClient";
import { mountRw } from "@rwdocs/viewer";

const mockMountRw = mountRw as jest.MockedFunction<typeof mountRw>;

const mockCatalogApi = {
  getEntityByRef: jest.fn().mockResolvedValue(undefined),
};

jest.mock("@rwdocs/viewer/embed.css", () => ({}));

jest.mock("@backstage/core-plugin-api", () => ({
  ...jest.requireActual("@backstage/core-plugin-api"),
  useRouteRef: () =>
    jest.fn(({ kind, namespace, name }: any) => `/catalog/${namespace}/${kind}/${name}`),
}));

function createMockRwApi(overrides?: Partial<RwApi>): RwApi {
  return {
    getBaseUrl: jest.fn().mockResolvedValue("http://localhost:7007/api/rw"),
    getSiteBaseUrl: jest
      .fn()
      .mockImplementation((entityRef: string) =>
        Promise.resolve(`http://localhost:7007/api/rw/site/${entityRef}`),
      ),
    getFetch: jest.fn().mockReturnValue(jest.fn()),
    getCommentsEnabled: jest.fn().mockResolvedValue(false),
    createCommentClient: jest.fn().mockReturnValue(undefined),
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

function makeApisElement(mockApi: RwApi, entity: Entity) {
  return (
    <TestApiProvider
      apis={[
        [rwApiRef, mockApi],
        [catalogApiRef, mockCatalogApi],
      ]}
    >
      <EntityProvider entity={entity}>
        <RwEntityDocsViewer />
      </EntityProvider>
    </TestApiProvider>
  );
}

describe("RwEntityDocsViewer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMountRw.mockReturnValue({
      destroy: jest.fn(),
      navigateTo: jest.fn(),
      setColorScheme: jest.fn(),
    });
  });

  it("shows error when annotation is missing", async () => {
    const mockApi = createMockRwApi();
    const entity = makeEntity();

    await renderInTestApp(
      <TestApiProvider
        apis={[
          [rwApiRef, mockApi],
          [catalogApiRef, mockCatalogApi],
        ]}
      >
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
      <TestApiProvider
        apis={[
          [rwApiRef, mockApi],
          [catalogApiRef, mockCatalogApi],
        ]}
      >
        <EntityProvider entity={entity}>
          <RwEntityDocsViewer />
        </EntityProvider>
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(mockApi.getSiteBaseUrl).toHaveBeenCalledWith("default/component/my-service");
    });
  });

  it("resolves base URL using source entity ref from annotation", async () => {
    const mockApi = createMockRwApi();
    const entity = makeEntity({ "rwdocs.org/ref": "component:default/other-docs" });

    await renderInTestApp(
      <TestApiProvider
        apis={[
          [rwApiRef, mockApi],
          [catalogApiRef, mockCatalogApi],
        ]}
      >
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
      <TestApiProvider
        apis={[
          [rwApiRef, mockApi],
          [catalogApiRef, mockCatalogApi],
        ]}
      >
        <EntityProvider entity={entity}>
          <RwEntityDocsViewer />
        </EntityProvider>
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/network error/).length).toBeGreaterThan(0);
    });
  });

  it("renders Progress (no viewer) until both apiBaseUrl and comments check complete", async () => {
    let resolveUrl!: (url: string) => void;
    const urlPromise = new Promise<string>((res) => {
      resolveUrl = res;
    });
    const mockApi = createMockRwApi({
      getSiteBaseUrl: jest.fn().mockReturnValue(urlPromise),
    });
    const entity = makeEntity({ "rwdocs.org/ref": "." });

    // Await the render so the component settles into its initial gated state
    // (effect queued, URL promise still pending).
    await renderInTestApp(makeApisElement(mockApi, entity));

    // The Progress indicator must be visible and the viewer must be absent
    // while the URL promise is still pending — this is the meaningful gate assertion.
    // Backstage's Progress renders with data-testid="progress" in the test environment.
    expect(screen.getByTestId("progress")).toBeInTheDocument();
    expect(document.querySelector(".rw-root")).not.toBeInTheDocument();

    resolveUrl("http://localhost:7007/api/rw/site/default/component/my-service");

    // After both fetches resolve, the viewer div should appear and the progress indicator should be gone.
    await waitFor(() => {
      expect(document.querySelector(".rw-root")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("progress")).not.toBeInTheDocument();
  });

  it("calls createCommentClient when getCommentsEnabled resolves true; comments prop is undefined when disabled", async () => {
    const stubCommentClient = {
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    // --- enabled case ---
    const mockApiEnabled = createMockRwApi({
      getCommentsEnabled: jest.fn().mockResolvedValue(true),
      createCommentClient: jest.fn().mockReturnValue(stubCommentClient),
    });
    const entity = makeEntity({ "rwdocs.org/ref": "." });

    await renderInTestApp(makeApisElement(mockApiEnabled, entity));

    await waitFor(() => {
      expect(mockMountRw).toHaveBeenCalled();
    });
    const [, optionsEnabled] = mockMountRw.mock.calls[0];
    expect(mockApiEnabled.createCommentClient).toHaveBeenCalledWith("component:default/my-service");
    expect(optionsEnabled.comments).toBe(stubCommentClient);

    jest.clearAllMocks();
    mockMountRw.mockReturnValue({
      destroy: jest.fn(),
      navigateTo: jest.fn(),
      setColorScheme: jest.fn(),
    });

    // --- disabled case ---
    const mockApiDisabled = createMockRwApi({
      getCommentsEnabled: jest.fn().mockResolvedValue(false),
    });

    await renderInTestApp(makeApisElement(mockApiDisabled, entity));

    await waitFor(() => {
      expect(mockMountRw).toHaveBeenCalled();
    });
    const [, optionsDisabled] = mockMountRw.mock.calls[0];
    expect(mockApiDisabled.createCommentClient).not.toHaveBeenCalled();
    expect(optionsDisabled.comments).toBeUndefined();
  });

  it("mounts viewer with comments undefined when getCommentsEnabled rejects (graceful degradation)", async () => {
    const mockApi = createMockRwApi({
      getCommentsEnabled: jest.fn().mockRejectedValue(new Error("comments service unavailable")),
    });
    const entity = makeEntity({ "rwdocs.org/ref": "." });

    await renderInTestApp(makeApisElement(mockApi, entity));

    // Viewer should still mount despite getCommentsEnabled rejection
    await waitFor(() => {
      expect(mockMountRw).toHaveBeenCalled();
    });
    const [, options] = mockMountRw.mock.calls[0];
    expect(options.comments).toBeUndefined();
    // No error panel should be shown
    expect(screen.queryByText(/comments service unavailable/)).not.toBeInTheDocument();
  });

  it("warns via console.warn when getCommentsEnabled rejects; success path does not warn", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const probeError = new Error("comments service unavailable");
      const mockApiRejecting = createMockRwApi({
        getCommentsEnabled: jest.fn().mockRejectedValue(probeError),
      });
      const entity = makeEntity({ "rwdocs.org/ref": "." });

      await renderInTestApp(makeApisElement(mockApiRejecting, entity));

      // (a) console.warn must be called exactly once with the probe-failure message
      await waitFor(() => {
        expect(warnSpy).toHaveBeenCalledTimes(1);
      });
      expect(warnSpy).toHaveBeenCalledWith(
        "rw: comments-enabled probe failed; comments disabled for this view",
        probeError,
      );

      // (b) viewer still mounts with comments undefined
      await waitFor(() => {
        expect(mockMountRw).toHaveBeenCalled();
      });
      const [, options] = mockMountRw.mock.calls[0];
      expect(options.comments).toBeUndefined();

      // (c) no ErrorPanel
      expect(screen.queryByText(/comments service unavailable/)).not.toBeInTheDocument();

      // Reset for the success-path check
      warnSpy.mockClear();
      jest.clearAllMocks();
      mockMountRw.mockReturnValue({
        destroy: jest.fn(),
        navigateTo: jest.fn(),
        setColorScheme: jest.fn(),
      });

      // Success path: getCommentsEnabled resolves normally — no warn
      const mockApiSuccess = createMockRwApi({
        getCommentsEnabled: jest.fn().mockResolvedValue(false),
      });

      await renderInTestApp(makeApisElement(mockApiSuccess, entity));

      await waitFor(() => {
        expect(mockMountRw).toHaveBeenCalled();
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("(regression) clears stale fetchError on navigation so the viewer renders for the new entity", async () => {
    // Entity A: fetch fails → error panel
    const entityA = makeEntity({ "rwdocs.org/ref": "." });
    const entityB: Entity = {
      apiVersion: "backstage.io/v1alpha1",
      kind: "Component",
      metadata: {
        name: "other-service",
        namespace: "default",
        annotations: { "rwdocs.org/ref": "." },
      },
    };

    let callCount = 0;
    const mockApi = createMockRwApi({
      getSiteBaseUrl: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("network error"));
        return Promise.resolve(`http://localhost:7007/api/rw/site/default/component/other-service`);
      }),
    });

    const { rerender } = await renderInTestApp(makeApisElement(mockApi, entityA));

    // Error panel should appear for entity A
    await waitFor(() => {
      expect(screen.getAllByText(/network error/).length).toBeGreaterThan(0);
    });

    // Navigate to entity B (valid)
    rerender(makeApisElement(mockApi, entityB));

    // The stale error panel should be gone; the viewer should mount
    await waitFor(() => {
      expect(document.querySelector(".rw-root")).toBeInTheDocument();
    });
    expect(screen.queryByText(/network error/)).not.toBeInTheDocument();
  });
});
