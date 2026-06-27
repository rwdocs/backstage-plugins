export interface InboxItem {
  commentId: string;
  siteRef: string;
  pageRef: string;
  entityRef: string;
  viewerPath: string;
  pageTitle: string;
  author: { id: string; name: string; avatarUrl?: string };
  bodySnippet: string;
  createdAt: string;
  updatedAt: string;
  replyCount: number;
}

export interface InboxResponse {
  built: boolean;
  items: InboxItem[];
  /** Forward-only cursor. `nextCursor` absent (not null or "") means no more
   *  pages — callers must treat any absent/undefined value as end-of-results. */
  pageInfo: { nextCursor?: string };
  /** Full filtered totals (not page counts) for the two filter segments. */
  openCount: number;
  unansweredCount: number;
}

/** Inbox request params. Initial request sends filter/sort; follow-up sends
 *  only `cursor` (which carries the filter/sort). */
export interface InboxQuery {
  filter?: "open" | "unanswered";
  sort?: "newest" | "oldest";
  cursor?: string;
  limit?: number;
}
