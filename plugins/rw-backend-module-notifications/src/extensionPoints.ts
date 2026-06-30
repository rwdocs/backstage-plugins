import { createExtensionPoint } from "@backstage/backend-plugin-api";
import { CommentRecipientResolver } from "./CommentRecipientResolver";

export interface RwCommentRecipientExtensionPoint {
  /** Replace the built-in comment-notification recipient policy. May only be called once. */
  setRecipientResolver(resolver: CommentRecipientResolver): void;
}

/** Registered by the notifications module; a sibling backend module (same pluginId "rw") consumes
 *  it and calls setRecipientResolver in its init to override who is notified about doc comments.
 *  Single resolver — a second registration throws (mirrors Backstage's setNotificationRecipientResolver
 *  / Slack's setBlockKitRenderer). */
export const rwCommentRecipientExtensionPoint =
  createExtensionPoint<RwCommentRecipientExtensionPoint>({
    id: "rw.comment-recipients",
  });
