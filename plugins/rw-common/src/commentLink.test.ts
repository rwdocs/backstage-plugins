import { buildCommentDeepLinkSuffix, buildDocsPageLinkSuffix } from "./commentLink";

describe("buildDocsPageLinkSuffix", () => {
  it("builds the Documentation-tab path plus the viewer path", () => {
    expect(buildDocsPageLinkSuffix("guides/setup")).toBe("/docs/guides/setup");
  });

  it.each([
    ["c#", "/docs/c%23"],
    ["guide/my page", "/docs/guide/my%20page"],
    ["100%/what?", "/docs/100%25/what%3F"],
    ["привет", "/docs/%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82"],
  ])("encodes page path %s without treating it as a URL", (path, expected) => {
    expect(buildDocsPageLinkSuffix(path)).toBe(expected);
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
