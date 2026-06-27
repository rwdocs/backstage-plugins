import { toCommentResponse } from "./mapping";
import type { CommentRow } from "./types";

function baseRow(over: Partial<CommentRow> = {}): CommentRow {
  return {
    id: "id1",
    site_ref: "component:default/arch",
    page_ref: "section:default/root#guide",
    section_ref: "section:default/root",
    parent_id: null,
    author_ref: "user:default/alice",
    author_profile: JSON.stringify({ displayName: "Alice", picture: "http://a/x.png" }),
    body: "hi",
    body_html: "<p>hi</p>",
    selectors: JSON.stringify([{ type: "CSSSelector", value: "#x" }]),
    status: "open",
    created_at: new Date("2026-06-21T06:00:00.000Z"),
    updated_at: new Date("2026-06-21T06:00:00.000Z"),
    resolved_at: null,
    resolved_by: null,
    deleted_at: null,
    ...over,
  };
}

describe("toCommentResponse", () => {
  it("returns documentId verbatim and composes author from profile", () => {
    const r = toCommentResponse(baseRow(), "user:default/alice");
    expect(r.documentId).toBe("section:default/root#guide");
    expect(r.author).toEqual({
      id: "user:default/alice",
      name: "Alice",
      avatarUrl: "http://a/x.png",
    });
    expect(r.bodyHtml).toBe("<p>hi</p>");
    expect(r.createdAt).toBe("2026-06-21T06:00:00.000Z");
    expect((r as { siteRef?: string }).siteRef).toBeUndefined();
    expect((r as { entityRef?: string }).entityRef).toBeUndefined();
  });

  it("derives author.name from author_ref when author_profile is null (erased/guest)", () => {
    const r = toCommentResponse(
      baseRow({ author_profile: null, author_ref: "user:development/guest" }),
      undefined,
    );
    expect(r.author).toEqual({ id: "user:development/guest", name: "guest" });
  });

  it("canResolve is true for a live top-level comment with no author check", () => {
    const r = toCommentResponse(baseRow({ parent_id: null }), "user:default/somebody-else");
    expect(r.canResolve).toBe(true);
    expect(r.canDelete).toBe(false); // top-level not deletable
  });

  it("canDelete/canRestore are author-gated and reply-only", () => {
    const reply = baseRow({ parent_id: "top", author_ref: "user:default/alice" });
    const asAuthor = toCommentResponse(reply, "user:default/alice");
    expect(asAuthor.canDelete).toBe(true);
    const asOther = toCommentResponse(reply, "user:default/bob");
    expect(asOther.canDelete).toBe(false);

    const deletedReply = baseRow({
      parent_id: "top",
      deleted_at: new Date(),
      author_ref: "user:default/alice",
    });
    expect(toCommentResponse(deletedReply, "user:default/alice").canRestore).toBe(true);
  });
});
