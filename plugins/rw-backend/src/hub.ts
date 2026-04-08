import type { LoggerService } from "@backstage/backend-plugin-api";
import { createSite, type RwSite, type SiteConfig, type DiagramsConfig } from "@rwdocs/core";
import { toEntityPath, type S3Config } from "@rwdocs/backstage-plugin-rw-common";

export interface HubOptions {
  s3?: S3Config;
  projectDir?: string;
  /** Entity ref in any format accepted by parseEntityRef. Normalized internally. */
  entity?: string;
  diagrams?: DiagramsConfig;
  cacheSize?: number;
}

export class Hub {
  private readonly options: HubOptions;
  private readonly cache: Map<string, RwSite> = new Map();
  private readonly maxSize: number;

  constructor(options: HubOptions) {
    this.options = {
      ...options,
      entity: options.entity ? toEntityPath(options.entity) : undefined,
    };
    this.maxSize = options.cacheSize ?? 20;
  }

  getSite(entityRef: string): RwSite | undefined {
    if (this.options.projectDir) {
      return this.getLocalSite(entityRef);
    }
    return this.getS3Site(entityRef);
  }

  private getLocalSite(entityRef: string): RwSite | undefined {
    if (entityRef !== this.options.entity) {
      return undefined;
    }

    const cached = this.cache.get(entityRef);
    if (cached) return cached;

    const site = createSite({
      projectDir: this.options.projectDir,
      diagrams: this.options.diagrams,
    });
    this.cache.set(entityRef, site);
    return site;
  }

  async reloadAll(logger: LoggerService) {
    const entries = [...this.cache.entries()];
    for (const [ref, site] of entries) {
      try {
        const reloaded = await site.reload();
        if (reloaded) {
          logger.info(`Reloaded site: ${ref}`);
        }
      } catch (err) {
        logger.warn(`Failed to reload site ${ref}: ${err}`);
      }
    }
  }

  private getS3Site(entityRef: string): RwSite {
    const cached = this.cache.get(entityRef);
    if (cached) {
      this.cache.delete(entityRef);
      this.cache.set(entityRef, cached);
      return cached;
    }

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value!;
      this.cache.delete(firstKey);
    }

    const s3 = this.options.s3!;
    const config: SiteConfig = {
      s3: { ...s3, entity: entityRef },
      diagrams: this.options.diagrams,
    };

    const site = createSite(config);
    this.cache.set(entityRef, site);
    return site;
  }
}
