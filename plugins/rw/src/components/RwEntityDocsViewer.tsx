import { useEffect, useMemo, useState } from "react";
import { useApi } from "@backstage/core-plugin-api";
import { useEntity } from "@backstage/plugin-catalog-react";
import { getCompoundEntityRef } from "@backstage/catalog-model";
import { ErrorPanel, Progress } from "@backstage/core-components";
import { toEntityPath, parseAnnotation } from "@rwdocs/backstage-plugin-rw-common";
import { rwApiRef } from "../api/RwClient";
import { ANNOTATION_KEY } from "./constants";
import { RwDocsViewer } from "./RwDocsViewer";
import type { CommentApiClient } from "@rwdocs/viewer";

export function RwEntityDocsViewer() {
  const { entity } = useEntity();
  const rwApi = useApi(rwApiRef);
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<Error | null>(null);
  const [commentClient, setCommentClient] = useState<CommentApiClient | undefined>(undefined);
  // Two gates before the viewer mounts: apiBaseUrl resolves first, then we wait
  // for the comments-enabled check so the viewer never mounts and immediately
  // remounts with a different comments prop.
  const [commentsReady, setCommentsReady] = useState(false);

  const annotationValue = entity.metadata.annotations?.[ANNOTATION_KEY];
  const selfEntityRef = useMemo(() => toEntityPath(getCompoundEntityRef(entity)), [entity]);
  const parsed = parseAnnotation(annotationValue, selfEntityRef);

  useEffect(() => {
    if (!parsed) return undefined;

    // Reset gate immediately so the viewer unmounts while we fetch the new entity's data.
    setApiBaseUrl(null);
    setFetchError(null);
    setCommentsReady(false);
    setCommentClient(undefined);

    let cancelled = false;
    (async () => {
      try {
        const url = await rwApi.getSiteBaseUrl(parsed.entityPath);
        if (cancelled) return;
        setApiBaseUrl(url);
      } catch (err) {
        if (!cancelled) setFetchError(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      try {
        const enabled = await rwApi.getCommentsEnabled();
        if (cancelled) return;
        setCommentClient(enabled ? rwApi.createCommentClient(parsed.entityRef) : undefined);
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn("rw: comments-enabled probe failed; comments disabled for this view", err);
        setCommentClient(undefined);
      }

      if (!cancelled) setCommentsReady(true);
    })();
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

  if (!apiBaseUrl || !commentsReady) {
    return <Progress />;
  }

  const sectionRef = parsed.sectionRef ?? selfEntityRef;
  return (
    <RwDocsViewer
      apiBaseUrl={apiBaseUrl}
      sectionRef={sectionRef}
      sourceEntityRef={parsed.entityRef}
      comments={commentClient}
    />
  );
}
