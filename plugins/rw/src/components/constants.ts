export const ANNOTATION_KEY = "rwdocs.org/ref";
export const ROOT_SECTION_REF = "section:default/root";

/** The entity content-tab path segment that mounts the RW docs viewer (the
 *  `rwEntityContent` EntityContentBlueprint's `path: "docs"`). */
export const DOCS_PATH_SUFFIX = "/docs";

/** Base URL of an entity's RW docs tab: its catalog route + DOCS_PATH_SUFFIX.
 *  Centralised so the '/docs' segment lives in one place — the inbox deep-link,
 *  the cross-section resolver, and the docs icon-link all build on it. */
export function entityDocsPath(
  entityRoute: (ref: { kind: string; namespace: string; name: string }) => string,
  ref: { kind: string; namespace: string; name: string },
): string {
  return entityRoute(ref) + DOCS_PATH_SUFFIX;
}
