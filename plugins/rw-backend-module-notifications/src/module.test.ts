/**
 * Integration test for the rw notifications module.
 *
 * Harness approach: real `startTestBackend` integration (sandbox disabled for net.listen).
 *
 * The test boots the module via `startTestBackend`, which:
 * - Provides a `MockEventsService` (from `mockServices.events.factory()`) that actually
 *   routes `publish` → all matching `subscribe` callbacks.
 * - Requires a mock `notificationService` factory (plugin-scoped) so the module's init can
 *   resolve its dependency.
 * - Uses a "capture module" that deps on `eventsServiceRef` and stashes the service instance
 *   into a test-scoped variable (since `TestBackend.server` exposes HTTP, not getService()).
 *
 * This exercises module.ts's literal `registerInit` / `subscribe` wiring and the real
 * `CommentNotifier.handle` path end-to-end.
 */
import { createBackendModule, createServiceFactory } from "@backstage/backend-plugin-api";
import { eventsServiceRef } from "@backstage/plugin-events-node";
import { mockServices, startTestBackend } from "@backstage/backend-test-utils";
import {
  notificationService,
  type NotificationService,
} from "@backstage/plugin-notifications-node";
import { CommentEventPayload, RW_COMMENTS_TOPIC } from "@rwdocs/backstage-plugin-rw-common";
import type { EventsService } from "@backstage/plugin-events-node";

// The module under test.
import notificationsModule from "./module";

function makePayload(over: Partial<CommentEventPayload> = {}): CommentEventPayload {
  return {
    kind: "created",
    audience: "owner",
    occurredAt: "2026-06-26T00:00:00.000Z",
    commentId: "c1",
    rootId: "c1",
    parentId: null,
    siteRef: "component:default/site",
    sectionRef: "sec-1",
    documentId: "sec-1#guide",
    actorRef: "user:default/alice",
    actorName: "Alice",
    pageTitle: null,
    sectionTitle: null,
    recipients: ["group:default/team"],
    entityRef: "component:default/site",
    deepLinkSuffix: "/docs/guide#comment-c1",
    bodySnippet: "review please",
    ...over,
  };
}

describe("rw notifications module — real startTestBackend integration", () => {
  it("subscribe→handle: publishes a notification when an rw.comments event is emitted", async () => {
    const send = jest.fn<Promise<void>, [Parameters<NotificationService["send"]>[0]]>(
      async () => undefined,
    );

    // Mock factory for notificationService (plugin-scoped).
    const notificationFactory = createServiceFactory({
      service: notificationService,
      deps: {},
      factory: () => ({ send }) as NotificationService,
    });

    // Capture module: stashes the events service so we can publish after boot.
    let capturedEvents: EventsService | undefined;
    const captureModule = createBackendModule({
      pluginId: "rw",
      moduleId: "test-events-capture",
      register(env) {
        env.registerInit({
          deps: { events: eventsServiceRef },
          async init({ events }) {
            capturedEvents = events;
          },
        });
      },
    });

    await startTestBackend({
      features: [
        notificationsModule,
        notificationFactory,
        captureModule,
        // Silence logger noise in tests.
        mockServices.rootLogger.factory({ level: "none" }),
      ],
    });

    // capturedEvents is set by captureModule.init() during startTestBackend.
    expect(capturedEvents).toBeDefined();

    // Publish an rw.comments event through the real MockEventsService.
    const payload = makePayload();
    await capturedEvents!.publish({ topic: RW_COMMENTS_TOPIC, eventPayload: payload });
    await new Promise((resolve) => setImmediate(resolve));

    // Module's subscribe callback → CommentNotifier.handle → notificationService.send.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].recipients).toEqual({
      type: "entity",
      entityRef: ["group:default/team"],
    });
  });

  it("onEvent handler is best-effort: never throws even when send rejects", async () => {
    const send = jest
      .fn<Promise<void>, [Parameters<NotificationService["send"]>[0]]>()
      .mockRejectedValue(new Error("notifications down"));

    const notificationFactory = createServiceFactory({
      service: notificationService,
      deps: {},
      factory: () => ({ send }) as NotificationService,
    });

    let capturedEvents: EventsService | undefined;
    const captureModule = createBackendModule({
      pluginId: "rw",
      moduleId: "test-events-capture",
      register(env) {
        env.registerInit({
          deps: { events: eventsServiceRef },
          async init({ events }) {
            capturedEvents = events;
          },
        });
      },
    });

    await startTestBackend({
      features: [
        notificationsModule,
        notificationFactory,
        captureModule,
        mockServices.rootLogger.factory({ level: "none" }),
      ],
    });

    expect(capturedEvents).toBeDefined();

    // Should resolve (not throw) even though send rejects — CommentNotifier catches internally.
    await expect(
      capturedEvents!.publish({ topic: RW_COMMENTS_TOPIC, eventPayload: makePayload() }),
    ).resolves.toBeUndefined();
  });

  it("is a BackendFeature (module definition passes basic shape check)", () => {
    expect(notificationsModule).toBeDefined();
    expect((notificationsModule as any).$$type).toBe("@backstage/BackendFeature");
  });
});
