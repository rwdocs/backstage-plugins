import { Hub } from "./hub";
import { createSite } from "@rwdocs/core";

jest.mock("@rwdocs/core");

const mockCreateSite = createSite as jest.MockedFunction<typeof createSite>;

function mockSite() {
  return {
    getNavigation: jest.fn(),
    renderPage: jest.fn(),
    reload: jest.fn(),
  } as any;
}

describe("Hub", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("S3 mode", () => {
    it("creates a site on first access for an entity ref", () => {
      const site = mockSite();
      mockCreateSite.mockReturnValue(site);

      const hub = new Hub({
        s3: { bucket: "my-bucket", region: "us-east-1" },
      });

      const result = hub.getSite("component/default/arch");

      expect(result).toBe(site);
      expect(mockCreateSite).toHaveBeenCalledWith({
        s3: {
          bucket: "my-bucket",
          region: "us-east-1",
          entity: "component/default/arch",
        },
      });
    });

    it("returns cached site on second access", () => {
      const site = mockSite();
      mockCreateSite.mockReturnValue(site);

      const hub = new Hub({
        s3: { bucket: "my-bucket" },
      });

      const first = hub.getSite("component/default/arch");
      const second = hub.getSite("component/default/arch");

      expect(first).toBe(second);
      expect(mockCreateSite).toHaveBeenCalledTimes(1);
    });

    it("creates separate sites for different entity refs", () => {
      const site1 = mockSite();
      const site2 = mockSite();
      mockCreateSite.mockReturnValueOnce(site1).mockReturnValueOnce(site2);

      const hub = new Hub({
        s3: { bucket: "my-bucket" },
      });

      const first = hub.getSite("component/default/arch");
      const second = hub.getSite("component/default/billing");

      expect(first).toBe(site1);
      expect(second).toBe(site2);
      expect(mockCreateSite).toHaveBeenCalledTimes(2);
    });

    it("evicts least recently used site when cache is full", () => {
      const sites = [mockSite(), mockSite(), mockSite()];
      let i = 0;
      mockCreateSite.mockImplementation(() => sites[i++]);

      const hub = new Hub({
        s3: { bucket: "my-bucket" },
        cacheSize: 2,
      });

      hub.getSite("a/b/one");
      hub.getSite("a/b/two");
      hub.getSite("a/b/three"); // evicts "one"

      expect(mockCreateSite).toHaveBeenCalledTimes(3);

      // "one" was evicted, accessing it creates a new site
      mockCreateSite.mockReturnValue(mockSite());
      hub.getSite("a/b/one");
      expect(mockCreateSite).toHaveBeenCalledTimes(4);
    });

    it("passes shared config fields to every site", () => {
      mockCreateSite.mockReturnValue(mockSite());

      const hub = new Hub({
        s3: {
          bucket: "my-bucket",
          region: "us-east-1",
          endpoint: "http://localhost:4566",
          bucketRootPath: "docs",
          accessKeyId: "key",
          secretAccessKey: "secret",
        },
        linkPrefix: "/docs",
        diagrams: { krokiUrl: "http://kroki:8080" },
      });

      hub.getSite("component/default/arch");

      expect(mockCreateSite).toHaveBeenCalledWith({
        s3: {
          bucket: "my-bucket",
          region: "us-east-1",
          endpoint: "http://localhost:4566",
          bucketRootPath: "docs",
          accessKeyId: "key",
          secretAccessKey: "secret",
          entity: "component/default/arch",
        },
        linkPrefix: "/docs",
        diagrams: { krokiUrl: "http://kroki:8080" },
      });
    });
  });

  describe("projectDir mode", () => {
    it("returns site for the configured entity ref", () => {
      const site = mockSite();
      mockCreateSite.mockReturnValue(site);

      const hub = new Hub({
        projectDir: "/path/to/docs",
        entity: "component/default/arch",
        linkPrefix: "/docs",
        diagrams: { krokiUrl: "http://kroki:8080" },
      });

      const result = hub.getSite("component/default/arch");

      expect(result).toBe(site);
      expect(mockCreateSite).toHaveBeenCalledWith({
        projectDir: "/path/to/docs",
        linkPrefix: "/docs",
        diagrams: { krokiUrl: "http://kroki:8080" },
      });
    });

    it("returns undefined for non-matching entity ref", () => {
      mockCreateSite.mockReturnValue(mockSite());

      const hub = new Hub({
        projectDir: "/path/to/docs",
        entity: "component/default/arch",
      });

      const result = hub.getSite("component/default/other");

      expect(result).toBeUndefined();
    });
  });
});
