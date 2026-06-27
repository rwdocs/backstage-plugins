import { mockServices } from "@backstage/backend-test-utils";
import { EventParams, EventsService } from "@backstage/plugin-events-node";
import { CommentEventPublisher } from "./CommentEventPublisher";
import { CommentRow } from "./types";

function fakeEvents() {
  const published: EventParams[] = [];
  const events: EventsService = {
    publish: async (p: EventParams) => {
      published.push(p);
    },
    subscribe: async () => {},
  };
  return { events, published };
}

function fakePages(titles: Record<string, string | undefined> = {}) {
  return {
    getTitle: async (_siteRef: string, _sectionRef: string, subpath: string) =>
      titles[subpath] ?? null,
  } as any;
}

function row(over: Partial<CommentRow>): CommentRow {
  return {
    id: "c1",
    site_ref: "component:default/site",
    document_id: "sec-1#setup",
    section_ref: "sec-1",
    parent_id: null,
    author_ref: "user:default/alice",
    author_profile: JSON.stringify({ displayName: "Alice Smith" }),
    body: "hello",
    body_html: "<p>hello</p>",
    selectors: "[]",
    status: "open",
    created_at: 0,
    updated_at: 0,
    resolved_at: null,
    resolved_by: null,
    deleted_at: null,
    ...over,
  };
}

describe("CommentEventPublisher", () => {
  const logger = mockServices.logger.mock();

  it("owner-side: top-level create publishes to the section owner with correct titles", async () => {
    const { events, published } = fakeEvents();
    const sections = {
      getSection: async () => ({
        site_ref: "component:default/site",
        section_ref: "sec-1",
        section_path: "guide",
        parent_section_ref: null,
        entity_ref: "component:default/site",
        entity_owner_ref: "group:default/team",
      }),
    } as any;
    const comments = { participantsOf: async () => [] } as any;
    // pageTitle: pages.getTitle(siteRef, sectionRef, "setup")
    // sectionTitle:     pages.getTitle(siteRef, sectionRef, "") — section root page
    const pub = new CommentEventPublisher({
      events,
      sections,
      comments,
      logger,
      pages: fakePages({ setup: "Setup Page", "": "Биллинг" }),
    });

    await pub.onCommentCreated(row({ parent_id: null }), "user:default/alice");

    expect(published).toHaveLength(1);
    expect(published[0].topic).toBe("rw.comments");
    expect(published[0].eventPayload).toMatchObject({
      kind: "created",
      audience: "owner",
      recipients: ["group:default/team"],
      entityRef: "component:default/site",
      deepLinkSuffix: "/docs/guide/setup#comment-c1",
      bodySnippet: "hello",
      actorName: "Alice Smith",
      pageTitle: "Setup Page",
      sectionTitle: "Биллинг",
    });
  });

  it("owner-side: sectionTitle comes from pages.getTitle(siteRef, sectionRef, '') — section root", async () => {
    const { events, published } = fakeEvents();
    const sections = {
      getSection: async () => ({
        site_ref: "component:default/site",
        section_ref: "sec-1",
        section_path: "guide",
        parent_section_ref: null,
        entity_ref: "component:default/site",
        entity_owner_ref: "group:default/team",
      }),
    } as any;
    const getTitleCalls: Array<[string, string, string]> = [];
    const pages = {
      getTitle: async (siteRef: string, sectionRef: string, subpath: string) => {
        getTitleCalls.push([siteRef, sectionRef, subpath]);
        return subpath === "" ? "Биллинг" : "Setup Page";
      },
    } as any;
    const pub = new CommentEventPublisher({
      events,
      sections,
      comments: { participantsOf: async () => [] } as any,
      logger,
      pages,
    });
    await pub.onCommentCreated(row({ parent_id: null }), "user:default/alice");
    // Must call getTitle with subpath="" for the area
    expect(getTitleCalls).toContainEqual(["component:default/site", "sec-1", ""]);
    expect(published[0].eventPayload).toMatchObject({
      pageTitle: "Setup Page",
      sectionTitle: "Биллинг",
    });
  });

  it("owner-side: deepLinkSuffix prepends section_path (not just subpath)", async () => {
    // Regression: viewerPath must be joinNonEmpty([section_path, subpath]), not just subpath.
    // With section_path="guide" and document_id subpath "setup", the suffix must be
    // "/docs/guide/setup#comment-c1", not "/docs/setup#comment-c1".
    const { events, published } = fakeEvents();
    const sections = {
      getSection: async () => ({
        site_ref: "component:default/site",
        section_ref: "sec-1",
        section_path: "guide",
        parent_section_ref: null,
        entity_ref: "component:default/site",
        entity_owner_ref: "group:default/team",
      }),
    } as any;
    const pub = new CommentEventPublisher({
      events,
      sections,
      comments: { participantsOf: async () => [] } as any,
      logger,
      pages: fakePages(),
    });
    await pub.onCommentCreated(row({ parent_id: null }), "user:default/alice");
    expect(published).toHaveLength(1);
    const suffix: string = (published[0].eventPayload as any).deepLinkSuffix;
    expect(suffix).toBe("/docs/guide/setup#comment-c1");
    expect(suffix).not.toBe("/docs/setup#comment-c1");
  });

  it("owner-side: skips (no publish) when the section has no owner", async () => {
    const { events, published } = fakeEvents();
    const sections = {
      getSection: async () => ({
        site_ref: "component:default/site",
        section_ref: "sec-1",
        section_path: "guide",
        parent_section_ref: null,
        entity_ref: "component:default/site",
        entity_owner_ref: null,
      }),
    } as any;
    const pub = new CommentEventPublisher({
      events,
      sections,
      comments: { participantsOf: async () => [] } as any,
      logger,
      pages: fakePages(),
    });
    await pub.onCommentCreated(row({ parent_id: null }), "user:default/alice");
    expect(published).toHaveLength(0);
  });

  it("owner-side: skips when the section row is missing", async () => {
    const { events, published } = fakeEvents();
    const pub = new CommentEventPublisher({
      events,
      sections: { getSection: async () => undefined } as any,
      comments: { participantsOf: async () => [] } as any,
      logger,
      pages: fakePages(),
    });
    await pub.onCommentCreated(row({ parent_id: null }), "user:default/alice");
    expect(published).toHaveLength(0);
  });

  it("commenter-side: reply notifies prior participants minus the actor", async () => {
    const { events, published } = fakeEvents();
    const sections = {
      getSection: async () => ({
        site_ref: "component:default/site",
        section_ref: "sec-1",
        section_path: "guide",
        parent_section_ref: null,
        entity_ref: "component:default/site",
        entity_owner_ref: "group:default/team",
      }),
    } as any;
    const comments = {
      participantsOf: async () => ["user:default/alice", "user:default/bob"],
    } as any;
    const pub = new CommentEventPublisher({
      events,
      sections,
      comments,
      logger,
      pages: fakePages(),
    });

    await pub.onCommentCreated(
      row({ id: "c2", parent_id: "c1", author_ref: "user:default/bob" }),
      "user:default/bob",
    );

    expect(published).toHaveLength(1);
    expect(published[0].eventPayload).toMatchObject({
      kind: "created",
      audience: "participants",
      commentId: "c2",
      rootId: "c1",
      recipients: ["user:default/alice"],
      // deeplink anchors on the thread root (c1), not the reply (c2),
      // so opening the notification lands on the whole thread.
      deepLinkSuffix: "/docs/guide/setup#comment-c1",
    });
  });

  it("commenter-side: no publish when the actor is the only participant", async () => {
    const { events, published } = fakeEvents();
    const comments = { participantsOf: async () => ["user:default/bob"] } as any;
    const pub = new CommentEventPublisher({
      events,
      sections: { getSection: async () => undefined } as any,
      comments,
      logger,
      pages: fakePages(),
    });
    await pub.onCommentCreated(
      row({ id: "c2", parent_id: "c1", author_ref: "user:default/bob" }),
      "user:default/bob",
    );
    expect(published).toHaveLength(0);
  });

  it("owner-side: actorName comes from author_profile in the row", async () => {
    const { events, published } = fakeEvents();
    const sections = {
      getSection: async () => ({
        site_ref: "component:default/site",
        section_ref: "sec-1",
        section_path: "guide",
        parent_section_ref: null,
        entity_ref: "component:default/site",
        entity_owner_ref: "group:default/team",
      }),
    } as any;
    const pub = new CommentEventPublisher({
      events,
      sections,
      comments: { participantsOf: async () => [] } as any,
      logger,
      pages: fakePages(),
    });
    await pub.onCommentCreated(
      row({ author_profile: JSON.stringify({ displayName: "Alice Smith" }) }),
      "user:default/alice",
    );
    expect(published[0].eventPayload).toMatchObject({ actorName: "Alice Smith" });
  });

  it("resolve: notifies all participants minus the resolver; uses passed-in actorName", async () => {
    const { events, published } = fakeEvents();
    const sections = { getSection: async () => undefined } as any; // degraded link OK
    const comments = {
      participantsOf: async () => ["user:default/alice", "user:default/bob"],
    } as any;
    const pub = new CommentEventPublisher({
      events,
      sections,
      comments,
      logger,
      pages: fakePages(),
    });

    await pub.onCommentResolved(
      row({ id: "c1", parent_id: null }),
      "user:default/bob",
      "Bob Builder",
    );

    expect(published).toHaveLength(1);
    expect(published[0].eventPayload).toMatchObject({
      kind: "resolved",
      audience: "participants",
      recipients: ["user:default/alice"],
      entityRef: null, // degraded: no section row
      actorName: "Bob Builder",
    });
  });

  it("resolve: falls back to parsed entity name when actorName param is missing", async () => {
    const { events, published } = fakeEvents();
    const comments = {
      participantsOf: async () => ["user:default/alice", "user:default/bob"],
    } as any;
    const pub = new CommentEventPublisher({
      events,
      sections: { getSection: async () => undefined } as any,
      comments,
      logger,
      pages: fakePages(),
    });

    // No actorName param passed
    await pub.onCommentResolved(row({ id: "c1", parent_id: null }), "user:default/bob");

    expect(published[0].eventPayload).toMatchObject({
      actorName: "bob", // parseEntityRef("user:default/bob").name
    });
  });

  it("never throws when publish rejects", async () => {
    const events: EventsService = {
      publish: async () => {
        throw new Error("bus down");
      },
      subscribe: async () => {},
    };
    const sections = {
      getSection: async () => ({
        site_ref: "component:default/site",
        section_ref: "sec-1",
        section_path: "guide",
        parent_section_ref: null,
        entity_ref: "component:default/site",
        entity_owner_ref: "group:default/team",
      }),
    } as any;
    const pub = new CommentEventPublisher({
      events,
      sections,
      comments: { participantsOf: async () => [] } as any,
      logger,
      pages: fakePages(),
    });
    await expect(
      pub.onCommentCreated(row({ parent_id: null }), "user:default/alice"),
    ).resolves.toBeUndefined();
  });

  it("onCommentResolved never throws when publish rejects", async () => {
    const events: EventsService = {
      publish: async () => {
        throw new Error("bus down");
      },
      subscribe: async () => {},
    };
    const comments = {
      participantsOf: async () => ["user:default/alice", "user:default/bob"],
    } as any;
    const pub = new CommentEventPublisher({
      events,
      sections: { getSection: async () => undefined } as any,
      comments,
      logger,
      pages: fakePages(),
    });
    await expect(
      pub.onCommentResolved(row({ id: "c1", parent_id: null }), "user:default/bob", "Bob Builder"),
    ).resolves.toBeUndefined();
  });
});
