import { useEffect, useMemo, useState } from "react";
import { useApi, configApiRef } from "@backstage/core-plugin-api";
import { ErrorPanel, Progress } from "@backstage/core-components";
import { rwApiRef } from "../api/RwClient";
import { toEntityPath } from "./entityPath";
import { RwDocsViewer } from "./RwDocsViewer";

export function RwStandaloneViewer() {
  const rwApi = useApi(rwApiRef);
  const configApi = useApi(configApiRef);
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<Error | null>(null);

  const rootEntityRaw = configApi.getOptionalString("rw.rootEntity");
  const rootSectionRefRaw = configApi.getOptionalString("rw.rootSectionRef");

  const { entityPath, sectionRef, configError } = useMemo(() => {
    if (!rootEntityRaw) {
      return {
        entityPath: undefined,
        sectionRef: undefined,
        configError: new Error("rw.rootEntity must be configured for the standalone /docs page"),
      };
    }
    try {
      const ep = toEntityPath(rootEntityRaw);
      return {
        entityPath: ep,
        sectionRef: rootSectionRefRaw ?? rootEntityRaw,
        configError: undefined,
      };
    } catch (err) {
      return { entityPath: undefined, sectionRef: undefined, configError: err as Error };
    }
  }, [rootEntityRaw, rootSectionRefRaw]);

  useEffect(() => {
    if (!entityPath) return undefined;

    let cancelled = false;
    rwApi
      .getSiteBaseUrl(entityPath)
      .then((url) => {
        if (!cancelled) setApiBaseUrl(url);
      })
      .catch((err) => {
        if (!cancelled) setFetchError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [rwApi, entityPath]);

  const error = configError ?? fetchError;
  if (error) {
    return <ErrorPanel error={error} />;
  }

  if (!apiBaseUrl || !sectionRef) {
    return <Progress />;
  }

  return (
    <RwDocsViewer
      apiBaseUrl={apiBaseUrl}
      sectionRef={sectionRef}
      sourceEntityRef={rootEntityRaw!}
    />
  );
}
