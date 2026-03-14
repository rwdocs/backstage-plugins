import { useEffect, useState } from "react";
import { useApi } from "@backstage/core-plugin-api";
import { useEntity } from "@backstage/plugin-catalog-react";
import { ErrorPanel, Progress } from "@backstage/core-components";
import { rwApiRef } from "../api/RwClient";
import { parseAnnotation } from "./parseAnnotation";
import { RwDocsViewer } from "./RwDocsViewer";

const ANNOTATION_KEY = "rwdocs.org/ref";

export function RwEntityDocsViewer() {
  const { entity } = useEntity();
  const rwApi = useApi(rwApiRef);
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const annotationValue = entity.metadata.annotations?.[ANNOTATION_KEY];
  const selfEntityRef =
    `${entity.metadata.namespace ?? "default"}/${entity.kind}/${entity.metadata.name}`.toLowerCase();
  const parsed = parseAnnotation(annotationValue, selfEntityRef);

  useEffect(() => {
    if (!parsed) {
      setError(new Error(`Entity is missing the "${ANNOTATION_KEY}" annotation`));
      return;
    }

    rwApi
      .getSiteBaseUrl(parsed.entityRef)
      .then(setApiBaseUrl)
      .catch(setError);
  }, [rwApi, parsed?.entityRef]);

  if (error) {
    return <ErrorPanel error={error} />;
  }

  if (!apiBaseUrl) {
    return <Progress />;
  }

  return <RwDocsViewer apiBaseUrl={apiBaseUrl} initialScope={parsed?.scope} />;
}
