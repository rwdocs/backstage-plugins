/** One recently-updated page in the global "Latest Changes" feed. */
export interface LatestChangeItem {
  /** The doc-site entity that owns this page (`kind:namespace/name`). */
  entityRef: string;
  /** Path into the RW viewer, `[section_path, subpath].join("/")`. */
  viewerPath: string;
  /** Display title of the page. */
  title: string;
  /** Last-modified time as an ISO-8601 UTC string. Never the epoch — unknown
   *  pages are excluded server-side, so this is always a real timestamp. */
  lastModified: string;
}

export interface LatestChangesResponse {
  /** True once any page has a known modification time. When false the feed is
   *  still indexing (freshly deployed / mid first scan) rather than empty. */
  hasAnyDated: boolean;
  items: LatestChangeItem[];
  /** Forward-only cursor. `nextCursor` absent means no more pages. */
  pageInfo: { nextCursor?: string };
}

/** Latest-changes request params. Initial request may send `limit`; follow-up
 *  sends only `cursor`. */
export interface LatestChangesQuery {
  cursor?: string;
  limit?: number;
}
