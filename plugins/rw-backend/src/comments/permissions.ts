import { z } from "zod/v3";
import {
  createPermissionResourceRef,
  createPermissionRule,
} from "@backstage/plugin-permission-node";
import { RESOURCE_TYPE_RW_COMMENT } from "@rwdocs/backstage-plugin-rw-common";
import type { CommentResponse } from "./mapping";

/**
 * Resource ref for RW comments. TQuery is {} because all authorization
 * is applied in-memory (no DB query translation is needed).
 */
export const commentResourceRef = createPermissionResourceRef<CommentResponse, {}>().with({
  pluginId: "rw",
  resourceType: RESOURCE_TYPE_RW_COMMENT,
});

/**
 * Permission rule that returns true when the caller's userRef matches the comment author.
 * The caller ref is passed as a `userRef` param for testability.
 */
export const isCommentAuthor = createPermissionRule<typeof commentResourceRef, { userRef: string }>(
  {
    name: "IS_COMMENT_AUTHOR",
    description: "Allow only the comment author",
    resourceRef: commentResourceRef,
    paramsSchema: z.object({ userRef: z.string() }),
    apply: (comment, { userRef }) => comment.author.id === userRef,
    toQuery: () => ({}),
  },
);
