import type { CompoundEntityRef, Entity } from "@backstage/catalog-model";
import { entityRouteParams } from "@backstage/plugin-catalog-react";

export const ANNOTATION_KEY = "rwdocs.org/ref";

/** The entity content-tab path segment that mounts the RW docs viewer (the
 *  `rwEntityContent` EntityContentBlueprint's `path: "docs"`). */
export const DOCS_PATH_SUFFIX = "/docs";

/** Base URL of an entity's RW docs tab: its catalog route + DOCS_PATH_SUFFIX.
 *  Centralised so the '/docs' segment lives in one place — the inbox deep-link,
 *  the cross-section resolver, and the docs icon-link all build on it. */
export function entityDocsPath(
  entityRoute: (ref: { kind: string; namespace: string; name: string }) => string,
  ref: Entity | CompoundEntityRef | string,
): string {
  return entityRoute(entityRouteParams(ref, { encodeParams: true })) + DOCS_PATH_SUFFIX;
}
