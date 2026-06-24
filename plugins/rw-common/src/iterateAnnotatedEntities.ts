import { CATALOG_FILTER_EXISTS } from "@backstage/catalog-client";
import type { Entity } from "@backstage/catalog-model";
import type { BackstageCredentials } from "@backstage/backend-plugin-api";
import type { CatalogService } from "@backstage/plugin-catalog-node";

export const RW_ANNOTATION = "rwdocs.org/ref";

export async function* iterateAnnotatedEntities(
  catalog: Pick<CatalogService, "queryEntities">,
  credentials: BackstageCredentials,
): AsyncGenerator<{ entity: Entity }> {
  let cursor: string | undefined;
  do {
    const response = await catalog.queryEntities(
      cursor
        ? { cursor }
        : { filter: { [`metadata.annotations.${RW_ANNOTATION}`]: CATALOG_FILTER_EXISTS } },
      { credentials },
    );
    for (const entity of response.items) yield { entity };
    cursor = response.pageInfo.nextCursor;
  } while (cursor);
}
