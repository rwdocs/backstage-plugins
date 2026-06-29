import { LoggerService } from "@backstage/backend-plugin-api";
import { parseEntityRef } from "@backstage/catalog-model";
import { NotificationService } from "@backstage/plugin-notifications-node";
import { buildCommentDeepLinkSuffix } from "@rwdocs/backstage-plugin-rw-common";
import { CommentActivity, CommentProcessor } from "@rwdocs/backstage-plugin-rw-node";

/** CommentProcessor that turns a resolved CommentActivity into a native notification.
 *  Presentation + delivery only — no DB, events, or catalog. Computes recipients from the
 *  activity's raw owner/participants fields; the actor is forwarded as excludeEntityRef so the
 *  notifications resolver drops them after expanding groups (the single point of actor
 *  exclusion). The one catalog-path convention (`/catalog/<ns>/<kind>/<name>`) is isolated here.
 *  Best-effort: catches + logs on send failure, never throws. */
export class CommentNotifier implements CommentProcessor {
  private readonly notifications: NotificationService;
  private readonly logger: LoggerService;

  constructor(opts: { notifications: NotificationService; logger: LoggerService }) {
    this.notifications = opts.notifications;
    this.logger = opts.logger;
  }

  getName(): string {
    return "rw-comment-notifications";
  }

  async process(comment: CommentActivity): Promise<void> {
    let recipients: string[];
    if (comment.action === "created" && comment.parentId === null) {
      recipients = comment.sectionOwnerRef ? [comment.sectionOwnerRef] : [];
    } else {
      recipients = comment.participants;
    }
    if (recipients.length === 0) return; // nothing to notify

    try {
      await this.notifications.send({
        // Single point of actor exclusion: the resolver drops the actor from the resolved
        // recipients, including from an expanded group.
        recipients: {
          type: "entity",
          entityRef: recipients,
          excludeEntityRef: comment.actorRef,
        },
        payload: {
          title: this.title(comment),
          description: this.description(comment),
          link: this.link(comment),
          severity: "normal",
          topic: this.topic(comment),
          // Per-thread collapse: activities on one thread share this scope, and the backend
          // dedups on (user, scope, origin) — not topic — overwriting the prior row in place.
          scope: `rw:comment:${comment.rootId}`,
        },
      });
    } catch (error) {
      this.logger.warn(
        `rw.comments notification send failed (comment ${comment.commentId}): ${error}`,
      );
    }
  }

  private subject(comment: CommentActivity): string {
    const p = comment.pageTitle?.trim();
    const a = comment.sectionTitle?.trim();
    if (p && a && p !== a) return `${p} · ${a}`;
    return p || a || "the docs";
  }

  private actor(comment: CommentActivity): string {
    return comment.actorName?.trim() || "Someone";
  }

  private title(comment: CommentActivity): string {
    const s = this.subject(comment);
    const a = this.actor(comment);
    if (comment.action === "resolved") return `${a} resolved a thread on ${s}`;
    if (comment.parentId === null) return `${a} commented on ${s}`;
    return `${a} replied on ${s}`;
  }

  /** Stable, frozen notification topic id (see README "Notification topics").
   *  Colon-delimited <domain>:<object>:<verb>; lowercase, never renamed (persisted in the
   *  settings key hash). Mirrors the title() branch. */
  private topic(comment: CommentActivity): string {
    if (comment.action === "resolved") return "comment:thread:resolved";
    if (comment.parentId === null) return "comment:thread:created";
    return "comment:reply:created";
  }

  private description(comment: CommentActivity): string {
    if (comment.action === "resolved") return `Re: ${comment.bodySnippet}`;
    return comment.bodySnippet;
  }

  /** App-relative deep link, or undefined when the owning entity is unknown (degraded). */
  private link(comment: CommentActivity): string | undefined {
    if (!comment.entityRef) return undefined;
    const { kind, namespace, name } = parseEntityRef(comment.entityRef);
    const prefix = `/catalog/${namespace.toLowerCase()}/${kind.toLowerCase()}/${name}`;
    return `${prefix}${buildCommentDeepLinkSuffix({ viewerPath: comment.viewerPath, commentId: comment.rootId })}`;
  }
}
