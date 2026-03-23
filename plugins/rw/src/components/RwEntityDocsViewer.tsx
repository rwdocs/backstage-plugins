import { useEffect, useMemo, useState } from "react";
import { useApi } from "@backstage/core-plugin-api";
import { useEntity } from "@backstage/plugin-catalog-react";
import { getCompoundEntityRef } from "@backstage/catalog-model";
import { ErrorPanel, Progress } from "@backstage/core-components";
import { rwApiRef } from "../api/RwClient";
import { toEntityPath } from "./entityPath";
import { ANNOTATION_KEY } from "./constants";
import { parseAnnotation } from "./parseAnnotation";
import { RwDocsViewer } from "./RwDocsViewer";

export function RwEntityDocsViewer() {
  const { entity } = useEntity();
  const rwApi = useApi(rwApiRef);
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<Error | null>(null);

  const annotationValue = entity.metadata.annotations?.[ANNOTATION_KEY];
  const selfEntityRef = useMemo(() => toEntityPath(getCompoundEntityRef(entity)), [entity]);
  const parsed = parseAnnotation(annotationValue, selfEntityRef);

  useEffect(() => {
    if (!parsed) return undefined;

    let cancelled = false;
    rwApi
      .getSiteBaseUrl(parsed.entityPath)
      .then((url) => {
        if (!cancelled) setApiBaseUrl(url);
      })
      .catch((err) => {
        if (!cancelled) setFetchError(err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parsed is derived from annotationValue+selfEntityRef; using entityPath avoids object-identity churn
  }, [rwApi, parsed?.entityPath]);

  if (!parsed) {
    return <ErrorPanel error={new Error(`Entity is missing the "${ANNOTATION_KEY}" annotation`)} />;
  }

  if (fetchError) {
    return <ErrorPanel error={fetchError} />;
  }

  if (!apiBaseUrl) {
    return <Progress />;
  }

  const sectionRef = parsed.sectionRef ?? selfEntityRef;
  return (
    <RwDocsViewer
      apiBaseUrl={apiBaseUrl}
      sectionRef={sectionRef}
      sourceEntityRef={parsed.entityRef}
    />
  );
}
