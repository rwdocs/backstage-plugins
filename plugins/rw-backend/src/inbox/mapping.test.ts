import { joinNonEmpty, toInboxItem, rawSortValue } from "./mapping";

describe("joinNonEmpty", () => {
  it("joins two non-empty parts with the separator", () => {
    expect(joinNonEmpty(["usage", "guide"], "/")).toBe("usage/guide");
  });

  it("omits empty parts", () => {
    expect(joinNonEmpty(["", "guide"], "/")).toBe("guide");
    expect(joinNonEmpty(["usage", ""], "/")).toBe("usage");
    expect(joinNonEmpty(["", ""], "/")).toBe("");
  });

  it("returns empty string for all-empty parts", () => {
    expect(joinNonEmpty([], "/")).toBe("");
  });
});

describe("toInboxItem", () => {
  const baseRow = {
    id: "comment-1",
    site_ref: "component:default/arch",
    page_ref: "section:default/root#guide",
    entity_ref: "component:default/arch",
    section_path: "usage",
    page_title: "Guide",
    author_ref: "user:default/alice",
    author_profile: null,
    body: "Hello world",
    body_html: "<p>Hello world</p>",
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-02T00:00:00Z"),
  };

  it("constructs viewerPath from section_path and page_ref subpath", () => {
    const item = toInboxItem(baseRow as any, 0);
    expect(item.viewerPath).toBe("usage/guide");
  });

  it("exposes pageTitle from the row, viewerPath from section_path + subpath", () => {
    const item = toInboxItem(baseRow as any, 0);
    expect(item.viewerPath).toBe("usage/guide");
    expect(item.pageTitle).toBe("Guide");
  });

  it("falls back pageTitle to the viewerPath slug when null", () => {
    const item = toInboxItem({ ...baseRow, page_title: null } as any, 0);
    expect(item.pageTitle).toBe("usage/guide");
  });

  it("falls back name to the humanized entity name when no profile", () => {
    // Shared authorFromRow: id keeps the full ref, name falls back to the
    // entity name part (matches the thread view). The inbox frontend resolves
    // the display name via useEntityPresentation(id), so this is the wire fallback.
    const item = toInboxItem(baseRow as any, 0);
    expect(item.author.name).toBe("alice");
    expect(item.author.id).toBe("user:default/alice");
    expect(item.author.avatarUrl).toBeUndefined();
  });

  it("uses profile displayName and picture when present", () => {
    const row = {
      ...baseRow,
      author_profile: JSON.stringify({
        displayName: "Alice",
        picture: "https://example.com/avatar.png",
      }),
    };
    const item = toInboxItem(row as any, 2);
    expect(item.author.name).toBe("Alice");
    expect(item.author.avatarUrl).toBe("https://example.com/avatar.png");
    expect(item.replyCount).toBe(2);
  });

  it("returns ISO strings for createdAt and updatedAt", () => {
    const item = toInboxItem(baseRow as any, 0);
    expect(item.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(item.updatedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("derives bodySnippet from sanitized body_html, not raw body", () => {
    // body_html (sanitized) is the source; raw `body` markdown is ignored. The
    // snippet pipeline itself (truncation, entities, graphemes) is covered in
    // snippet.test.ts — here we only pin that toInboxItem reads the right field.
    const row = {
      ...baseRow,
      body: "**bold**",
      body_html: "<p>Should say <strong>TLS</strong></p>",
    };
    const item = toInboxItem(row as any, 0);
    expect(item.bodySnippet).toBe("Should say TLS");
  });

  it("viewerPath is only subpath when section_path is empty", () => {
    const row = { ...baseRow, section_path: "" };
    const item = toInboxItem(row as any, 0);
    expect(item.viewerPath).toBe("guide");
  });

  it("viewerPath is only section_path when pageRef has no subpath", () => {
    const row = { ...baseRow, page_ref: "section:default/root" };
    const item = toInboxItem(row as any, 0);
    expect(item.viewerPath).toBe("usage");
  });

  it("exposes commentId, siteRef, pageRef, entityRef", () => {
    const item = toInboxItem(baseRow as any, 0);
    expect(item.commentId).toBe("comment-1");
    expect(item.siteRef).toBe("component:default/arch");
    expect(item.pageRef).toBe("section:default/root#guide");
    expect(item.entityRef).toBe("component:default/arch");
  });
});

describe("rawSortValue", () => {
  it("returns an ISO string for a Date", () => {
    const d = new Date("2026-06-01T00:00:00.000Z");
    expect(rawSortValue(d)).toBe("2026-06-01T00:00:00.000Z");
  });

  it("passes through a string unchanged", () => {
    expect(rawSortValue("2026-06-01T00:00:00.000Z")).toBe("2026-06-01T00:00:00.000Z");
  });

  it("passes through a number unchanged", () => {
    expect(rawSortValue(1234567890)).toBe(1234567890);
  });
});
