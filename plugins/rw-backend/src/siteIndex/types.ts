/** A sparse section→entity claim link (written by the scan). */
export interface SectionOwnershipRow {
  site_ref: string;
  section_ref: string;
  entity_ref: string;
  entity_owner_ref: string | null;
}

/** A dense section registry row (one per section, written by the worker from listSections + the
 *  effective-ownership rollup). `section_path` is owner-relative (the claimer's prefix stripped),
 *  and `entity_ref`/`entity_owner_ref` are the section's effective owner after nearest-ancestor
 *  inheritance + site-root sentinel fallback. */
export interface SectionRow {
  site_ref: string;
  section_ref: string;
  section_path: string;
  parent_section_ref: string | null;
  entity_ref: string;
  entity_owner_ref: string | null;
}

/** A page registry row (written by the worker from listPages). */
export interface PageRow {
  site_ref: string;
  section_ref: string;
  subpath: string;
  title: string;
  /** Last-modified epoch millis, or null when unknown (excluded from the feed). */
  last_modified: number | null;
}

/** A row claimed off the queue for processing. */
export interface ClaimedSite {
  siteRef: string;
  resultHash: string | null;
}
