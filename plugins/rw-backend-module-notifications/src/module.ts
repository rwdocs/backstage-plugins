import { coreServices, createBackendModule } from "@backstage/backend-plugin-api";
import { notificationService } from "@backstage/plugin-notifications-node";
import { rwCommentProcessingExtensionPoint } from "@rwdocs/backstage-plugin-rw-node";
import { CommentNotifier } from "./CommentNotifier";

/** Opt-in backend module: registers a CommentProcessor on rw-backend's comment-processing
 *  extension point and delivers native notifications. Installing this module is the opt-in;
 *  omitting it means rw-backend resolves nothing extra. pluginId is `rw` (it augments the rw
 *  plugin). No DB, events, or catalog — it only formats a resolved CommentActivity and sends. */
export default createBackendModule({
  pluginId: "rw",
  moduleId: "notifications",
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        notifications: notificationService,
        comments: rwCommentProcessingExtensionPoint,
      },
      async init({ logger, notifications, comments }) {
        comments.addProcessor(new CommentNotifier({ notifications, logger }));
        logger.info("rw notifications module registered a comment processor");
      },
    });
  },
});
