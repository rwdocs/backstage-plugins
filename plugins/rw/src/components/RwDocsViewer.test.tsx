import { screen, waitFor } from "@testing-library/react";
import { renderInTestApp, TestApiProvider } from "@backstage/test-utils";
import { RwDocsViewer } from "./RwDocsViewer";
import { rwApiRef } from "../api/RwClient";
import type { RwApi } from "../api/RwClient";
import { mountRw } from "@rwdocs/viewer";

jest.mock("@rwdocs/viewer", () => ({
  mountRw: jest.fn(),
}));

jest.mock("@rwdocs/viewer/embed.css", () => ({}));

const mockMountRw = mountRw as jest.MockedFunction<typeof mountRw>;

const TEST_API_BASE_URL = "http://localhost:7007/api/rw/site/default/component/my-docs";

function createMockRwApi(overrides?: Partial<RwApi>): RwApi {
  return {
    getBaseUrl: jest.fn().mockResolvedValue("http://localhost:7007/api/rw"),
    getSiteBaseUrl: jest.fn().mockImplementation((entityRef: string) =>
      Promise.resolve(`http://localhost:7007/api/rw/site/${entityRef}`),
    ),
    getFetch: jest.fn().mockReturnValue(jest.fn()),
    ...overrides,
  };
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
    const mockApi = createMockRwApi();
    await renderInTestApp(
      <TestApiProvider apis={[[rwApiRef, mockApi]]}>
        <RwDocsViewer apiBaseUrl={TEST_API_BASE_URL} />
      </TestApiProvider>,
    );
    expect(document.querySelector(".rw-root")).toBeInTheDocument();
  });

  it("calls mountRw with correct options", async () => {
    const mockFetch = jest.fn() as unknown as typeof fetch;
    const mockApi = createMockRwApi({
      getFetch: jest.fn().mockReturnValue(mockFetch),
    });

    await renderInTestApp(
      <TestApiProvider apis={[[rwApiRef, mockApi]]}>
        <RwDocsViewer apiBaseUrl={TEST_API_BASE_URL} />
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(mockMountRw).toHaveBeenCalledTimes(1);
    });

    const [container, options] = mockMountRw.mock.calls[0];
    expect(container).toBeInstanceOf(HTMLDivElement);
    expect(options.apiBaseUrl).toBe(TEST_API_BASE_URL);
    expect(options.fetchFn).toBe(mockFetch);
    expect(options.initialPath).toBe("/");
    expect(typeof options.onNavigate).toBe("function");
  });

  it("passes colorScheme matching the Backstage theme to mountRw", async () => {
    const mockApi = createMockRwApi();

    await renderInTestApp(
      <TestApiProvider apis={[[rwApiRef, mockApi]]}>
        <RwDocsViewer apiBaseUrl={TEST_API_BASE_URL} />
      </TestApiProvider>,
    );

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

    const mockApi = createMockRwApi();

    await renderInTestApp(
      <TestApiProvider apis={[[rwApiRef, mockApi]]}>
        <RwDocsViewer apiBaseUrl={TEST_API_BASE_URL} />
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/mount failed/).length).toBeGreaterThan(0);
    });
  });

  it("calls destroy on unmount", async () => {
    const mockApi = createMockRwApi();

    const { unmount } = await renderInTestApp(
      <TestApiProvider apis={[[rwApiRef, mockApi]]}>
        <RwDocsViewer apiBaseUrl={TEST_API_BASE_URL} />
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(mockMountRw).toHaveBeenCalledTimes(1);
    });

    unmount();
    expect(mockDestroy).toHaveBeenCalled();
  });
});
