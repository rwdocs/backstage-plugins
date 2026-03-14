import { useEffect, useState } from "react";
import { useApi, configApiRef } from "@backstage/core-plugin-api";
import { ErrorPanel, Progress } from "@backstage/core-components";
import { rwApiRef } from "../api/RwClient";
import { RwDocsViewer } from "./RwDocsViewer";

export function RwStandaloneViewer() {
  const rwApi = useApi(rwApiRef);
  const configApi = useApi(configApiRef);
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const rootEntity = configApi.getOptionalString("rw.rootEntity");

  useEffect(() => {
    if (!rootEntity) {
      setError(new Error("rw.rootEntity must be configured for the standalone /docs page"));
      return;
    }

    let cancelled = false;
    rwApi
      .getSiteBaseUrl(rootEntity)
      .then((url) => {
        if (!cancelled) setApiBaseUrl(url);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [rwApi, rootEntity]);

  if (error) {
    return <ErrorPanel error={error} />;
  }

  if (!apiBaseUrl) {
    return <Progress />;
  }

  return <RwDocsViewer apiBaseUrl={apiBaseUrl} />;
}
