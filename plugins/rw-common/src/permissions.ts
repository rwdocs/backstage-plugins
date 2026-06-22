import { createPermission } from "@backstage/plugin-permission-common";

/** Resource type for comment resource permissions; shared with the backend resource ref. */
export const RESOURCE_TYPE_RW_COMMENT = "rw-comment";

/** List/read comments (basic — the coarse global toggle; entity-read is layered on in the backend). */
export const rwCommentReadPermission = createPermission({
  name: "rwComment.read",
  attributes: { action: "read" },
});

/** Create a comment or reply (basic). */
export const rwCommentCreatePermission = createPermission({
  name: "rwComment.create",
  attributes: { action: "create" },
});

/** Resolve/reopen a thread (resource; collaborative by default, gateable by a policy). */
export const rwCommentResolvePermission = createPermission({
  name: "rwComment.resolve",
  attributes: { action: "update" },
  resourceType: RESOURCE_TYPE_RW_COMMENT,
});

/** Edit a comment body/selectors (resource; author-floored in the backend). */
export const rwCommentEditPermission = createPermission({
  name: "rwComment.edit",
  attributes: { action: "update" },
  resourceType: RESOURCE_TYPE_RW_COMMENT,
});

/** Delete (soft) and restore a reply (resource; author-floored in the backend). */
export const rwCommentDeletePermission = createPermission({
  name: "rwComment.delete",
  attributes: { action: "delete" },
  resourceType: RESOURCE_TYPE_RW_COMMENT,
});

/** The three resource permissions the backend registers via addResourceType. */
export const rwCommentResourcePermissions = [
  rwCommentResolvePermission,
  rwCommentEditPermission,
  rwCommentDeletePermission,
];

/** All five comment permissions (for documentation / a policy author's reference). */
export const rwCommentPermissions = [
  rwCommentReadPermission,
  rwCommentCreatePermission,
  ...rwCommentResourcePermissions,
];
