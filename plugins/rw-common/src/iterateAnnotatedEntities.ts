import { CATALOG_FILTER_EXISTS } from "@backstage/catalog-client";
import type { Entity } from "@backstage/catalog-model";
import type { BackstageCredentials } from "@backstage/backend-plugin-api";
import type { CatalogService } from "@backstage/plugin-catalog-node";

export const RW_ANNOTATION = "rwdocs.org/ref";

export async function* iterateAnnotatedEntities(
  catalog: Pick<CatalogService, "streamEntities">,
  credentials: BackstageCredentials,
): AsyncGenerator<{ entity: Entity }> {
  for await (const batch of catalog.streamEntities(
    { filter: { [`metadata.annotations.${RW_ANNOTATION}`]: CATALOG_FILTER_EXISTS } },
    { credentials },
  )) {
    for (const entity of batch) yield { entity };
  }
}
