import { coreServices, createBackendModule } from "@backstage/backend-plugin-api";
import { eventsServiceRef } from "@backstage/plugin-events-node";
import { notificationService } from "@backstage/plugin-notifications-node";
import { RW_COMMENTS_TOPIC, CommentEventPayload } from "@rwdocs/backstage-plugin-rw-common";
import { CommentNotifier } from "./CommentNotifier";

/** Opt-in backend module: subscribes to rw-backend's `rw.comments` domain events and
 *  delivers native notifications. Installing this module is the opt-in; omitting it is the
 *  opt-out (rw-backend still publishes harmlessly). pluginId is `rw` (it augments the rw
 *  plugin, driven by rw's events) — it is a notification *sender*, not a *processor*, so it
 *  registers into no notifications-plugin extension point. */
export default createBackendModule({
  pluginId: "rw",
  moduleId: "notifications",
  register(env) {
    env.registerInit({
      deps: {
        events: eventsServiceRef,
        notifications: notificationService,
        logger: coreServices.logger,
      },
      async init({ events, notifications, logger }) {
        const notifier = new CommentNotifier({ notifications, logger });
        await events.subscribe({
          id: "rw-comment-notifications",
          topics: [RW_COMMENTS_TOPIC],
          onEvent: async (params) => {
            await notifier.handle(params.eventPayload as CommentEventPayload);
          },
        });
        logger.info("rw notifications module subscribed to rw.comments");
      },
    });
  },
});
