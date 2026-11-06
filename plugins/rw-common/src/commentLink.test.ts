import { buildCommentDeepLinkSuffix, buildDocsPageLinkSuffix } from "./commentLink";

describe("buildDocsPageLinkSuffix", () => {
  it("builds the Documentation-tab path plus the viewer path", () => {
    expect(buildDocsPageLinkSuffix("guides/setup")).toBe("/docs/guides/setup");
  });

  it("encodes a filename hash while preserving directory separators", () => {
    expect(buildDocsPageLinkSuffix("guides/c#")).toBe("/docs/guides/c%23");
  });

  it("returns the bare /docs tab when the viewerPath is empty (section root)", () => {
    expect(buildDocsPageLinkSuffix("")).toBe("/docs");
  });
});

describe("buildCommentDeepLinkSuffix", () => {
  it("builds the docs suffix with the comment anchor", () => {
    expect(buildCommentDeepLinkSuffix({ viewerPath: "guide/setup", commentId: "abc" })).toBe(
      "/docs/guide/setup#comment-abc",
    );
  });

  it("keeps a literal page hash separate from the comment anchor", () => {
    expect(buildCommentDeepLinkSuffix({ viewerPath: "c#", commentId: "abc" })).toBe(
      "/docs/c%23#comment-abc",
    );
  });

  it("handles an empty viewerPath (site root) without a trailing slash", () => {
    expect(buildCommentDeepLinkSuffix({ viewerPath: "", commentId: "abc" })).toBe(
      "/docs#comment-abc",
    );
  });
});
