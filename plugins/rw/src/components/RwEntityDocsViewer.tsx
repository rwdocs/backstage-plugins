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

type SiteSetup =
  | {
      entityPath: string;
      status: "ready";
      apiBaseUrl: string;
      rootSectionRef: string;
      comments?: CommentApiClient;
    }
  | { entityPath: string; status: "error"; error: Error };

export function RwEntityDocsViewer() {
  const { entity } = useEntity();
  const rwApi = useApi(rwApiRef);
  const [setup, setSetup] = useState<SiteSetup>();

  const annotationValue = entity.metadata.annotations?.[ANNOTATION_KEY];
  const selfEntityRef = useMemo(() => toEntityPath(getCompoundEntityRef(entity)), [entity]);
  const parsed = parseAnnotation(annotationValue, selfEntityRef);

  useEffect(() => {
    if (!parsed) return undefined;

    const { entityPath, entityRef } = parsed;
    setSetup(undefined);

    let cancelled = false;
    const optionalComments = (async (): Promise<CommentApiClient | undefined> => {
      try {
        const enabled = await rwApi.getCommentsEnabled();
        if (cancelled) return undefined;
        return enabled ? rwApi.createCommentClient(entityRef) : undefined;
      } catch (err) {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.warn("rw: comments-enabled probe failed; comments disabled for this view", err);
        }
        return undefined;
      }
    })();

    (async () => {
      try {
        const [apiBaseUrl, rootSectionRef, comments] = await Promise.all([
          rwApi.getSiteBaseUrl(entityPath),
          rwApi.getSiteRootSectionRef(entityPath),
          optionalComments,
        ]);

        if (!cancelled)
          setSetup({ entityPath, status: "ready", apiBaseUrl, rootSectionRef, comments });
      } catch (err) {
        if (!cancelled) {
          setSetup({
            entityPath,
            status: "error",
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parsed is derived from annotationValue+selfEntityRef; using entityPath avoids object-identity churn
  }, [rwApi, parsed?.entityPath]);

  if (!parsed) {
    return <ErrorPanel error={new Error(`Entity is missing the "${ANNOTATION_KEY}" annotation`)} />;
  }

  if (!setup || setup.entityPath !== parsed.entityPath) {
    return <Progress />;
  }

  if (setup.status === "error") {
    return <ErrorPanel error={setup.error} />;
  }

  const sectionRef = parsed.sectionRef ?? setup.rootSectionRef;
  return (
    <RwDocsViewer
      apiBaseUrl={setup.apiBaseUrl}
      sectionRef={sectionRef}
      rootSectionRef={setup.rootSectionRef}
      sourceEntityRef={parsed.entityRef}
      comments={setup.comments}
    />
  );
}
