import { Readable } from "stream";
import type { Config } from "@backstage/config";
import type { LoggerService, AuthService } from "@backstage/backend-plugin-api";
import type { CatalogService } from "@backstage/plugin-catalog-node";
import type { DocumentCollatorFactory, IndexableDocument } from "@backstage/plugin-search-common";
import type { Permission } from "@backstage/plugin-permission-common";
import { catalogEntityReadPermission } from "@backstage/plugin-catalog-common/alpha";
import { CATALOG_FILTER_EXISTS } from "@backstage/catalog-client";
import { stringifyEntityRef } from "@backstage/catalog-model";
import type { Entity } from "@backstage/catalog-model";
import { createSite, type RwSite, type NavItemResponse } from "@rwdocs/core";
import {
  parseAnnotation,
  toEntityPath,
  readRwSiteConfig,
  type RwSiteConfig,
} from "@rwdocs/backstage-plugin-rw-common";

const RW_ANNOTATION = "rwdocs.org/ref";
const DEFAULT_LOCATION_TEMPLATE = "/catalog/:namespace/:kind/:name/docs/:path";

function applyLocationTemplate(
  template: string,
  params: { namespace: string; kind: string; name: string; path: string },
): string {
  return template
    .replace(":namespace", encodeURIComponent(params.namespace))
    .replace(":kind", encodeURIComponent(params.kind))
    .replace(":name", encodeURIComponent(params.name))
    .replace(":path", params.path);
}

function collectPaths(items: NavItemResponse[]): string[] {
  const paths: string[] = [];
  for (const item of items) {
    paths.push(item.path.replace(/^\//, ""));
    if (item.children) {
      paths.push(...collectPaths(item.children));
    }
  }
  return paths;
}

export class RwDocsCollatorFactory implements DocumentCollatorFactory {
  readonly type: string;
  readonly visibilityPermission: Permission = catalogEntityReadPermission;

  private constructor(
    type: string,
    private readonly siteConfig: RwSiteConfig,
    private readonly locationTemplate: string,
    private readonly logger: LoggerService,
    private readonly auth: AuthService,
    private readonly catalog: CatalogService,
  ) {
    this.type = type;
  }

  static fromConfig(
    config: Config,
    deps: {
      logger: LoggerService;
      auth: AuthService;
      catalog: CatalogService;
    },
  ): RwDocsCollatorFactory {
    const siteConfig = readRwSiteConfig(config);

    const type = config.getOptionalString("search.collators.rw.type") ?? "rw";
    const locationTemplate =
      config.getOptionalString("search.collators.rw.locationTemplate") ?? DEFAULT_LOCATION_TEMPLATE;

    return new RwDocsCollatorFactory(type, siteConfig, locationTemplate, deps.logger, deps.auth, deps.catalog);
  }

  async getCollator(): Promise<Readable> {
    return Readable.from(this.execute());
  }

  private async *execute(): AsyncGenerator<IndexableDocument> {
    this.logger.info("Starting RW docs indexing");
    const credentials = await this.auth.getOwnServiceCredentials();
    const localEntityPath = this.siteConfig.entity
      ? toEntityPath(this.siteConfig.entity)
      : undefined;

    let docCount = 0;
    let cursor: string | undefined;

    do {
      const response = await this.catalog.queryEntities(
        cursor
          ? { cursor }
          : {
              filter: {
                [`metadata.annotations.${RW_ANNOTATION}`]: CATALOG_FILTER_EXISTS,
              },
            },
        { credentials },
      );

      for (const entity of response.items) {
        try {
          for await (const doc of this.indexEntity(entity, localEntityPath)) {
            docCount++;
            yield doc;
          }
        } catch (err) {
          const ref = stringifyEntityRef(entity);
          this.logger.warn(`Failed to index entity ${ref}: ${err}`);
        }
      }

      cursor = response.pageInfo.nextCursor;
    } while (cursor);

    this.logger.info(`RW docs indexing complete: ${docCount} documents indexed`);
  }

  private async *indexEntity(
    entity: Entity,
    localEntityPath: string | undefined,
  ): AsyncGenerator<IndexableDocument> {
    const annotationValue = entity.metadata?.annotations?.[RW_ANNOTATION];
    const selfEntityPath = toEntityPath(stringifyEntityRef(entity));
    const parsed = parseAnnotation(annotationValue, selfEntityPath);
    if (!parsed) return;

    // In projectDir mode, skip entities whose target doesn't match the configured entity
    if (localEntityPath && parsed.entityPath !== localEntityPath) {
      return;
    }

    const site = this.createSite(parsed.entityPath);
    const navigation = await site.getNavigation(parsed.sectionRef ?? null);
    const scopePath = navigation.scope?.path?.replace(/^\//, "") ?? "";
    const paths = collectPaths(navigation.items);

    const entityRef = stringifyEntityRef(entity);
    this.logger.info(`Indexing entity ${entityRef} (${paths.length} pages)`);
    const ref = {
      kind: entity.kind.toLocaleLowerCase("en-US"),
      namespace: entity.metadata?.namespace ?? "default",
      name: entity.metadata?.name as string,
    };

    for (const path of paths) {
      try {
        const doc = await site.renderSearchDocument(path);
        if (!doc) continue;

        const relativePath = scopePath && path.startsWith(scopePath)
          ? path.slice(scopePath.length + 1)
          : path;

        yield {
          title: doc.title,
          text: doc.text,
          location: applyLocationTemplate(this.locationTemplate, {
            namespace: ref.namespace,
            kind: ref.kind,
            name: ref.name,
            path: relativePath,
          }),
          authorization: {
            resourceRef: entityRef,
          },
        };
      } catch (err) {
        this.logger.warn(`Failed to render page ${path} for ${entityRef}: ${err}`);
      }
    }
  }

  private createSite(entityPath: string): RwSite {
    if (this.siteConfig.projectDir) {
      return createSite({
        projectDir: this.siteConfig.projectDir,
        diagrams: this.siteConfig.diagrams,
      });
    }

    return createSite({
      s3: { ...this.siteConfig.s3!, entity: entityPath },
      diagrams: this.siteConfig.diagrams,
    });
  }
}
