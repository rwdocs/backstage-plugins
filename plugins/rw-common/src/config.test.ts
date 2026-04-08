import { ConfigReader } from "@backstage/config";
import { readRwSiteConfig } from "./config";

describe("readRwSiteConfig", () => {
  it("reads projectDir config", () => {
    const config = new ConfigReader({
      rw: { projectDir: "/docs", entity: "component:default/arch" },
    });
    expect(readRwSiteConfig(config)).toEqual({
      projectDir: "/docs",
      entity: "component:default/arch",
      s3: undefined,
      diagrams: undefined,
    });
  });

  it("reads s3 config", () => {
    const config = new ConfigReader({
      rw: { s3: { bucket: "my-bucket", region: "us-east-1" } },
    });
    expect(readRwSiteConfig(config)).toEqual({
      projectDir: undefined,
      entity: undefined,
      s3: {
        bucket: "my-bucket",
        region: "us-east-1",
        endpoint: undefined,
        bucketRootPath: undefined,
        accessKeyId: undefined,
        secretAccessKey: undefined,
      },
      diagrams: undefined,
    });
  });

  it("reads s3 config with all optional fields", () => {
    const config = new ConfigReader({
      rw: {
        s3: {
          bucket: "my-bucket",
          region: "us-east-1",
          endpoint: "https://s3.example.com",
          bucketRootPath: "docs/",
          accessKeyId: "AKIA...",
          secretAccessKey: "secret",
        },
      },
    });
    const result = readRwSiteConfig(config);
    expect(result.s3).toEqual({
      bucket: "my-bucket",
      region: "us-east-1",
      endpoint: "https://s3.example.com",
      bucketRootPath: "docs/",
      accessKeyId: "AKIA...",
      secretAccessKey: "secret",
    });
  });

  it("reads diagrams config", () => {
    const config = new ConfigReader({
      rw: {
        s3: { bucket: "my-bucket" },
        diagrams: { krokiUrl: "https://kroki.example.com", dpi: 150 },
      },
    });
    expect(readRwSiteConfig(config).diagrams).toEqual({
      krokiUrl: "https://kroki.example.com",
      dpi: 150,
    });
  });

  it("throws when neither projectDir nor s3 is set", () => {
    const config = new ConfigReader({ rw: {} });
    expect(() => readRwSiteConfig(config)).toThrow(
      "Either rw.projectDir or rw.s3 must be configured",
    );
  });

  it("throws when projectDir is set without entity", () => {
    const config = new ConfigReader({ rw: { projectDir: "/docs" } });
    expect(() => readRwSiteConfig(config)).toThrow(
      "rw.entity is required when rw.projectDir is set",
    );
  });
});
