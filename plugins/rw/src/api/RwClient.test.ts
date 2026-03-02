import { RwClient } from "./RwClient";

describe("RwClient", () => {
  const mockDiscoveryApi = {
    getBaseUrl: jest.fn().mockResolvedValue("http://localhost:7007/api/rw"),
  };
  const mockFetch = jest.fn() as unknown as typeof fetch;
  const mockFetchApi = { fetch: mockFetch };

  let client: RwClient;

  beforeEach(() => {
    client = new RwClient({ discoveryApi: mockDiscoveryApi, fetchApi: mockFetchApi });
  });

  describe("getBaseUrl", () => {
    it("delegates to discoveryApi with plugin id 'rw'", async () => {
      const url = await client.getBaseUrl();
      expect(url).toBe("http://localhost:7007/api/rw");
      expect(mockDiscoveryApi.getBaseUrl).toHaveBeenCalledWith("rw");
    });
  });

  describe("getFetch", () => {
    it("returns the fetchApi fetch function", () => {
      expect(client.getFetch()).toBe(mockFetch);
    });
  });
});
