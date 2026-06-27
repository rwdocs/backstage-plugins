export const RW_COMMENTS_TOPIC = "rw.comments";

export type CommentEventKind = "created" | "resolved";
export type CommentEventAudience = "owner" | "participants";

export interface CommentEventPayload {
  kind: CommentEventKind;
  audience: CommentEventAudience;
  occurredAt: string; // ISO-8601
  commentId: string;
  rootId: string; // = parentId ?? commentId
  parentId: string | null;
  siteRef: string;
  sectionRef: string;
  pageRef: string; // identifies the page within the section ("<sectionRef>#<subpath>")
  actorRef: string; // already removed from `recipients`
  recipients: string[]; // catalog entity refs, non-empty
  entityRef: string | null; // owning entity (sections.entity_ref); null = degraded link
  // prefix-free deep-link suffix, always "/docs/<viewerPath>#comment-<id>". Normal: viewerPath = section_path + "/" + subpath. Degraded (no section row): viewerPath = subpath only (section prefix omitted).
  deepLinkSuffix: string;
  bodySnippet: string;
  actorName: string; // display name of the actor (who did it)
  pageTitle: string | null; // title of the page the comment is on
  sectionTitle: string | null; // title of the section (its root page); shown as "Page · Section". From the siteIndex, not the catalog entity (entities are slugs).
}
