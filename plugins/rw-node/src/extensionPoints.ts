import { createExtensionPoint } from "@backstage/backend-plugin-api";
import { CommentProcessor } from "./CommentProcessor";

export interface RwCommentProcessingExtensionPoint {
  /** Register one or more processors invoked on every comment activity. */
  addProcessor(...processors: Array<CommentProcessor | CommentProcessor[]>): void;
}

export const rwCommentProcessingExtensionPoint =
  createExtensionPoint<RwCommentProcessingExtensionPoint>({
    id: "rw.comment-processing",
  });
