import DocsIcon from "@material-ui/icons/Description";
import { useRouteRef } from "@backstage/core-plugin-api";
import { entityRouteRef, useEntity } from "@backstage/plugin-catalog-react";
import { ANNOTATION_KEY } from "../components/constants";

export function useRwDocsIconLinkProps() {
  const { entity } = useEntity();
  const entityRoute = useRouteRef(entityRouteRef);

  const hasAnnotation = Boolean(entity.metadata.annotations?.[ANNOTATION_KEY]);
  const kind = entity.kind.toLocaleLowerCase("en-US");
  const namespace = entity.metadata.namespace?.toLocaleLowerCase("en-US") ?? "default";
  const name = entity.metadata.name;

  return {
    label: "View Docs",
    disabled: !hasAnnotation || !entityRoute,
    icon: <DocsIcon />,
    href: entityRoute ? `${entityRoute({ kind, namespace, name })}/docs` : "",
  };
}
