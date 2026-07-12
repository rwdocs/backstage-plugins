import {
  nearestClaim,
  stripSectionPrefix,
  type SiteClaim,
  type SiteClaims,
} from "@rwdocs/backstage-plugin-rw-common";
import type { SectionOwnershipRow, SectionRow } from "./types";

export interface RawSection {
  sectionRef: string;
  path: string;
  ancestors: string[]; // nearest-first
}

/** Rebuilds the {@link SiteClaims} the scan wrote, from the rows it wrote them to.
 *  The self-host claim is stored under the site ref as its `section_ref` (a
 *  sentinel), so it has to be lifted back out before section lookups see it —
 *  otherwise it would shadow a real claim on a section that happens to carry the
 *  site's own ref. */
function claimsFromRows(siteRef: string, rows: SectionOwnershipRow[]): SiteClaims {
  const bySection = new Map<string, SiteClaim>();
  let host: SiteClaim | undefined;

  for (const row of rows) {
    const claim: SiteClaim = { entityRef: row.entity_ref, ownerRef: row.entity_owner_ref };
    if (row.section_ref === siteRef) host = claim;
    else bySection.set(row.section_ref, claim);
  }

  return { siteRef, entityPath: "", bySection, host, unscoped: undefined };
}

/** Build the dense `sections` registry: one row per section carrying both structure
 *  (parent_section_ref) and effective ownership. A section is attributed to its nearest claiming
 *  ancestor (incl. itself), else the site-root sentinel, else a null-owner site fallback — the
 *  rule `@rwdocs/backstage-plugin-rw-common` also gives the search collator, so one page is owned
 *  by one entity on every surface. The claimer's path is stripped so descendant paths become
 *  relative to the owning entity's docs root. */
export function computeSectionRows(
  siteRef: string,
  sections: RawSection[],
  claims: SectionOwnershipRow[],
): SectionRow[] {
  const siteClaims = claimsFromRows(siteRef, claims);
  const pathByRef = new Map(sections.map((s) => [s.sectionRef, s.path]));

  return sections.map((s) => {
    const owner = nearestClaim(siteClaims, [s.sectionRef, ...s.ancestors]);
    // A section nothing claims, on a site nothing hosts, still needs a row: comments
    // and the changes feed join through it. It falls back to the site entity, whose
    // Docs tab may not exist — see the dead-link case in the follow-up issue.
    const entity_ref = owner?.claim.entityRef ?? siteRef;
    const entity_owner_ref = owner?.claim.ownerRef ?? null;
    // `nearestClaim` returns "" for the root fallback, which strips nothing.
    const claimerPath = owner?.sectionRef ? (pathByRef.get(owner.sectionRef) ?? "") : "";

    return {
      site_ref: siteRef,
      section_ref: s.sectionRef,
      section_path: stripSectionPrefix(s.path, claimerPath),
      parent_section_ref: s.ancestors[0] ?? null, // ancestors is nearest-first; [0] is immediate parent
      entity_ref,
      entity_owner_ref,
    };
  });
}
