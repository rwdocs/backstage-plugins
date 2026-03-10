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

function createMockRwApi(overrides?: Partial<RwApi>): RwApi {
  return {
    getBaseUrl: jest.fn().mockResolvedValue("http://localhost:7007/api/rw"),
    getFetch: jest.fn().mockReturnValue(jest.fn()),
    ...overrides,
  };
}

describe("RwDocsViewer", () => {
  const mockDestroy = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockMountRw.mockReturnValue({ destroy: mockDestroy, navigateTo: jest.fn(), setColorScheme: jest.fn() });
  });

  it("renders a container element", async () => {
    const mockApi = createMockRwApi();
    await renderInTestApp(
      <TestApiProvider apis={[[rwApiRef, mockApi]]}>
        <RwDocsViewer />
      </TestApiProvider>,
    );
    expect(document.querySelector(".rw-root")).toBeInTheDocument();
  });

  it("calls mountRw with correct options after resolving base URL", async () => {
    const mockFetch = jest.fn() as unknown as typeof fetch;
    const mockApi = createMockRwApi({
      getFetch: jest.fn().mockReturnValue(mockFetch),
    });

    await renderInTestApp(
      <TestApiProvider apis={[[rwApiRef, mockApi]]}>
        <RwDocsViewer />
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(mockMountRw).toHaveBeenCalledTimes(1);
    });

    const [container, options] = mockMountRw.mock.calls[0];
    expect(container).toBeInstanceOf(HTMLDivElement);
    expect(options.apiBaseUrl).toBe("http://localhost:7007/api/rw");
    expect(options.fetchFn).toBe(mockFetch);
    expect(options.initialPath).toBe("/");
    expect(typeof options.onNavigate).toBe("function");
  });

  it("passes colorScheme matching the Backstage theme to mountRw", async () => {
    const mockApi = createMockRwApi();

    await renderInTestApp(
      <TestApiProvider apis={[[rwApiRef, mockApi]]}>
        <RwDocsViewer />
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(mockMountRw).toHaveBeenCalledTimes(1);
    });

    const [, options] = mockMountRw.mock.calls[0];
    expect(options.colorScheme).toBe("light");
  });

  it("shows ErrorPanel when getBaseUrl rejects", async () => {
    const mockApi = createMockRwApi({
      getBaseUrl: jest.fn().mockRejectedValue(new Error("discovery failed")),
    });

    await renderInTestApp(
      <TestApiProvider apis={[[rwApiRef, mockApi]]}>
        <RwDocsViewer />
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/discovery failed/).length).toBeGreaterThan(0);
    });
  });

  it("calls destroy on unmount", async () => {
    const mockApi = createMockRwApi();

    const { unmount } = await renderInTestApp(
      <TestApiProvider apis={[[rwApiRef, mockApi]]}>
        <RwDocsViewer />
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(mockMountRw).toHaveBeenCalledTimes(1);
    });

    unmount();
    expect(mockDestroy).toHaveBeenCalled();
  });
});
