import type { SectionOwnershipRow, SectionRow } from "./types";

export interface RawSection {
  sectionRef: string;
  path: string;
  ancestors: string[]; // nearest-first
}

/** Build the dense `sections` registry: one row per section carrying both structure
 *  (parent_section_ref) and effective ownership. A section is attributed to its nearest claiming
 *  ancestor (incl. itself), else the site-root sentinel (section_ref === siteRef), else a
 *  null-owner site fallback. The claimer's path is stripped so descendant paths become relative
 *  to the owning entity's docs root. */
export function computeSectionRows(
  siteRef: string,
  sections: RawSection[],
  claims: SectionOwnershipRow[],
): SectionRow[] {
  const sentinel = claims.find((c) => c.section_ref === siteRef);
  // Sentinel excluded from realClaims so it doesn't shadow per-section claims;
  // its owner is only the fallback for sections with no more-specific claim.
  const realClaims = new Map(
    claims.filter((c) => c.section_ref !== siteRef).map((c) => [c.section_ref, c]),
  );
  const pathByRef = new Map(sections.map((s) => [s.sectionRef, s.path]));
  const siteOwnerRef = sentinel?.entity_owner_ref ?? null;

  return sections.map((s) => {
    const claimerRef = [s.sectionRef, ...s.ancestors].find((ref) => realClaims.has(ref));
    const claim = claimerRef ? realClaims.get(claimerRef)! : null;
    const entity_ref = claim?.entity_ref ?? siteRef;
    const entity_owner_ref = claim ? claim.entity_owner_ref : siteOwnerRef;
    const claimerPath = claimerRef ? (pathByRef.get(claimerRef) ?? "") : "";
    return {
      site_ref: siteRef,
      section_ref: s.sectionRef,
      section_path: stripPrefix(s.path, claimerPath),
      parent_section_ref: s.ancestors[0] ?? null, // ancestors is nearest-first; [0] is immediate parent
      entity_ref,
      entity_owner_ref,
    };
  });
}

function stripPrefix(full: string, prefix: string): string {
  if (!prefix) return full;
  if (full === prefix) return "";
  return full.startsWith(`${prefix}/`) ? full.slice(prefix.length + 1) : full;
}
