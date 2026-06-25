import { useCallback, useRef } from "react";
import { useApi, useRouteRef } from "@backstage/core-plugin-api";
import { catalogApiRef, entityRouteRef } from "@backstage/plugin-catalog-react";
import { parseEntityRef } from "@backstage/catalog-model";
import { ANNOTATION_KEY, ROOT_SECTION_REF, entityDocsPath } from "./constants";

export function useSectionRefResolver(
  sourceEntityRef: string,
): (refs: string[]) => Promise<Record<string, string>> {
  const catalogApi = useApi(catalogApiRef);
  const entityRoute = useRouteRef(entityRouteRef);
  const cache = useRef(new Map<string, string | null>());

  return useCallback(
    async (refs: string[]): Promise<Record<string, string>> => {
      const unknown = refs.filter((r) => !cache.current.has(r));

      const catalogRefs: string[] = [];
      for (const ref of unknown) {
        if (ref === ROOT_SECTION_REF) {
          const { kind, namespace, name } = parseEntityRef(sourceEntityRef);
          const routeUrl = entityDocsPath(entityRoute, { kind, namespace, name });
          cache.current.set(ref, routeUrl);
        } else {
          catalogRefs.push(ref);
        }
      }

      if (catalogRefs.length > 0) {
        try {
          const { items } = await catalogApi.getEntitiesByRefs({ entityRefs: catalogRefs });
          for (let i = 0; i < catalogRefs.length; i++) {
            const ref = catalogRefs[i];
            const entity = items[i];
            if (entity?.metadata.annotations?.[ANNOTATION_KEY]) {
              const { kind, namespace, name } = parseEntityRef(ref);
              const routeUrl = entityDocsPath(entityRoute, { kind, namespace, name });
              cache.current.set(ref, routeUrl);
            } else {
              cache.current.set(ref, null);
            }
          }
        } catch {
          // On failure, leave uncached so they can be retried
        }
      }

      const result: Record<string, string> = {};
      for (const ref of refs) {
        const url = cache.current.get(ref);
        if (url !== null && url !== undefined) {
          result[ref] = url;
        }
      }
      return result;
    },
    [catalogApi, entityRoute, sourceEntityRef],
  );
}
