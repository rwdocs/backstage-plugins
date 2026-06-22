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
  document_id: string;
  entity_ref: string;
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
  documentId: string;
  parentId?: string;
  authorRef: string;
  authorProfile?: AuthorProfile;
  body: string;
  selectors: unknown[];
}

export interface ListFilter {
  documentId?: string;
  entityRef?: string;
  status?: CommentStatus;
  parentId?: string | null;
  topLevelOnly?: boolean;
}

const SECTION_ROOT = "section:default/root";

/**
 * Compute the content-owning entity ref from a verbatim documentId + host siteRef.
 * Stored in `entity_ref` for future querying; not used as an authorization boundary
 * (read scope is determined by the host `siteRef` — see `assertSiteVisible` in router.ts).
 */
export function computeEntityRef(documentId: string, siteRef: string): string {
  const i = documentId.indexOf("#");
  const sectionRef = i === -1 ? documentId : documentId.slice(0, i);
  return sectionRef === SECTION_ROOT ? siteRef : sectionRef;
}
