import {
  coreServices,
  createBackendPlugin,
  resolvePackagePath,
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
} from "@backstage/backend-plugin-api";
import { SectionOwnershipStore } from "./siteIndex/SectionOwnershipStore";
import { RegistryStore } from "./siteIndex/RegistryStore";
import { SiteRefreshStore } from "./siteIndex/SiteRefreshStore";
import { runScan } from "./siteIndex/runScan";
import { runWorker } from "./siteIndex/runWorker";
import { makeSiteFactory } from "./siteIndex/schedule";
import { readDurationFromConfig } from "@backstage/config";
import {
  readRwSiteConfig,
  rwCommentResourcePermissions,
  toEntityPath,
} from "@rwdocs/backstage-plugin-rw-common";
import { catalogServiceRef } from "@backstage/plugin-catalog-node";
import { eventsServiceRef } from "@backstage/plugin-events-node";
import { createRouter } from "./router";
import { Hub, type HubOptions } from "./hub";
import { CommentStore } from "./comments/CommentStore";
import { createCommentsRouter } from "./comments/router";
import { CommentEventPublisher } from "./comments/CommentEventPublisher";
import { SectionsReader } from "./siteIndex/SectionsReader";
import { PagesReader } from "./siteIndex/PagesReader";
import { commentResourceRef, isCommentAuthor } from "./comments/permissions";
import { toCommentResponse } from "./comments/mapping";
import { InboxStore } from "./inbox/InboxStore";
import { createInboxRouter } from "./inbox/inboxRouter";

export const rwPlugin = createBackendPlugin({
  pluginId: "rw",
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        scheduler: coreServices.scheduler,
        database: coreServices.database,
        permissions: coreServices.permissions,
        permissionsRegistry: coreServices.permissionsRegistry,
        userInfo: coreServices.userInfo,
        auth: coreServices.auth,
        catalog: catalogServiceRef,
        events: eventsServiceRef,
      },
      async init({
        httpRouter,
        httpAuth,
        logger,
        config,
        scheduler,
        database,
        permissions,
        permissionsRegistry,
        userInfo,
        auth,
        catalog,
        events,
      }) {
        const siteConfig = readRwSiteConfig(config);
        const cacheSize = config.getOptionalNumber("rw.cacheSize");

        const hubOptions: HubOptions = {
          ...siteConfig,
          cacheSize,
        };

        const hub = new Hub(hubOptions);

        if (siteConfig.s3) {
          logger.info(
            `Hub: S3 mode (bucket: ${siteConfig.s3.bucket}, cache size: ${cacheSize ?? 20})`,
          );
        } else {
          logger.info(
            `Hub: local mode (${siteConfig.projectDir}, entity: ${siteConfig.entity ? toEntityPath(siteConfig.entity) : siteConfig.entity})`,
          );
        }

        if (config.has("rw.reloadInterval")) {
          const frequency = readDurationFromConfig(config, { key: "rw.reloadInterval" });
          logger.info(`Scheduling site reload with interval: ${JSON.stringify(frequency)}`);

          await scheduler.scheduleTask({
            id: "rw-site-reload",
            frequency,
            timeout: frequency,
            scope: "local",
            fn: async () => hub.reloadAll(logger),
          });
        }

        const client = await database.getClient();
        if (!database.migrations?.skip) {
          await client.migrate.latest({
            directory: resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations"),
          });
        }
        const store = new CommentStore(client);
        const inboxStore = new InboxStore(client);

        const sectionOwnershipStore = new SectionOwnershipStore(client);
        const registryStore = new RegistryStore(client);
        const siteRefreshStore = new SiteRefreshStore(client);
        const sectionsReader = new SectionsReader(client);
        const pagesReader = new PagesReader(client);
        const publisher = new CommentEventPublisher({
          events,
          sections: sectionsReader,
          comments: store,
          logger,
          pages: pagesReader,
        });
        const makeSite = makeSiteFactory(siteConfig);

        const scanSchedule = config.has("rw.siteIndex.schedule")
          ? readSchedulerServiceTaskScheduleDefinitionFromConfig(
              config.getConfig("rw.siteIndex.schedule"),
            )
          : { frequency: { minutes: 15 }, timeout: { minutes: 10 }, initialDelay: { seconds: 30 } };
        const workerSchedule = config.has("rw.siteIndex.worker")
          ? readSchedulerServiceTaskScheduleDefinitionFromConfig(
              config.getConfig("rw.siteIndex.worker"),
            )
          : { frequency: { seconds: 30 }, timeout: { minutes: 5 }, initialDelay: { seconds: 10 } };

        await scheduler.scheduleTask({
          id: "rw-site-index-scan",
          scope: "global",
          ...scanSchedule,
          fn: async () =>
            runScan({ catalog, auth, logger, siteConfig, sectionOwnershipStore, siteRefreshStore }),
        });
        await scheduler.scheduleTask({
          id: "rw-site-index-worker",
          scope: "local",
          ...workerSchedule,
          fn: async () =>
            runWorker({ logger, siteRefreshStore, registryStore, sectionOwnershipStore, makeSite }),
        });
        logger.info(
          `Scheduled site index rebuild: scan ${JSON.stringify(scanSchedule.frequency)} (global), ` +
            `worker ${JSON.stringify(workerSchedule.frequency)} (local)`,
        );

        const commentsEnabled = config.getOptionalBoolean("rw.comments.enabled") ?? true;

        permissionsRegistry.addResourceType({
          resourceRef: commentResourceRef,
          permissions: rwCommentResourcePermissions,
          rules: [isCommentAuthor],
          getResources: async (ids: string[]) =>
            Promise.all(
              ids.map(async (id) => {
                const row = await store.get(id);
                return row ? toCommentResponse(row, undefined) : undefined;
              }),
            ),
        });

        const router = await createRouter({
          logger,
          httpAuth,
          hub,
        });
        httpRouter.use(router);
        // The inbox router MUST be mounted before the comments router: it owns the
        // exact path `/comments/inbox`, which would otherwise be shadowed by the
        // comments router's `/comments/:id` route (id="inbox" → 404) when comments
        // are enabled, or its `/comments/*` catch-all (404) when disabled.
        httpRouter.use(
          createInboxRouter({
            httpAuth,
            permissions,
            userInfo,
            store: inboxStore,
            commentStore: store,
            siteRefreshStore,
          }),
        );
        httpRouter.use(
          createCommentsRouter({
            store,
            logger,
            httpAuth,
            auth,
            userInfo,
            permissions,
            permissionsRegistry,
            catalog,
            commentsEnabled,
            publisher,
          }),
        );
        httpRouter.addAuthPolicy({
          path: "/health",
          allow: "unauthenticated",
        });
      },
    });
  },
});
