import { createFrontendPlugin, ApiBlueprint } from "@backstage/frontend-plugin-api";
import { createApiFactory, discoveryApiRef, fetchApiRef } from "@backstage/core-plugin-api";
import { EntityContentBlueprint } from "@backstage/plugin-catalog-react/alpha";
import { rwApiRef, RwClient } from "./api/RwClient";
import { ANNOTATION_KEY } from "./components/constants";

const rwApi = ApiBlueprint.make({
  params: (defineParams) =>
    defineParams(
      createApiFactory({
        api: rwApiRef,
        deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
        factory: ({ discoveryApi, fetchApi }) => new RwClient({ discoveryApi, fetchApi }),
      }),
    ),
});

const rwEntityContent = EntityContentBlueprint.make({
  params: {
    path: "docs",
    title: "Documentation",
    group: "documentation",
    filter: (entity) => Boolean(entity.metadata.annotations?.[ANNOTATION_KEY]),
    loader: () => import("./components/RwEntityDocsViewer").then((m) => <m.RwEntityDocsViewer />),
  },
});

export const rwPlugin = createFrontendPlugin({
  pluginId: "rw",
  extensions: [rwApi, rwEntityContent],
});

export default rwPlugin;
