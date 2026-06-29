import { mockServices } from "@backstage/backend-test-utils";
import { type NotificationService } from "@backstage/plugin-notifications-node";
import { type CommentActivity } from "@rwdocs/backstage-plugin-rw-node";
import { CommentNotifier } from "./CommentNotifier";

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

describe("CommentNotifier", () => {
  const logger = mockServices.logger.mock();
  let send: jest.Mock<Promise<void>, [Parameters<NotificationService["send"]>[0]]>;
  let notifier: CommentNotifier;

  beforeEach(() => {
    send = jest.fn<Promise<void>, [Parameters<NotificationService["send"]>[0]]>(
      async () => undefined,
    );
    notifier = new CommentNotifier({ notifications: { send } as any, logger });
  });

  it("top-level create → recipients from sectionOwnerRef, topic:thread:created, title, link", async () => {
    await notifier.process(makeActivity());

    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0][0];
    expect(arg.recipients).toEqual({
      type: "entity",
      entityRef: ["group:default/docs"],
      excludeEntityRef: "user:default/jane",
    });
    expect(arg.payload.topic).toBe("comment:thread:created");
    expect(arg.payload.title).toBe("Jane Doe commented on Guide · Docs");
    expect(arg.payload.description).toBe("hello");
    expect(arg.payload.scope).toBe("rw:comment:c1");
    expect(arg.payload.severity).toBe("normal");
    expect(arg.payload.link).toBe("/catalog/default/component/my-docs/docs/guide#comment-c1");
  });

  it("reply create → recipients from participants, topic:reply:created, title 'replied on'", async () => {
    await notifier.process(
      makeActivity({
        parentId: "c1",
        participants: ["user:default/jane", "user:default/bob"],
      }),
    );

    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0][0];
    expect(arg.recipients).toEqual({
      type: "entity",
      entityRef: ["user:default/jane", "user:default/bob"],
      excludeEntityRef: "user:default/jane",
    });
    expect(arg.payload.topic).toBe("comment:reply:created");
    expect(arg.payload.title).toBe("Jane Doe replied on Guide · Docs");
  });

  it("resolve → recipients from participants, topic:thread:resolved, title 'resolved a thread', description prefixed Re:", async () => {
    await notifier.process(
      makeActivity({
        action: "resolved",
        rootId: "c1",
        participants: ["user:default/jane", "user:default/bob"],
        bodySnippet: "all set",
      }),
    );

    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0][0];
    expect(arg.recipients).toEqual({
      type: "entity",
      entityRef: ["user:default/jane", "user:default/bob"],
      excludeEntityRef: "user:default/jane",
    });
    expect(arg.payload.topic).toBe("comment:thread:resolved");
    expect(arg.payload.title).toBe("Jane Doe resolved a thread on Guide · Docs");
    expect(arg.payload.description).toBe("Re: all set");
  });

  it("null entityRef → link: undefined", async () => {
    await notifier.process(makeActivity({ entityRef: null }));

    expect(send.mock.calls[0][0].payload.link).toBeUndefined();
  });

  it("subject dedup: pageTitle === sectionTitle → title contains 'on Guide' (no · suffix)", async () => {
    await notifier.process(makeActivity({ pageTitle: "Guide", sectionTitle: "Guide" }));

    expect(send.mock.calls[0][0].payload.title).toBe("Jane Doe commented on Guide");
  });

  it("subject fallback: both null → 'the docs'", async () => {
    await notifier.process(makeActivity({ pageTitle: null, sectionTitle: null }));

    expect(send.mock.calls[0][0].payload.title).toBe("Jane Doe commented on the docs");
  });

  it("actor fallback: empty actorName → 'Someone'", async () => {
    await notifier.process(makeActivity({ actorName: "" }));

    expect(send.mock.calls[0][0].payload.title).toBe("Someone commented on Guide · Docs");
  });

  it("empty recipients (top-level create with sectionOwnerRef:null) → send NOT called", async () => {
    await notifier.process(makeActivity({ sectionOwnerRef: null }));

    expect(send).not.toHaveBeenCalled();
  });

  it("never throws when send rejects (best-effort)", async () => {
    send.mockRejectedValue(new Error("notifications down"));

    await expect(notifier.process(makeActivity())).resolves.toBeUndefined();
  });

  it("getName() returns 'rw-comment-notifications'", () => {
    expect(notifier.getName()).toBe("rw-comment-notifications");
  });

  it("top-level create: section owner IS the actor → still sends with owner as recipient (excluded at delivery)", async () => {
    // Guards against a filter like `sectionOwnerRef !== actorRef` that would suppress
    // notifications when the owner posts to their own section. Exclusion is left entirely
    // to the delivery layer (excludeEntityRef); the processor always emits.
    await notifier.process(
      makeActivity({
        actorRef: "user:default/jane",
        sectionOwnerRef: "user:default/jane",
      }),
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].recipients).toEqual({
      type: "entity",
      entityRef: ["user:default/jane"],
      excludeEntityRef: "user:default/jane",
    });
  });

  it("reply with empty participants → send NOT called", async () => {
    await notifier.process(
      makeActivity({
        parentId: "c1",
        participants: [],
      }),
    );

    expect(send).not.toHaveBeenCalled();
  });
});
