import { CommentActivity } from "@rwdocs/backstage-plugin-rw-node";

/** A "new thread" is a top-level comment creation (not a reply, not a resolve). The owner-side
 *  vs participant-side notification policy — recipients, coalescing scope, and topic — all branch
 *  on this single predicate, so it lives in one place to keep the notifier and the default
 *  resolver from drifting. */
export function isNewThread(activity: CommentActivity): boolean {
  return activity.action === "created" && activity.parentId === null;
}
