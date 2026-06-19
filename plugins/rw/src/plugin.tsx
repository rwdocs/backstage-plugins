import { createFrontendPlugin, ApiBlueprint, FrontendPlugin } from "@backstage/frontend-plugin-api";
import { createApiFactory, discoveryApiRef, fetchApiRef } from "@backstage/core-plugin-api";
import {
  EntityContentBlueprint,
  EntityIconLinkBlueprint,
} from "@backstage/plugin-catalog-react/alpha";
import { SearchFilterResultTypeBlueprint } from "@backstage/plugin-search-react/alpha";
import DocsIcon from "@material-ui/icons/Description";
import { rwApiRef, RwClient } from "./api/RwClient";
import { ANNOTATION_KEY } from "./components/constants";
import { useRwDocsIconLinkProps } from "./hooks/useRwDocsIconLinkProps";

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
    title: "Docs",
    group: "documentation",
    filter: (entity) => Boolean(entity.metadata.annotations?.[ANNOTATION_KEY]),
    loader: () => import("./components/RwEntityDocsViewer").then((m) => <m.RwEntityDocsViewer />),
  },
});

const rwEntityIconLink = EntityIconLinkBlueprint.make({
  name: "view-docs",
  params: {
    filter: (entity) => Boolean(entity.metadata.annotations?.[ANNOTATION_KEY]),
    useProps: useRwDocsIconLinkProps,
  },
});

const rwSearchResultType = SearchFilterResultTypeBlueprint.make({
  params: {
    value: "rw",
    name: "Documentation",
    icon: <DocsIcon />,
  },
});

export const rwPlugin: FrontendPlugin = createFrontendPlugin({
  pluginId: "rw",
  extensions: [rwApi, rwEntityContent, rwEntityIconLink, rwSearchResultType],
});

export default rwPlugin;
