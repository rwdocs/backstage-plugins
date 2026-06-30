/**
 * Integration test for the rw notifications module.
 *
 * Harness approach: real `startTestBackend` (sandbox disabled for net.listen).
 *
 * Boots a tiny host plugin (pluginId `rw`) that registers
 * `rwCommentProcessingExtensionPoint` with a capturing impl, then mounts the
 * notifications module, and asserts exactly one processor was registered with
 * the expected name.
 */
import {
  createBackendModule,
  createBackendPlugin,
  createServiceFactory,
} from "@backstage/backend-plugin-api";
import { mockServices, startTestBackend } from "@backstage/backend-test-utils";
import {
  notificationService,
  type NotificationService,
} from "@backstage/plugin-notifications-node";
import {
  rwCommentProcessingExtensionPoint,
  type CommentActivity,
  type CommentProcessor,
} from "@rwdocs/backstage-plugin-rw-node";

// The module under test.
import notificationsModule from "./module";
import { rwCommentRecipientExtensionPoint } from "./extensionPoints";

describe("rw notifications module — startTestBackend extension-point capture", () => {
  it("registers exactly one processor named 'rw-comment-notifications'", async () => {
    const send = jest.fn<Promise<void>, [Parameters<NotificationService["send"]>[0]]>(
      async () => undefined,
    );

    const notificationFactory = createServiceFactory({
      service: notificationService,
      deps: {},
      factory: () => ({ send }) as NotificationService,
    });

    // host plugin provides the extension point and captures registered processors;
    // module init runs before the plugin init, so `captured` is populated when init reads it.
    let captured: CommentProcessor[] = [];
    const hostPlugin = createBackendPlugin({
      pluginId: "rw",
      register(env) {
        const processors: CommentProcessor[] = [];
        env.registerExtensionPoint(rwCommentProcessingExtensionPoint, {
          addProcessor: (...ps) => {
            processors.push(...ps.flat());
          },
        });
        env.registerInit({
          deps: {},
          async init() {
            captured = processors;
          },
        });
      },
    });

    await startTestBackend({
      features: [
        hostPlugin,
        notificationsModule,
        notificationFactory,
        mockServices.rootLogger.factory({ level: "none" }),
      ],
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].getName()).toBe("rw-comment-notifications");

    // Drive the registered processor end-to-end: a top-level create with a sectionOwnerRef
    // must reach the injected notification service, catching wrong-service-injection wiring.
    const activity: CommentActivity = {
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
    };
    await captured[0].process(activity);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("is a BackendFeature (module definition passes basic shape check)", () => {
    expect(notificationsModule).toBeDefined();
    expect((notificationsModule as any).$$type).toBe("@backstage/BackendFeature");
  });
});

describe("rw notifications module — recipient resolver extension point", () => {
  function notificationFactoryWith(
    send: jest.Mock<Promise<void>, [Parameters<NotificationService["send"]>[0]]>,
  ) {
    return createServiceFactory({
      service: notificationService,
      deps: {},
      factory: () => ({ send }) as NotificationService,
    });
  }

  // Host plugin that owns rwCommentProcessingExtensionPoint and captures registered processors.
  function captureHost(capture: { processors: CommentProcessor[] }) {
    return createBackendPlugin({
      pluginId: "rw",
      register(env) {
        const processors: CommentProcessor[] = [];
        env.registerExtensionPoint(rwCommentProcessingExtensionPoint, {
          addProcessor: (...ps) => {
            processors.push(...ps.flat());
          },
        });
        env.registerInit({
          deps: {},
          async init() {
            capture.processors = processors;
          },
        });
      },
    });
  }

  it("a registered custom resolver overrides recipients", async () => {
    const send = jest.fn<Promise<void>, [Parameters<NotificationService["send"]>[0]]>(
      async () => undefined,
    );
    const capture = { processors: [] as CommentProcessor[] };

    const activity: CommentActivity = {
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
    };

    // Sibling module (same pluginId "rw") that consumes the recipient extension point.
    const companyModule = createBackendModule({
      pluginId: "rw",
      moduleId: "company-recipients",
      register(reg) {
        reg.registerInit({
          deps: { recipients: rwCommentRecipientExtensionPoint },
          async init({ recipients }) {
            recipients.setRecipientResolver({
              getName: () => "company",
              resolveRecipients: async () => ["user:default/maintainer"],
            });
          },
        });
      },
    });

    await startTestBackend({
      features: [
        captureHost(capture),
        notificationsModule,
        companyModule,
        notificationFactoryWith(send),
        mockServices.rootLogger.factory({ level: "none" }),
      ],
    });

    expect(capture.processors).toHaveLength(1);
    await capture.processors[0].process(activity);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].recipients).toEqual({
      type: "entity",
      entityRef: ["user:default/maintainer"], // not group:default/docs
      excludeEntityRef: "user:default/jane",
    });
  });

  it("a second setRecipientResolver throws → backend startup fails", async () => {
    const send = jest.fn<Promise<void>, [Parameters<NotificationService["send"]>[0]]>(
      async () => undefined,
    );
    const capture = { processors: [] as CommentProcessor[] };

    const doubleRegisterModule = createBackendModule({
      pluginId: "rw",
      moduleId: "double-register",
      register(reg) {
        reg.registerInit({
          deps: { recipients: rwCommentRecipientExtensionPoint },
          async init({ recipients }) {
            const r = { getName: () => "x", resolveRecipients: async () => [] as string[] };
            recipients.setRecipientResolver(r);
            recipients.setRecipientResolver(r); // second call must throw
          },
        });
      },
    });

    await expect(
      startTestBackend({
        features: [
          captureHost(capture),
          notificationsModule,
          doubleRegisterModule,
          notificationFactoryWith(send),
          mockServices.rootLogger.factory({ level: "none" }),
        ],
      }),
    ).rejects.toThrow(/already registered/);
  });
});
