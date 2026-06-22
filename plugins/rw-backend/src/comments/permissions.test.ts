import { isCommentAuthor, commentResourceRef } from "./permissions";
import type { CommentResponse } from "./mapping";

const comment = { author: { id: "user:default/alice", name: "Alice" } } as CommentResponse;

describe("isCommentAuthor rule", () => {
  it("has the rw-comment resource ref", () => {
    expect(commentResourceRef.resourceType).toBe("rw-comment");
  });

  it("apply is true when the param userRef equals the author", () => {
    expect(isCommentAuthor.apply(comment, { userRef: "user:default/alice" })).toBe(true);
    expect(isCommentAuthor.apply(comment, { userRef: "user:default/bob" })).toBe(false);
  });

  it("toQuery returns an empty stub (never invoked in-memory)", () => {
    expect(isCommentAuthor.toQuery({ userRef: "x" })).toEqual({});
  });
});
