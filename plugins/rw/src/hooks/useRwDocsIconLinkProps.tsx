import DocsIcon from "@material-ui/icons/Description";
import { useRouteRef } from "@backstage/core-plugin-api";
import { entityRouteRef, useEntity } from "@backstage/plugin-catalog-react";
import { entityDocsPath } from "../components/constants";

const docsIcon = <DocsIcon />;

export function useRwDocsIconLinkProps() {
  const { entity } = useEntity();
  const entityRoute = useRouteRef(entityRouteRef);

  return {
    label: "View Docs",
    disabled: !entityRoute,
    icon: docsIcon,
    href: entityRoute ? entityDocsPath(entityRoute, entity) : "",
  };
}
