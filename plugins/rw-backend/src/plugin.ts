import { coreServices, createBackendPlugin } from "@backstage/backend-plugin-api";
import { parseEntityRef } from "@backstage/catalog-model";
import { createRouter } from "./router";
import { Hub, type HubOptions } from "./hub";

function toEntityPath(entityRef: string): string {
  const ref = parseEntityRef(entityRef);
  return `${ref.kind}/${ref.namespace}/${ref.name}`.toLocaleLowerCase("en-US");
}

export const rwPlugin = createBackendPlugin({
  pluginId: "rw",
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        logger: coreServices.logger,
        config: coreServices.rootConfig,
      },
      async init({ httpRouter, httpAuth, logger, config }) {
        const projectDir = config.getOptionalString("rw.projectDir");
        const entityRaw = config.getOptionalString("rw.entity");
        const entity = entityRaw ? toEntityPath(entityRaw) : undefined;
        const linkPrefix = config.getOptionalString("rw.linkPrefix");
        const cacheSize = config.getOptionalNumber("rw.cacheSize");

        const s3Config = config.getOptionalConfig("rw.s3");
        const s3 = s3Config
          ? {
              bucket: s3Config.getString("bucket"),
              region: s3Config.getOptionalString("region"),
              endpoint: s3Config.getOptionalString("endpoint"),
              bucketRootPath: s3Config.getOptionalString("bucketRootPath"),
              accessKeyId: s3Config.getOptionalString("accessKeyId"),
              secretAccessKey: s3Config.getOptionalString("secretAccessKey"),
            }
          : undefined;

        if (!projectDir && !s3) {
          throw new Error("Either rw.projectDir or rw.s3 must be configured");
        }

        if (projectDir && !entity) {
          throw new Error("rw.entity is required when rw.projectDir is set");
        }

        let diagrams: { krokiUrl?: string; dpi?: number } | undefined;
        const diagramsConfig = config.getOptionalConfig("rw.diagrams");
        if (diagramsConfig) {
          diagrams = {
            krokiUrl: diagramsConfig.getOptionalString("krokiUrl"),
            dpi: diagramsConfig.getOptionalNumber("dpi"),
          };
        }

        const hubOptions: HubOptions = {
          projectDir,
          entity,
          s3,
          linkPrefix,
          diagrams,
          cacheSize,
        };

        const hub = new Hub(hubOptions);

        if (linkPrefix) {
          logger.info(`Using link prefix: ${linkPrefix}`);
        }
        if (s3) {
          logger.info(`Hub: S3 mode (bucket: ${s3.bucket}, cache size: ${cacheSize ?? 20})`);
        } else {
          logger.info(`Hub: local mode (${projectDir}, entity: ${entity})`);
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
