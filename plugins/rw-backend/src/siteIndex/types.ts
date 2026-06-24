/** A sparse section→entity claim link (written by the scan). */
export interface SectionOwnershipRow {
  site_ref: string;
  section_ref: string;
  entity_ref: string;
  entity_owner_ref: string | null;
}

/** A section registry row (written by the worker from listSections). */
export interface SectionRow {
  site_ref: string;
  section_ref: string;
  section_path: string;
  parent_section_ref: string | null;
}

/** A page registry row (written by the worker from listPages). */
export interface PageRow {
  site_ref: string;
  section_ref: string;
  subpath: string;
  title: string;
}

/** A row claimed off the queue for processing. */
export interface ClaimedSite {
  siteRef: string;
  resultHash: string | null;
}
