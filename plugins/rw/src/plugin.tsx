import {
  createFrontendPlugin,
  ApiBlueprint,
  FrontendPlugin,
  PageBlueprint,
  SubPageBlueprint,
  createRouteRef,
} from "@backstage/frontend-plugin-api";
import { createApiFactory, discoveryApiRef, fetchApiRef } from "@backstage/core-plugin-api";
import {
  EntityContentBlueprint,
  EntityIconLinkBlueprint,
} from "@backstage/plugin-catalog-react/alpha";
import { SearchFilterResultTypeBlueprint } from "@backstage/plugin-search-react/alpha";
import DocsIcon from "@material-ui/icons/Description";
import LibraryBooksIcon from "@material-ui/icons/LibraryBooks";
import { rwApiRef, RwClient } from "./api/RwClient";
import { ANNOTATION_KEY } from "./components/constants";
import { useRwDocsIconLinkProps } from "./hooks/useRwDocsIconLinkProps";

// Route ref for the parent "Docs" page. The sidebar nav item is auto-discovered
// from this page's title/icon/routeRef — NavItemBlueprint was removed in
// @backstage/frontend-plugin-api 0.17.0 — so no explicit nav extension is needed.
export const docsRouteRef = createRouteRef();

// Route ref for the Comments tab (/docs/comments). Carried over from the former
// standalone page so the ref stays resolvable at its new, nested location.
export const commentInboxRouteRef = createRouteRef();

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

// Parent "Docs" page. With no loader and at least one attached sub-page, the
// framework renders the plugin header (icon + title) with a tab strip built from
// the sub-pages, and redirects the bare path to the first tab.
//
// `path` defaults to /docs and is overridable per Backstage instance through
// app-config (no custom schema) — e.g. to avoid TechDocs, which also defaults to
// /docs:
//
//   app:
//     extensions:
//       - page:rw/docs:
//           config:
//             path: /rwdocs
const rwDocsPage = PageBlueprint.make({
  name: "docs",
  params: {
    path: "/docs",
    title: "Docs",
    icon: <LibraryBooksIcon />,
    routeRef: docsRouteRef,
  },
});

// The "Comments" tab — renders the doc-comment inbox at /docs/comments. Attached
// explicitly to the Docs page's `pages` input by id. SubPageBlueprint's default
// attachTo is { relative: { kind: "page" }, input: "pages" }, which resolves to
// the un-named id "page:rw" — but the Docs page is named, so its id is
// "page:rw/docs", which the default never matches. Hence the explicit page id.
const rwCommentsSubPage = SubPageBlueprint.make({
  name: "comments",
  attachTo: { id: "page:rw/docs", input: "pages" },
  params: {
    path: "comments",
    title: "Comments",
    routeRef: commentInboxRouteRef,
    loader: () => import("./components/CommentInboxPage").then((m) => <m.CommentInboxPage />),
  },
});

export const rwPlugin: FrontendPlugin = createFrontendPlugin({
  pluginId: "rw",
  extensions: [
    rwApi,
    rwEntityContent,
    rwEntityIconLink,
    rwSearchResultType,
    rwDocsPage,
    rwCommentsSubPage,
  ],
});

export default rwPlugin;
