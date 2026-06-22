import { mockServices } from "@backstage/backend-test-utils";
import { logCommentOp } from "./logging";

describe("logCommentOp", () => {
  it("logs a mutation at info with outcome ok", () => {
    const logger = mockServices.logger.mock();
    logCommentOp(logger, {
      kind: "mutation",
      op: "create",
      siteRef: "component:default/arch",
      commentId: "c1",
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("create"),
      expect.objectContaining({ op: "create", outcome: "ok", commentId: "c1" }),
    );
  });

  it("logs a denial at warn", () => {
    const logger = mockServices.logger.mock();
    logCommentOp(logger, {
      kind: "denied",
      op: "edit",
      permission: "rwComment.edit",
      userEntityRef: "user:default/bob",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ outcome: "denied", permission: "rwComment.edit" }),
    );
  });

  it("logs an error at error level with outcome:error", () => {
    const logger = mockServices.logger.mock();
    logCommentOp(logger, {
      kind: "error",
      op: "create",
      err: new Error("boom"),
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("create"),
      expect.objectContaining({ outcome: "error", op: "create" }),
    );
  });
});
