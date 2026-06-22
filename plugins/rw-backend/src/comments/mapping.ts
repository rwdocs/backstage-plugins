import { parseEntityRef } from "@backstage/catalog-model";
import { CommentRow, AuthorProfile } from "./types";
import { toIso } from "./timestamps";

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
  const profile: AuthorProfile | null = row.author_profile ? JSON.parse(row.author_profile) : null;
  const name = profile?.displayName ?? parseEntityRef(row.author_ref).name;

  const isReply = row.parent_id !== null;
  const deleted = row.deleted_at !== null;
  const isAuthor = callerRef !== undefined && callerRef === row.author_ref;

  return {
    id: row.id,
    documentId: row.document_id,
    ...(row.parent_id !== null ? { parentId: row.parent_id } : {}),
    author: {
      id: row.author_ref,
      name,
      ...(profile?.picture ? { avatarUrl: profile.picture } : {}),
    },
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
