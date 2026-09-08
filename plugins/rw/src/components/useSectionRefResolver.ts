import { useCallback, useRef } from "react";
import { useApi, useRouteRef } from "@backstage/core-plugin-api";
import { catalogApiRef, entityRouteRef } from "@backstage/plugin-catalog-react";
import { parseEntityRef } from "@backstage/catalog-model";
import {
  parseAnnotation,
  toEntityPath,
  type ParsedAnnotation,
} from "@rwdocs/backstage-plugin-rw-common";
import { ANNOTATION_KEY, entityDocsPath } from "./constants";

export function useSectionRefResolver(
  sourceEntityRef: string,
  rootSectionRef: string,
): (refs: string[]) => Promise<Record<string, string>> {
  const catalogApi = useApi(catalogApiRef);
  const entityRoute = useRouteRef(entityRouteRef);
  const cache = useRef(new Map<string, { url: string; annotation?: ParsedAnnotation } | null>());

  return useCallback(
    async (refs: string[]): Promise<Record<string, string>> => {
      const unknown = refs.filter((ref) => !cache.current.has(ref));

      if (unknown.length > 0) {
        try {
          const { items } = await catalogApi.getEntitiesByRefs({ entityRefs: unknown });
          for (let i = 0; i < unknown.length; i++) {
            const ref = unknown[i];
            const entity = items[i];
            const annotationValue = entity?.metadata.annotations?.[ANNOTATION_KEY];
            if (annotationValue) {
              const { kind, namespace, name } = parseEntityRef(ref);
              const routeUrl = entityDocsPath(entityRoute, { kind, namespace, name });
              let annotation: ParsedAnnotation | undefined;
              try {
                annotation = parseAnnotation(annotationValue, toEntityPath(ref));
              } catch {
                // Optional root validation must not discard ordinary catalog URLs.
              }
              cache.current.set(ref, { url: routeUrl, annotation });
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
        const cached = cache.current.get(ref);
        if (ref === rootSectionRef) {
          // Eligibility depends on this callback's site/root, not the cached lookup's context.
          const annotation = cached?.annotation;
          if (
            cached &&
            annotation?.entityPath === toEntityPath(sourceEntityRef) &&
            (!annotation.sectionRef || annotation.sectionRef === rootSectionRef)
          ) {
            result[ref] = cached.url;
          } else {
            const { kind, namespace, name } = parseEntityRef(sourceEntityRef);
            result[ref] = entityDocsPath(entityRoute, { kind, namespace, name });
          }
        } else if (cached) {
          result[ref] = cached.url;
        }
      }
      return result;
    },
    [catalogApi, entityRoute, sourceEntityRef, rootSectionRef],
  );
}
