import { mockServices } from "@backstage/backend-test-utils";
import { CommentEventPayload } from "@rwdocs/backstage-plugin-rw-common";
import { CommentNotifier } from "./CommentNotifier";

function payload(over: Partial<CommentEventPayload>): CommentEventPayload {
  return {
    kind: "created",
    audience: "owner",
    occurredAt: "2026-06-26T00:00:00.000Z",
    commentId: "c1",
    rootId: "c1",
    parentId: null,
    siteRef: "component:default/site",
    sectionRef: "sec-1",
    pageRef: "sec-1#guide/setup",
    actorRef: "user:default/alice",
    actorName: "Alice Smith",
    pageTitle: "Setup Guide",
    sectionTitle: "My Service",
    recipients: ["group:default/team"],
    entityRef: "component:default/site",
    deepLinkSuffix: "/docs/guide/setup#comment-c1",
    bodySnippet: "please review",
    ...over,
  };
}

describe("CommentNotifier", () => {
  const logger = mockServices.logger.mock();

  it("owner/created → '<actor> commented on <page> · <area>'", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const notifier = new CommentNotifier({ notifications: { send } as any, logger });

    await notifier.handle(payload({}));

    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0][0];
    expect(arg.recipients).toEqual({ type: "entity", entityRef: ["group:default/team"] });
    expect(arg.payload.title).toBe("Alice Smith commented on Setup Guide · My Service");
    expect(arg.payload.description).toBe("please review");
    expect(arg.payload.link).toBe("/catalog/default/component/site/docs/guide/setup#comment-c1");
    expect(arg.payload.scope).toBe("rw:comment:c1");
    expect(arg.payload.severity).toBe("normal");
  });

  it("participants/created → '<actor> replied on <subject>'", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const notifier = new CommentNotifier({ notifications: { send } as any, logger });
    await notifier.handle(
      payload({ audience: "participants", parentId: "c1", recipients: ["user:default/bob"] }),
    );
    expect(send.mock.calls[0][0].payload.title).toBe(
      "Alice Smith replied on Setup Guide · My Service",
    );
  });

  it("resolved → '<actor> resolved a thread on <subject>', description prefixed Re:", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const notifier = new CommentNotifier({ notifications: { send } as any, logger });
    await notifier.handle(
      payload({ kind: "resolved", audience: "participants", recipients: ["user:default/alice"] }),
    );
    const p = send.mock.calls[0][0].payload;
    expect(p.title).toBe("Alice Smith resolved a thread on Setup Guide · My Service");
    expect(p.description).toBe("Re: please review");
  });

  it("subject dedup: page === area → uses page only (no · suffix)", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const notifier = new CommentNotifier({ notifications: { send } as any, logger });
    // When comment is on the section root (subpath ""), pageTitle === sectionTitle → shown once.
    await notifier.handle(payload({ pageTitle: "Биллинг", sectionTitle: "Биллинг" }));
    expect(send.mock.calls[0][0].payload.title).toBe("Alice Smith commented on Биллинг");
  });

  it("subject: page !== area → 'page · area' format", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const notifier = new CommentNotifier({ notifications: { send } as any, logger });
    // When comment is on a sub-page: pageTitle="ADRs", sectionTitle="Биллинг" (section root).
    await notifier.handle(payload({ pageTitle: "ADRs", sectionTitle: "Биллинг" }));
    expect(send.mock.calls[0][0].payload.title).toBe("Alice Smith commented on ADRs · Биллинг");
  });

  it("subject fallback: both null → 'the docs'", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const notifier = new CommentNotifier({ notifications: { send } as any, logger });
    await notifier.handle(payload({ pageTitle: null, sectionTitle: null }));
    expect(send.mock.calls[0][0].payload.title).toBe("Alice Smith commented on the docs");
  });

  it("actor fallback: empty actorName → 'Someone'", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const notifier = new CommentNotifier({ notifications: { send } as any, logger });
    await notifier.handle(payload({ actorName: "" }));
    expect(send.mock.calls[0][0].payload.title).toBe(
      "Someone commented on Setup Guide · My Service",
    );
  });

  it("omits the link when entityRef is null (degraded)", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const notifier = new CommentNotifier({ notifications: { send } as any, logger });
    await notifier.handle(payload({ entityRef: null }));
    expect(send.mock.calls[0][0].payload.link).toBeUndefined();
  });

  it("never throws when send rejects", async () => {
    const send = jest.fn().mockRejectedValue(new Error("notifications down"));
    const notifier = new CommentNotifier({ notifications: { send } as any, logger });
    await expect(notifier.handle(payload({}))).resolves.toBeUndefined();
  });

  it("drops a payload with empty recipients without sending", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const notifier = new CommentNotifier({ notifications: { send } as any, logger });
    await notifier.handle(payload({ recipients: [] }));
    expect(send).not.toHaveBeenCalled();
  });

  it("drops a malformed payload (recipients not an array) without sending", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const notifier = new CommentNotifier({ notifications: { send } as any, logger });
    await notifier.handle(payload({ recipients: undefined as any }));
    expect(send).not.toHaveBeenCalled();
  });

  it("drops a malformed payload (unknown kind) without sending", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const notifier = new CommentNotifier({ notifications: { send } as any, logger });
    await notifier.handle(payload({ kind: "deleted" as any }));
    expect(send).not.toHaveBeenCalled();
  });

  it("topic: owner/created → comment:thread:created", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const notifier = new CommentNotifier({ notifications: { send } as any, logger });
    await notifier.handle(payload({}));
    expect(send.mock.calls[0][0].payload.topic).toBe("comment:thread:created");
  });

  it("topic: participants/created (reply) → comment:reply:created", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const notifier = new CommentNotifier({ notifications: { send } as any, logger });
    await notifier.handle(
      payload({ audience: "participants", parentId: "c1", recipients: ["user:default/bob"] }),
    );
    expect(send.mock.calls[0][0].payload.topic).toBe("comment:reply:created");
  });

  it("topic: resolved → comment:thread:resolved", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const notifier = new CommentNotifier({ notifications: { send } as any, logger });
    await notifier.handle(
      payload({ kind: "resolved", audience: "participants", recipients: ["user:default/alice"] }),
    );
    expect(send.mock.calls[0][0].payload.topic).toBe("comment:thread:resolved");
  });
});
