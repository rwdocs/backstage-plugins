import { type CommentActivity } from "@rwdocs/backstage-plugin-rw-node";
import { DefaultCommentRecipientResolver } from "./DefaultCommentRecipientResolver";

function makeActivity(over: Partial<CommentActivity> = {}): CommentActivity {
  return {
    action: "created",
    occurredAt: "2026-06-26T00:00:00.000Z",
    commentId: "c1",
    rootId: "c1",
    parentId: null,
    siteRef: "component:default/site",
    sectionRef: "sec-1",
    pageRef: "sec-1#guide",
    actorRef: "user:default/jane",
    actorName: "Jane Doe",
    participants: ["user:default/jane"],
    sectionOwnerRef: "group:default/docs",
    entityRef: "component:default/my-docs",
    pageTitle: "Guide",
    sectionTitle: "Docs",
    viewerPath: "guide",
    bodySnippet: "hello",
    ...over,
  };
}

describe("DefaultCommentRecipientResolver", () => {
  const resolver = new DefaultCommentRecipientResolver();

  it("getName() returns 'rw-default-recipients'", () => {
    expect(resolver.getName()).toBe("rw-default-recipients");
  });

  it("new top-level thread → [sectionOwnerRef]", async () => {
    await expect(resolver.resolveRecipients(makeActivity())).resolves.toEqual([
      "group:default/docs",
    ]);
  });

  it("new top-level thread with null sectionOwnerRef → []", async () => {
    await expect(
      resolver.resolveRecipients(makeActivity({ sectionOwnerRef: null })),
    ).resolves.toEqual([]);
  });

  it("reply (parentId set) → participants", async () => {
    await expect(
      resolver.resolveRecipients(
        makeActivity({
          commentId: "c2",
          parentId: "c1",
          participants: ["user:default/jane", "user:default/bob"],
        }),
      ),
    ).resolves.toEqual(["user:default/jane", "user:default/bob"]);
  });

  it("reply with empty participants → []", async () => {
    await expect(
      resolver.resolveRecipients(makeActivity({ parentId: "c1", participants: [] })),
    ).resolves.toEqual([]);
  });

  it("resolve action → participants", async () => {
    await expect(
      resolver.resolveRecipients(
        makeActivity({
          action: "resolved",
          commentId: "c2",
          rootId: "c1",
          participants: ["user:default/jane", "user:default/bob"],
        }),
      ),
    ).resolves.toEqual(["user:default/jane", "user:default/bob"]);
  });
});
