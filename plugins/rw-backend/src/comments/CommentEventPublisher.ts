import { LoggerService } from "@backstage/backend-plugin-api";
import { parseEntityRef } from "@backstage/catalog-model";
import { EventsService } from "@backstage/plugin-events-node";
import {
  RW_COMMENTS_TOPIC,
  CommentEventPayload,
  CommentEventAudience,
  buildCommentDeepLinkSuffix,
} from "@rwdocs/backstage-plugin-rw-common";
import { SectionsReader } from "../siteIndex/SectionsReader";
import { PagesReader } from "../siteIndex/PagesReader";
import { snippetFromHtml } from "../inbox/snippet";
import { joinNonEmpty } from "../inbox/mapping";
import { CommentStore } from "./CommentStore";
import { authorFromRow } from "./author";
import { CommentRow, subpathOf } from "./types";

/** Publishes self-contained `rw.comments` domain events after a comment write commits.
 *  Owns recipient + deep-link resolution (it has the comments + sections tables) so the
 *  notifications module can stay a thin sender. Best-effort: every method catches and
 *  logs, and always resolves, so a publish failure can never affect the comment write.
 *  Callers invoke fire-and-forget. */
export class CommentEventPublisher {
  private readonly events: EventsService;
  private readonly sections: SectionsReader;
  private readonly comments: CommentStore;
  private readonly logger: LoggerService;
  private readonly pages: PagesReader;

  constructor(deps: {
    events: EventsService;
    sections: SectionsReader;
    comments: CommentStore;
    logger: LoggerService;
    pages: PagesReader;
  }) {
    this.events = deps.events;
    this.sections = deps.sections;
    this.comments = deps.comments;
    this.logger = deps.logger;
    this.pages = deps.pages;
  }

  async onCommentCreated(row: CommentRow, actorRef: string): Promise<void> {
    try {
      if (row.parent_id === null) {
        await this.publishOwnerSide(row, actorRef);
      } else {
        await this.publishParticipantSide("created", row, row.parent_id, actorRef);
      }
    } catch (error) {
      this.logger.warn(`rw.comments publish (created) failed: ${error}`);
    }
  }

  async onCommentResolved(row: CommentRow, actorRef: string, actorName?: string): Promise<void> {
    try {
      // resolve only happens on top-level rows, so the row IS the thread root.
      await this.publishParticipantSide("resolved", row, row.id, actorRef, actorName);
    } catch (error) {
      this.logger.warn(`rw.comments publish (resolved) failed: ${error}`);
    }
  }

  private async resolvePageTitle(
    siteRef: string,
    sectionRef: string,
    subpath: string,
  ): Promise<string | null> {
    try {
      return await this.pages.getTitle(siteRef, sectionRef, subpath);
    } catch (err) {
      this.logger.warn(`rw.comments: could not resolve page title: ${err}`);
      return null;
    }
  }

  private async publishOwnerSide(row: CommentRow, actorRef: string): Promise<void> {
    const section = await this.sections.getSection(row.site_ref, row.section_ref);
    if (!section || !section.entity_owner_ref) return; // new/unowned section: inbox catches it
    const recipients = [section.entity_owner_ref].filter((ref) => ref !== actorRef);
    if (recipients.length === 0) return;
    const subpath = subpathOf(row.document_id);
    const viewerPath = joinNonEmpty([section.section_path, subpath], "/");
    const actorName = authorFromRow(row).name;
    const [pageTitle, sectionTitle] = await Promise.all([
      this.resolvePageTitle(row.site_ref, row.section_ref, subpath),
      this.resolvePageTitle(row.site_ref, row.section_ref, ""),
    ]);
    await this.publish("created", "owner", row, row.id, recipients, actorRef, {
      entityRef: section.entity_ref,
      viewerPath,
      actorName,
      pageTitle,
      sectionTitle,
    });
  }

  private async publishParticipantSide(
    kind: "created" | "resolved",
    row: CommentRow,
    rootId: string,
    actorRef: string,
    resolvedActorName?: string,
  ): Promise<void> {
    // participantsOf already returns distinct refs, so no extra dedup is needed here.
    const participants = await this.comments.participantsOf(rootId);
    const recipients = participants.filter((ref) => ref !== actorRef);
    if (recipients.length === 0) return;
    // The section row provides entityRef (link target) + section_path (path prefix); degrade gracefully if absent: entityRef -> null (module emits no link), viewerPath -> bare subpath.
    const section = await this.sections.getSection(row.site_ref, row.section_ref);
    const subpath = subpathOf(row.document_id);
    const viewerPath = section ? joinNonEmpty([section.section_path, subpath], "/") : subpath;
    const actorName =
      kind === "resolved"
        ? (resolvedActorName ?? parseEntityRef(actorRef).name)
        : authorFromRow(row).name;
    const [pageTitle, sectionTitle] = await Promise.all([
      this.resolvePageTitle(row.site_ref, row.section_ref, subpath),
      this.resolvePageTitle(row.site_ref, row.section_ref, ""),
    ]);
    await this.publish(kind, "participants", row, rootId, recipients, actorRef, {
      entityRef: section?.entity_ref ?? null,
      viewerPath,
      actorName,
      pageTitle,
      sectionTitle,
    });
  }

  private async publish(
    kind: "created" | "resolved",
    audience: CommentEventAudience,
    row: CommentRow,
    rootId: string,
    recipients: string[],
    actorRef: string,
    link: {
      entityRef: string | null;
      viewerPath: string;
      actorName: string;
      pageTitle: string | null;
      sectionTitle: string | null;
    },
  ): Promise<void> {
    const eventPayload: CommentEventPayload = {
      kind,
      audience,
      occurredAt: new Date().toISOString(),
      commentId: row.id,
      rootId,
      parentId: row.parent_id,
      siteRef: row.site_ref,
      sectionRef: row.section_ref,
      documentId: row.document_id,
      actorRef,
      recipients,
      entityRef: link.entityRef,
      deepLinkSuffix: buildCommentDeepLinkSuffix({
        viewerPath: link.viewerPath,
        commentId: row.id,
      }),
      bodySnippet: snippetFromHtml(row.body_html),
      actorName: link.actorName,
      pageTitle: link.pageTitle,
      sectionTitle: link.sectionTitle,
    };
    await this.events.publish({ topic: RW_COMMENTS_TOPIC, eventPayload });
  }
}
