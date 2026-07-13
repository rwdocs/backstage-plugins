import { parseEntityRef, stringifyEntityRef } from "@backstage/catalog-model";
import { InputError } from "@backstage/errors";

/**
 * A page's absolute identity: which site, which section within it, and which
 * page within that section.
 *
 * It carries its own site, so it stands alone: a consumer holding nothing but
 * the string — a search hit handed to a reader, with no ambient site — can
 * address the page.
 */
export interface SitePageRef {
  /** Backstage entity ref of the site entity, e.g. "component:default/platform". */
  siteRef: string;
  /** The rw section ref, e.g. "section:default/handbook". */
  sectionRef: string;
  /** The page's path within the section. "" is the section root. */
  subpath: string;
}

/**
 * Serializes a {@link SitePageRef} to its canonical string form,
 * `<siteRef>#<sectionRef>[#<subpath>]`:
 *
 *   component:default/platform#section:default/handbook#setup/install
 *   component:default/platform#section:default/handbook              (section root)
 *
 * `siteRef` is normalized (`Component:Default/Platform` and `component:platform`
 * both yield `component:default/platform`), so one page has exactly one handle
 * and refs can be compared as strings. The round trip through
 * {@link parseSitePageRef} is exact for an already-normalized ref; a
 * non-canonical `siteRef` (e.g. `component:platform`) comes back normalized
 * (`component:default/platform`) rather than byte-identical.
 *
 * @throws InputError if `siteRef` is not a valid entity ref, `siteRef` contains
 *   a `#`, `sectionRef` is empty, or `sectionRef` contains a `#`.
 */
export function stringifySitePageRef(ref: SitePageRef): string {
  const siteRef = normalizeSiteRef(ref.siteRef);
  if (!ref.sectionRef) {
    throw new InputError(`Invalid site page ref: section ref is empty`);
  }
  if (ref.sectionRef.includes("#")) {
    throw new InputError(`Invalid site page ref: section ref "${ref.sectionRef}" contains "#"`);
  }
  const tail = ref.subpath ? `#${ref.subpath}` : "";
  return `${siteRef}#${ref.sectionRef}${tail}`;
}

/**
 * Parses the canonical string form produced by {@link stringifySitePageRef}.
 *
 * The section ref itself contains `:` and `/`, so the split is positional, not
 * greedy: the first `#` ends the site ref, the second ends the section ref, and
 * everything after the second is the subpath verbatim — a `#` inside a subpath
 * survives the round trip. A ref with no second `#` (or a trailing one) is a
 * section root, i.e. `subpath: ""`.
 *
 * A `..` in the subpath is NOT rejected here: a syntactically valid ref naming a
 * bad path is a different failure than a mangled ref. Path-traversal defence
 * lives at rw-backend's `/markdown` route, which is where the path is used.
 *
 * @throws InputError if the ref has no `#`, its site ref is not a valid entity
 *   ref, or its section ref is empty.
 */
export function parseSitePageRef(ref: string): SitePageRef {
  const siteEnd = ref.indexOf("#");
  if (siteEnd === -1) {
    throw new InputError(
      `Invalid site page ref: "${ref}" (expected "<siteRef>#<sectionRef>[#<subpath>]")`,
    );
  }

  const siteRef = normalizeSiteRef(ref.slice(0, siteEnd));
  const rest = ref.slice(siteEnd + 1);

  const sectionEnd = rest.indexOf("#");
  const sectionRef = sectionEnd === -1 ? rest : rest.slice(0, sectionEnd);
  const subpath = sectionEnd === -1 ? "" : rest.slice(sectionEnd + 1);

  if (!sectionRef) {
    throw new InputError(`Invalid site page ref: "${ref}" has an empty section ref`);
  }

  return { siteRef, sectionRef, subpath };
}

function normalizeSiteRef(siteRef: string): string {
  let normalized: string;
  try {
    normalized = stringifyEntityRef(parseEntityRef(siteRef));
  } catch {
    throw new InputError(`Invalid site page ref: "${siteRef}" is not a valid entity ref`);
  }
  if (normalized.includes("#")) {
    throw new InputError(`Invalid site page ref: site ref "${normalized}" contains "#"`);
  }
  return normalized;
}
