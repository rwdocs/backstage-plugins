export type CommentStatus = "open" | "resolved";

export interface AuthorProfile {
  displayName?: string;
  picture?: string;
}

/** snake_case DB row. Timestamp columns come back as Date (pg), string (sqlite), or
 *  number (better-sqlite3, which stores dateTime as epoch milliseconds). */
export interface CommentRow {
  id: string;
  site_ref: string;
  page_ref: string;
  /** the comment's canonical section ref, stored verbatim from page_ref; join key for owner
   *  derivation via siteIndex's `sections` table; a routing/filter hint, never an
   *  authorization input. */
  section_ref: string;
  parent_id: string | null;
  author_ref: string;
  author_profile: string | null; // JSON AuthorProfile
  body: string;
  body_html: string;
  selectors: string; // JSON unknown[]
  status: CommentStatus;
  created_at: Date | string | number;
  updated_at: Date | string | number;
  resolved_at: Date | string | number | null;
  resolved_by: string | null;
  deleted_at: Date | string | number | null;
}

export interface CreateCommentInput {
  pageRef: string;
  parentId?: string;
  authorRef: string;
  authorProfile?: AuthorProfile;
  body: string;
  selectors: unknown[];
}

export interface ListFilter {
  pageRef?: string;
  sectionRef?: string;
  status?: CommentStatus;
  parentId?: string | null;
  topLevelOnly?: boolean;
}

/** The section ref portion of a pageRef ("<sectionRef>#<subpath>"), verbatim.
 *  rw-core already produced the canonical ref; no transformation/collapse. Total accessor
 *  (no-'#' case returns the whole string); the router's `parsePageRef` extracts the same
 *  sectionRef prefix for well-formed refs but additionally rejects the no-/leading-'#' cases with
 *  a 400 at the HTTP boundary — keep the two in sync if the format changes. */
export function sectionRefOf(pageRef: string): string {
  const i = pageRef.indexOf("#");
  return i === -1 ? pageRef : pageRef.slice(0, i);
}

/** The subpath portion of a pageRef ("<sectionRef>#<subpath>").
 *  Returns empty string when there is no "#". */
export function subpathOf(pageRef: string): string {
  const i = pageRef.indexOf("#");
  return i === -1 ? "" : pageRef.slice(i + 1);
}
