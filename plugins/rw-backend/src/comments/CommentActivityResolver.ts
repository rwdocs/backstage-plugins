import type { AuthService, LoggerService } from "@backstage/backend-plugin-api";
import { parseEntityRef } from "@backstage/catalog-model";
import type { CatalogService } from "@backstage/plugin-catalog-node";
import { CommentAction, CommentActivity } from "@rwdocs/backstage-plugin-rw-node";
import { SectionsReader } from "../siteIndex/SectionsReader";
import { PagesReader } from "../siteIndex/PagesReader";
import { snippetFromHtml } from "../inbox/snippet";
import { joinNonEmpty } from "../inbox/mapping";
import { CommentStore } from "./CommentStore";
import { authorFromRow } from "./author";
import { CommentRow, subpathOf } from "./types";
import { toIso } from "./timestamps";

/** Resolves a self-contained CommentActivity from rw-backend's own tables (comments/
 *  sections/pages) plus a catalog lookup for the resolver's display name on the resolved
 *  path. Best-effort: title reads and the catalog lookup degrade to null/ref-name on error,
 *  never throw. Returns undefined when the triggering row is soft-deleted (suppress). */
export class CommentActivityResolver {
  private readonly sections: SectionsReader;
  private readonly pages: PagesReader;
  private readonly comments: CommentStore;
  private readonly catalog: CatalogService;
  private readonly auth: AuthService;
  private readonly logger: LoggerService;

  constructor(opts: {
    sections: SectionsReader;
    pages: PagesReader;
    comments: CommentStore;
    catalog: CatalogService;
    auth: AuthService;
    logger: LoggerService;
  }) {
    this.sections = opts.sections;
    this.pages = opts.pages;
    this.comments = opts.comments;
    this.catalog = opts.catalog;
    this.auth = opts.auth;
    this.logger = opts.logger;
  }

  async resolve(
    action: CommentAction,
    row: CommentRow,
    actorRef: string,
  ): Promise<CommentActivity | undefined> {
    if (row.deleted_at !== null) return undefined; // soft-deleted trigger: suppress

    const subpath = subpathOf(row.page_ref);
    const rootId = action === "created" ? (row.parent_id ?? row.id) : row.id;

    // Every read depends only on row fields (available above), and the actor name only on
    // actorRef, so resolve them all concurrently rather than serializing the round-trips on
    // this fire-and-forget path. Each read is best-effort and degrades on failure (see the
    // helpers below), so one transient error can't reject the whole resolve and suppress an
    // otherwise-deliverable notification.
    const [section, participants, [pageTitle, sectionTitle], actorName] = await Promise.all([
      this.resolveSection(row),
      this.resolveParticipants(rootId),
      this.resolveTitles(row, subpath),
      action === "created"
        ? Promise.resolve(authorFromRow(row).name)
        : this.resolveActorName(actorRef),
    ]);

    const viewerPath = section ? joinNonEmpty([section.section_path, subpath], "/") : subpath;
    const occurredAt =
      action === "created"
        ? (toIso(row.created_at) ?? "")
        : (toIso(row.resolved_at) ?? toIso(row.updated_at) ?? "");

    return {
      action,
      occurredAt,
      commentId: row.id,
      rootId,
      parentId: row.parent_id,
      siteRef: row.site_ref,
      sectionRef: row.section_ref,
      pageRef: row.page_ref,
      actorRef,
      actorName,
      participants,
      sectionOwnerRef: section?.entity_owner_ref ?? null,
      entityRef: section?.entity_ref ?? null,
      pageTitle,
      sectionTitle,
      viewerPath,
      bodySnippet: snippetFromHtml(row.body_html),
    };
  }

  /** Best-effort section read: a transient failure degrades to no section (null owner/entity and
   *  a bare-subpath viewer path) rather than rejecting the whole resolve, so a reply/resolve whose
   *  recipients come from participants — not the section — still gets notified. */
  private async resolveSection(
    row: CommentRow,
  ): Promise<Awaited<ReturnType<SectionsReader["getSection"]>>> {
    try {
      return await this.sections.getSection(row.site_ref, row.section_ref);
    } catch (err) {
      this.logger.warn(`rw comment activity: could not resolve section: ${err}`);
      return undefined;
    }
  }

  /** Reads the page title and the section-root title. When the comment is on the section root
   *  (empty subpath) both resolve to the same page row, so read once and reuse rather than
   *  issuing a duplicate query. */
  private async resolveTitles(
    row: CommentRow,
    subpath: string,
  ): Promise<[string | null, string | null]> {
    if (subpath === "") {
      const title = await this.resolveTitle(row, "");
      return [title, title];
    }
    return Promise.all([this.resolveTitle(row, subpath), this.resolveTitle(row, "")]);
  }

  /** Best-effort participant read: a transient failure degrades to no participants rather than
   *  rejecting the whole resolve. A top-level create's owner notification (which doesn't depend
   *  on participants) then still goes out; a reply/resolve with no resolvable participants sends
   *  nothing. */
  private async resolveParticipants(rootId: string): Promise<string[]> {
    try {
      return await this.comments.participantsOf(rootId);
    } catch (err) {
      this.logger.warn(`rw comment activity: could not resolve participants: ${err}`);
      return [];
    }
  }

  private async resolveTitle(row: CommentRow, subpath: string): Promise<string | null> {
    try {
      return await this.pages.getTitle(row.site_ref, row.section_ref, subpath);
    } catch (err) {
      this.logger.warn(`rw comment activity: could not resolve page title: ${err}`);
      return null;
    }
  }

  /** Resolver display name (resolved path only): own service-credential catalog read of the
   *  actor entity; falls back through metadata.title to the humanized ref name on any miss
   *  or error. */
  private async resolveActorName(actorRef: string): Promise<string> {
    try {
      const credentials = await this.auth.getOwnServiceCredentials();
      const entity = await this.catalog.getEntityByRef(actorRef, { credentials });
      const profile = entity?.spec?.profile as { displayName?: string } | undefined;
      return (
        profile?.displayName?.trim() ||
        entity?.metadata.title?.trim() ||
        parseEntityRef(actorRef).name
      );
    } catch {
      return parseEntityRef(actorRef).name;
    }
  }
}
