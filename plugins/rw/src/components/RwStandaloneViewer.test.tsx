import { screen, waitFor } from "@testing-library/react";
import { renderInTestApp, TestApiProvider } from "@backstage/test-utils";
import { configApiRef } from "@backstage/core-plugin-api";
import { ConfigReader } from "@backstage/config";
import { catalogApiRef } from "@backstage/plugin-catalog-react";
import { RwStandaloneViewer } from "./RwStandaloneViewer";
import { rwApiRef } from "../api/RwClient";
import type { RwApi } from "../api/RwClient";

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
    ...overrides,
  };
}

describe("RwStandaloneViewer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows error when rw.rootEntity is not configured", async () => {
    const mockApi = createMockRwApi();
    const configApi = new ConfigReader({});

    await renderInTestApp(
      <TestApiProvider
        apis={[
          [rwApiRef, mockApi],
          [configApiRef, configApi],
          [catalogApiRef, mockCatalogApi],
        ]}
      >
        <RwStandaloneViewer />
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/rw.rootEntity must be configured/).length).toBeGreaterThan(0);
    });
  });

  it("resolves base URL when rootEntity is configured", async () => {
    const mockApi = createMockRwApi();
    const configApi = new ConfigReader({ rw: { rootEntity: "component:default/main-docs" } });

    await renderInTestApp(
      <TestApiProvider
        apis={[
          [rwApiRef, mockApi],
          [configApiRef, configApi],
          [catalogApiRef, mockCatalogApi],
        ]}
      >
        <RwStandaloneViewer />
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(mockApi.getSiteBaseUrl).toHaveBeenCalledWith("default/component/main-docs"); // parsed from "component:default/main-docs"
    });
  });

  it("shows error when getSiteBaseUrl rejects", async () => {
    const mockApi = createMockRwApi({
      getSiteBaseUrl: jest.fn().mockRejectedValue(new Error("discovery failed")),
    });
    const configApi = new ConfigReader({ rw: { rootEntity: "component:default/main-docs" } });

    await renderInTestApp(
      <TestApiProvider
        apis={[
          [rwApiRef, mockApi],
          [configApiRef, configApi],
          [catalogApiRef, mockCatalogApi],
        ]}
      >
        <RwStandaloneViewer />
      </TestApiProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/discovery failed/).length).toBeGreaterThan(0);
    });
  });
});
