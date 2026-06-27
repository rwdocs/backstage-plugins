import type { LoggerService } from "@backstage/backend-plugin-api";

/**
 * `mutation` and `denied` are the only variants emitted today. `entity-not-visible`,
 * `oversized-list`, and `error` are defined ahead of their emitters as intentional
 * forward hooks — the switch in `logCommentOp` already handles them so adding an
 * emitter later requires no structural change here.
 */
export type CommentLogEvent =
  | { kind: "mutation"; op: string; siteRef: string; commentId: string; parentId?: string }
  | { kind: "denied"; op: string; permission: string; userEntityRef: string }
  | { kind: "entity-not-visible"; op: string; siteRef: string; userEntityRef: string }
  | { kind: "oversized-list"; siteRef: string; pageRef: string; count: number; bytes: number }
  | { kind: "error"; op: string; err: unknown };

/** Single funnel for comment-op logging. PII (body/html/profile/selectors/tokens) is
 *  not representable in CommentLogEvent, so it cannot be logged here. */
export function logCommentOp(logger: LoggerService, event: CommentLogEvent): void {
  switch (event.kind) {
    case "mutation":
      logger.info(`comment op ${event.op}`, {
        op: event.op,
        siteRef: event.siteRef,
        commentId: event.commentId,
        ...(event.parentId ? { parentId: event.parentId } : {}),
        outcome: "ok",
      });
      return;
    case "denied":
      logger.warn(`comment op ${event.op} denied`, {
        op: event.op,
        permission: event.permission,
        userEntityRef: event.userEntityRef,
        outcome: "denied",
      });
      return;
    case "entity-not-visible":
      logger.warn(`comment op ${event.op} entity not visible`, {
        op: event.op,
        siteRef: event.siteRef,
        userEntityRef: event.userEntityRef,
        outcome: "entity-not-visible",
      });
      return;
    case "oversized-list":
      logger.warn("comment list oversized", {
        op: "list",
        siteRef: event.siteRef,
        pageRef: event.pageRef,
        count: event.count,
        bytes: event.bytes,
      });
      return;
    case "error":
      logger.error(`comment op ${event.op} failed`, {
        op: event.op,
        outcome: "error",
        err: event.err instanceof Error ? event.err.message : String(event.err),
      });
      return;
    default: {
      // Exhaustiveness check — TypeScript ensures this is unreachable.
      const _: never = event;
      void _;
    }
  }
}
