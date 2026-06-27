import { LoggerService } from "@backstage/backend-plugin-api";
import { parseEntityRef } from "@backstage/catalog-model";
import { NotificationService } from "@backstage/plugin-notifications-node";
import { CommentEventPayload } from "@rwdocs/backstage-plugin-rw-common";

/** Subscriber-side: turns a self-contained `rw.comments` event into a native notification.
 *  Presentation + delivery — no DB. The publisher emits raw owner/participant recipients (which may
 *  include the actor); this is the single point of actor exclusion: the actor is forwarded as
 *  `excludeEntityRef` so Backstage's resolver drops them after expanding groups. The one catalog-path
 *  convention (`/catalog/<ns>/<kind>/<name>`) is isolated here: the backend can't resolve the
 *  frontend's catalog routeRef, so the app-relative link is composed from the entity ref by
 *  convention. Best-effort: catches + logs, always resolves. */
export class CommentNotifier {
  private readonly notifications: NotificationService;
  private readonly logger: LoggerService;

  constructor(deps: { notifications: NotificationService; logger: LoggerService }) {
    this.notifications = deps.notifications;
    this.logger = deps.logger;
  }

  async handle(payload: CommentEventPayload): Promise<void> {
    if (!this.isValid(payload)) {
      this.logger.warn(
        `rw.comments: dropping malformed event payload (comment ${payload?.commentId ?? "?"})`,
      );
      return;
    }
    try {
      await this.notifications.send({
        // Single point of actor exclusion (see class doc): the resolver drops the actor from
        // the resolved recipients, including from an expanded group.
        recipients: {
          type: "entity",
          entityRef: payload.recipients,
          excludeEntityRef: payload.actorRef,
        },
        payload: {
          title: this.title(payload),
          description: this.description(payload),
          link: this.link(payload),
          severity: "normal",
          topic: this.topic(payload),
          // Per-thread collapse: events on one thread share this scope, and the
          // backend dedups on (user, scope, origin) — not topic — overwriting the
          // prior row's topic/title in place. So a recipient who is both the owner
          // and a resolve participant on one thread sees the latest event, not two
          // notifications. A disabled topic short-circuits the send before that
          // overwrite, so a recipient who muted the newer event keeps the prior row.
          scope: `rw:comment:${payload.rootId}`,
        },
      });
    } catch (error) {
      this.logger.warn(
        `rw.comments notification send failed (comment ${payload.commentId}): ${error}`,
      );
    }
  }

  /** Defensive shape guard at the subscriber boundary: the module casts the raw event
   *  payload to `CommentEventPayload`, so a malformed or foreign event on the topic would
   *  otherwise flow straight into `send`. Validates the fields this notifier relies on —
   *  including `actorRef`, the sole basis for actor exclusion (passed as `excludeEntityRef`);
   *  without it the exclusion silently becomes a no-op and the actor self-notifies. */
  private isValid(payload: CommentEventPayload): boolean {
    return (
      !!payload &&
      (payload.kind === "created" || payload.kind === "resolved") &&
      typeof payload.rootId === "string" &&
      typeof payload.actorRef === "string" &&
      payload.actorRef.length > 0 &&
      Array.isArray(payload.recipients) &&
      payload.recipients.length > 0
    );
  }

  private subject(payload: CommentEventPayload): string {
    const p = payload.pageTitle?.trim();
    const a = payload.sectionTitle?.trim();
    if (p && a && p !== a) return `${p} · ${a}`;
    return p || a || "the docs";
  }

  private actor(payload: CommentEventPayload): string {
    return payload.actorName?.trim() || "Someone";
  }

  private title(payload: CommentEventPayload): string {
    const s = this.subject(payload);
    const a = this.actor(payload);
    if (payload.kind === "resolved") return `${a} resolved a thread on ${s}`;
    if (payload.audience === "owner") return `${a} commented on ${s}`;
    return `${a} replied on ${s}`;
  }

  /** Stable, frozen notification topic id per event kind (see README "Notification
   *  topics"). Colon-delimited <domain>:<object>:<verb>; lowercase and never renamed
   *  (persisted in the settings key hash). Mirrors the title() branch. */
  private topic(payload: CommentEventPayload): string {
    if (payload.kind === "resolved") return "comment:thread:resolved";
    if (payload.audience === "owner") return "comment:thread:created";
    return "comment:reply:created";
  }

  private description(payload: CommentEventPayload): string {
    if (payload.kind === "resolved") return `Re: ${payload.bodySnippet}`;
    return payload.bodySnippet;
  }

  /** App-relative deep link, or undefined when the owning entity is unknown (degraded). */
  private link(payload: CommentEventPayload): string | undefined {
    if (!payload.entityRef) return undefined;
    const { kind, namespace, name } = parseEntityRef(payload.entityRef);
    const prefix = `/catalog/${namespace.toLowerCase()}/${kind.toLowerCase()}/${name}`;
    return `${prefix}${payload.deepLinkSuffix}`;
  }
}
