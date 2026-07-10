import { parseEntityRef } from "@backstage/catalog-model";

export const ANNOTATION_KEY = "rwdocs.org/ref";

/** rw's implicit site-root section is always `section:<namespace>/root` — kind
 *  "section", name "root", carrying the site's (possibly custom) namespace. */
const ROOT_SECTION_KIND = "section";
const ROOT_SECTION_NAME = "root";

/** Whether a section ref is the site-root section — the ancestry backstop the
 *  viewer resolves every cross-entity link against, which the host must map to
 *  the root/site entity. Matched by kind+name (not the literal
 *  `section:default/root`) so a custom-namespace root like `section:acme/root`
 *  resolves too, while a content section merely named "root" (e.g. a
 *  `domain:default/root` folder) is left to catalog resolution. */
export function isRootSectionRef(ref: string): boolean {
  try {
    const { kind, name } = parseEntityRef(ref);
    return kind === ROOT_SECTION_KIND && name === ROOT_SECTION_NAME;
  } catch {
    return false;
  }
}

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
