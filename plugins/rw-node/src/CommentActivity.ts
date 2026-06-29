export type CommentAction = "created" | "resolved";

/**
 * A resolved comment activity (a comment created or a thread resolved), pushed to
 * every registered CommentProcessor. Self-contained: a processor needs no DB access.
 */
export interface CommentActivity {
  action: CommentAction;
  occurredAt: string; // ISO-8601, from the row timestamp
  commentId: string;
  rootId: string; // parentId ?? commentId (created) / commentId (resolved)
  parentId: string | null; // null => top-level
  siteRef: string;
  sectionRef: string;
  pageRef: string; // "<sectionRef>#<subpath>"
  actorRef: string; // the user who triggered the activity
  actorName: string; // resolved display name
  participants: string[]; // distinct author refs, creation order
  sectionOwnerRef: string | null; // recipient for top-level creates
  entityRef: string | null; // deep-link target (null => no link)
  pageTitle: string | null;
  sectionTitle: string | null;
  viewerPath: string; // section_path + subpath, for the deep link
  bodySnippet: string; // plain-text preview of the triggering comment
}
