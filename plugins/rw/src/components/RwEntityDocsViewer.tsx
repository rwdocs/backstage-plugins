import { useEffect, useState } from "react";
import { useApi } from "@backstage/core-plugin-api";
import { useEntity } from "@backstage/plugin-catalog-react";
import { getCompoundEntityRef } from "@backstage/catalog-model";
import { ErrorPanel, Progress } from "@backstage/core-components";
import { rwApiRef } from "../api/RwClient";
import { toEntityPath } from "./entityPath";
import { parseAnnotation } from "./parseAnnotation";
import { RwDocsViewer } from "./RwDocsViewer";

const ANNOTATION_KEY = "rwdocs.org/ref";

export function RwEntityDocsViewer() {
  const { entity } = useEntity();
  const rwApi = useApi(rwApiRef);
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const annotationValue = entity.metadata.annotations?.[ANNOTATION_KEY];
  const selfEntityRef = toEntityPath(getCompoundEntityRef(entity));
  const parsed = parseAnnotation(annotationValue, selfEntityRef);
  const entityRef = parsed?.entityRef;
  const scope = parsed?.scope;

  useEffect(() => {
    if (!entityRef) {
      setError(new Error(`Entity is missing the "${ANNOTATION_KEY}" annotation`));
      return undefined;
    }

    let cancelled = false;
    rwApi
      .getSiteBaseUrl(entityRef)
      .then((url) => {
        if (!cancelled) setApiBaseUrl(url);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [rwApi, entityRef]);

  if (error) {
    return <ErrorPanel error={error} />;
  }

  if (!apiBaseUrl) {
    return <Progress />;
  }

  return <RwDocsViewer apiBaseUrl={apiBaseUrl} initialScope={scope} />;
}
