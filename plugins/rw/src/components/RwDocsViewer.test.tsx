import { screen, waitFor } from "@testing-library/react";
import { renderInTestApp, TestApiProvider } from "@backstage/test-utils";
import { RwDocsViewer } from "./RwDocsViewer";
import { rwApiRef } from "../api/RwClient";
import type { RwApi } from "../api/RwClient";
import { catalogApiRef } from "@backstage/plugin-catalog-react";
import { mountRw } from "@rwdocs/viewer";

jest.mock("@rwdocs/viewer", () => ({
  mountRw: jest.fn(),
}));

jest.mock("@rwdocs/viewer/embed.css", () => ({}));

jest.mock("@backstage/core-plugin-api", () => ({
  ...jest.requireActual("@backstage/core-plugin-api"),
  useRouteRef: () =>
    jest.fn(({ kind, namespace, name }: any) => `/catalog/${namespace}/${kind}/${name}`),
}));

const mockMountRw = mountRw as jest.MockedFunction<typeof mountRw>;

const TEST_API_BASE_URL = "http://localhost:7007/api/rw/site/default/component/my-docs";
const TEST_SOURCE_ENTITY_REF = "component:default/my-docs";

const mockCatalogApi = {
  getEntityByRef: jest.fn().mockResolvedValue(undefined),
};

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
    getCommentInbox: jest.fn().mockResolvedValue({
      built: false,
      items: [],
      pageInfo: {},
      openCount: 0,
      unansweredCount: 0,
    }),
    getLatestChanges: jest.fn().mockResolvedValue({
      hasAnyDated: true,
      items: [],
      pageInfo: {},
    }),
    createCommentClient: jest.fn().mockReturnValue(undefined),
    ...overrides,
  };
}

function renderViewer(mockApi: RwApi, props?: { sectionRef?: string; sourceEntityRef?: string }) {
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [rwApiRef, mockApi],
        [catalogApiRef, mockCatalogApi],
      ]}
    >
      <RwDocsViewer
        apiBaseUrl={TEST_API_BASE_URL}
        sectionRef={props?.sectionRef ?? TEST_SOURCE_ENTITY_REF}
        sourceEntityRef={props?.sourceEntityRef ?? TEST_SOURCE_ENTITY_REF}
      />
    </TestApiProvider>,
  );
}

describe("RwDocsViewer", () => {
  const mockDestroy = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockMountRw.mockReturnValue({
      destroy: mockDestroy,
      navigateTo: jest.fn(),
      setColorScheme: jest.fn(),
    });
  });

  it("renders a container element", async () => {
    await renderViewer(createMockRwApi());
    expect(document.querySelector(".rw-root")).toBeInTheDocument();
  });

  it("calls mountRw with correct options", async () => {
    const mockFetch = jest.fn() as unknown as typeof fetch;
    const mockApi = createMockRwApi({
      getFetch: jest.fn().mockReturnValue(mockFetch),
    });

    await renderViewer(mockApi);

    await waitFor(() => {
      expect(mockMountRw).toHaveBeenCalledTimes(1);
    });

    const [container, options] = mockMountRw.mock.calls[0];
    expect(container).toBeInstanceOf(HTMLDivElement);
    expect(options.apiBaseUrl).toBe(TEST_API_BASE_URL);
    expect(options.fetchFn).toBe(mockFetch);
    expect(options.initialPath).toBe("/");
    expect(options.sectionRef).toBe(TEST_SOURCE_ENTITY_REF);
    expect(typeof options.onNavigate).toBe("function");
  });

  it("passes colorScheme matching the Backstage theme to mountRw", async () => {
    await renderViewer(createMockRwApi());

    await waitFor(() => {
      expect(mockMountRw).toHaveBeenCalledTimes(1);
    });

    const [, options] = mockMountRw.mock.calls[0];
    expect(options.colorScheme).toBe("light");
  });

  it("shows ErrorPanel when mountRw throws", async () => {
    mockMountRw.mockImplementation(() => {
      throw new Error("mount failed");
    });

    await renderViewer(createMockRwApi());

    await waitFor(() => {
      expect(screen.getAllByText(/mount failed/).length).toBeGreaterThan(0);
    });
  });

  it("overrides self sectionRef with current basePath in resolveSectionRefs", async () => {
    await renderViewer(createMockRwApi());

    await waitFor(() => {
      expect(mockMountRw).toHaveBeenCalledTimes(1);
    });

    const [, options] = mockMountRw.mock.calls[0];
    const result = await options.resolveSectionRefs!([
      TEST_SOURCE_ENTITY_REF,
      "component:default/other",
    ]);

    // Self ref should map to the current basePath, not a catalog route
    expect(result[TEST_SOURCE_ENTITY_REF]).toBe("/");
    // Other ref not in catalog → omitted
    expect(result["component:default/other"]).toBeUndefined();
  });

  it("calls destroy on unmount", async () => {
    const { unmount } = await renderViewer(createMockRwApi());

    await waitFor(() => {
      expect(mockMountRw).toHaveBeenCalledTimes(1);
    });

    unmount();
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("passes comments to mountRw when the comments prop is provided", async () => {
    const stubCommentClient = {
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    await renderInTestApp(
      <TestApiProvider
        apis={[
          [rwApiRef, createMockRwApi()],
          [catalogApiRef, mockCatalogApi],
        ]}
      >
        <RwDocsViewer
          apiBaseUrl={TEST_API_BASE_URL}
          sectionRef={TEST_SOURCE_ENTITY_REF}
          sourceEntityRef={TEST_SOURCE_ENTITY_REF}
          comments={stubCommentClient as any}
        />
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(mockMountRw).toHaveBeenCalledTimes(1);
    });

    const [, options] = mockMountRw.mock.calls[0];
    expect(options).toHaveProperty("comments", stubCommentClient);
  });
});
