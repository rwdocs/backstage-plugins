import { CommentActivity } from "./CommentActivity";

/**
 * Registered by a backend module via rwCommentProcessingExtensionPoint; rw-backend
 * invokes process() at runtime for each comment activity. Follows the same shape as
 * NotificationProcessor in @backstage/plugin-notifications-node.
 */
export interface CommentProcessor {
  /** Stable name for logging. */
  getName(): string;
  /** React to a comment activity (e.g. send a notification). Should not throw. */
  process(comment: CommentActivity): Promise<void>;
}
