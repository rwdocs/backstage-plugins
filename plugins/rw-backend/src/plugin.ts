import { coreServices, createBackendPlugin } from "@backstage/backend-plugin-api";
import { readDurationFromConfig } from "@backstage/config";
import { readRwSiteConfig, toEntityPath } from "@rwdocs/backstage-plugin-rw-common";
import { createRouter } from "./router";
import { Hub, type HubOptions } from "./hub";

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
      },
      async init({ httpRouter, httpAuth, logger, config, scheduler }) {
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

        const router = await createRouter({ logger, httpAuth, hub });
        httpRouter.use(router);
        httpRouter.addAuthPolicy({
          path: "/health",
          allow: "unauthenticated",
        });
      },
    });
  },
});
