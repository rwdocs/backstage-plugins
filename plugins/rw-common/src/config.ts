import type { Config } from "@backstage/config";

export interface S3Config {
  bucket: string;
  region?: string;
  endpoint?: string;
  bucketRootPath?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface RwDiagramsConfig {
  krokiUrl?: string;
  dpi?: number;
}

export interface RwSiteConfig {
  projectDir?: string;
  entity?: string;
  s3?: S3Config;
  diagrams?: RwDiagramsConfig;
}

/**
 * Reads the shared `rw` site configuration from Backstage config.
 *
 * Validates that either `rw.projectDir` or `rw.s3` is set, and that
 * `rw.entity` is present when `rw.projectDir` is used.
 */
export function readRwSiteConfig(config: Config): RwSiteConfig {
  const projectDir = config.getOptionalString("rw.projectDir");
  const entity = config.getOptionalString("rw.entity");

  const s3Config = config.getOptionalConfig("rw.s3");
  const s3 = s3Config
    ? {
        bucket: s3Config.getString("bucket"),
        region: s3Config.getOptionalString("region"),
        endpoint: s3Config.getOptionalString("endpoint"),
        bucketRootPath: s3Config.getOptionalString("bucketRootPath"),
        accessKeyId: s3Config.getOptionalString("accessKeyId"),
        secretAccessKey: s3Config.getOptionalString("secretAccessKey"),
      }
    : undefined;

  const diagramsConfig = config.getOptionalConfig("rw.diagrams");
  const diagrams = diagramsConfig
    ? {
        krokiUrl: diagramsConfig.getOptionalString("krokiUrl"),
        dpi: diagramsConfig.getOptionalNumber("dpi"),
      }
    : undefined;

  if (!projectDir && !s3) {
    throw new Error("Either rw.projectDir or rw.s3 must be configured");
  }

  if (projectDir && !entity) {
    throw new Error("rw.entity is required when rw.projectDir is set");
  }

  return { projectDir, entity, s3, diagrams };
}
