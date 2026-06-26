import { buildCommentDeepLinkSuffix } from "./commentLink";

describe("buildCommentDeepLinkSuffix", () => {
  it("builds the docs suffix with the comment anchor", () => {
    expect(buildCommentDeepLinkSuffix({ viewerPath: "guide/setup", commentId: "abc" })).toBe(
      "/docs/guide/setup#comment-abc",
    );
  });

  it("handles an empty viewerPath (site root) without a trailing slash", () => {
    expect(buildCommentDeepLinkSuffix({ viewerPath: "", commentId: "abc" })).toBe(
      "/docs#comment-abc",
    );
  });
});
