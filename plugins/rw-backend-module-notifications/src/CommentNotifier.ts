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
    let scope: string;
    if (comment.action === "created" && comment.parentId === null) {
      // Owner-side burst path: coalesce per-page so a hot doc collapses into one
      // self-updating Web inbox row per recipient group, not one row per comment.
      recipients = comment.sectionOwnerRef ? [comment.sectionOwnerRef] : [];
      scope = `rw:page:${comment.siteRef}|${comment.pageRef}`;
    } else {
      // Participant-side (replies + resolves): per-thread, so each conversation keeps its
      // own self-updating row rather than coalescing across threads on the same page.
      recipients = comment.participants;
      scope = `rw:comment:${comment.rootId}`;
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
          // The backend dedups on (user, scope, origin) — not topic — overwriting the prior
          // row in place. The two namespaces (rw:page:… vs rw:comment:…) are disjoint, so a
          // reply is never swallowed by the page-level owner row.
          scope,
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
