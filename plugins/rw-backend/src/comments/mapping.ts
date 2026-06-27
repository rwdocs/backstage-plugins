import { CommentRow } from "./types";
import { toIso } from "./timestamps";
import { authorFromRow } from "./author";

export interface CommentResponse {
  id: string;
  documentId: string;
  parentId?: string;
  author: { id: string; name: string; avatarUrl?: string };
  body: string;
  bodyHtml: string;
  selectors: unknown[];
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  canDelete: boolean;
  canRestore: boolean;
  canResolve: boolean;
}

export function toCommentResponse(row: CommentRow, callerRef: string | undefined): CommentResponse {
  const isReply = row.parent_id !== null;
  const deleted = row.deleted_at !== null;
  const isAuthor = callerRef !== undefined && callerRef === row.author_ref;

  return {
    id: row.id,
    documentId: row.page_ref, // viewer wire field — preserved until @rwdocs/viewer is updated
    ...(row.parent_id !== null ? { parentId: row.parent_id } : {}),
    author: authorFromRow(row),
    body: row.body,
    bodyHtml: row.body_html,
    selectors: JSON.parse(row.selectors),
    status: row.status,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
    ...(deleted ? { deletedAt: toIso(row.deleted_at) } : {}),
    canDelete: isReply && !deleted && isAuthor,
    canRestore: deleted && isAuthor,
    // Resolve is collaborative — any authenticated user may resolve/reopen a
    // thread, unlike canDelete/canRestore which are author-only.
    canResolve: !isReply && !deleted,
  };
}
