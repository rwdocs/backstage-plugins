import { rwCommentProcessingExtensionPoint } from "./extensionPoints";

describe("rwCommentProcessingExtensionPoint", () => {
  it("has the rw.comment-processing id", () => {
    // createExtensionPoint stores the id on the returned ref; its string form is the
    // public, stable surface. Smoke test that the ref constructs with the right id.
    expect(String(rwCommentProcessingExtensionPoint)).toContain("rw.comment-processing");
  });
});
