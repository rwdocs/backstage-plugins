import {
  coreServices,
  createBackendModule,
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
} from "@backstage/backend-plugin-api";
import { searchIndexRegistryExtensionPoint } from "@backstage/plugin-search-backend-node/alpha";
import { catalogServiceRef } from "@backstage/plugin-catalog-node";
import { RwDocsCollatorFactory } from "./collator/RwDocsCollatorFactory";

export default createBackendModule({
  pluginId: "search",
  moduleId: "rw-collator",
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
        auth: coreServices.auth,
        indexRegistry: searchIndexRegistryExtensionPoint,
        catalog: catalogServiceRef,
      },
      async init({ config, logger, scheduler, auth, indexRegistry, catalog }) {
        const schedule = config.has("search.collators.rw.schedule")
          ? readSchedulerServiceTaskScheduleDefinitionFromConfig(
              config.getConfig("search.collators.rw.schedule"),
            )
          : {
              frequency: { minutes: 10 },
              timeout: { minutes: 15 },
              initialDelay: { seconds: 3 },
            };

        indexRegistry.addCollator({
          schedule: scheduler.createScheduledTaskRunner(schedule),
          factory: RwDocsCollatorFactory.fromConfig(config, { logger, auth, catalog }),
        });
      },
    });
  },
});
