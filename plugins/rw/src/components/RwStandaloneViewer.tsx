import { useEffect, useMemo, useState } from "react";
import { useApi, configApiRef } from "@backstage/core-plugin-api";
import { parseEntityRef } from "@backstage/catalog-model";
import { ErrorPanel, Progress } from "@backstage/core-components";
import { rwApiRef } from "../api/RwClient";
import { RwDocsViewer } from "./RwDocsViewer";

export function RwStandaloneViewer() {
  const rwApi = useApi(rwApiRef);
  const configApi = useApi(configApiRef);
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<Error | null>(null);

  const rootEntityRaw = configApi.getOptionalString("rw.rootEntity");

  const { entityPath, configError } = useMemo(() => {
    if (!rootEntityRaw) {
      return {
        entityPath: undefined,
        configError: new Error("rw.rootEntity must be configured for the standalone /docs page"),
      };
    }
    try {
      const ref = parseEntityRef(rootEntityRaw);
      return {
        entityPath: `${ref.kind}/${ref.namespace}/${ref.name}`.toLocaleLowerCase("en-US"),
        configError: undefined,
      };
    } catch (err) {
      return { entityPath: undefined, configError: err as Error };
    }
  }, [rootEntityRaw]);

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

  if (!apiBaseUrl) {
    return <Progress />;
  }

  return <RwDocsViewer apiBaseUrl={apiBaseUrl} />;
}
