import { CommentActivity } from "@rwdocs/backstage-plugin-rw-node";

/** Decides the notification recipients for a resolved comment activity. A single resolver owns
 *  the decision for every audience (new threads and replies/resolves); delegate the audiences you
 *  don't want to change to the built-in DefaultCommentRecipientResolver. Mirrors Backstage's
 *  NotificationRecipientResolver: a single, full-ownership resolver with no per-call defer
 *  sentinel. */
export interface CommentRecipientResolver {
  /** Stable name for logging. */
  getName(): string;
  /** Recipient entity refs (users or groups; groups are expanded downstream by Backstage's
   *  notification resolver). Return [] to notify nobody. Should not throw — a throw discards the
   *  notification (fail-closed). */
  resolveRecipients(activity: CommentActivity): Promise<string[]>;
}
