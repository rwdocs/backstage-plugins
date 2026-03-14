import { useEffect, useState } from "react";
import { useApi, configApiRef } from "@backstage/core-plugin-api";
import { parseEntityRef } from "@backstage/catalog-model";
import { ErrorPanel, Progress } from "@backstage/core-components";
import { rwApiRef } from "../api/RwClient";
import { RwDocsViewer } from "./RwDocsViewer";

export function RwStandaloneViewer() {
  const rwApi = useApi(rwApiRef);
  const configApi = useApi(configApiRef);
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const rootEntityRaw = configApi.getOptionalString("rw.rootEntity");

  useEffect(() => {
    if (!rootEntityRaw) {
      setError(new Error("rw.rootEntity must be configured for the standalone /docs page"));
      return undefined;
    }

    let cancelled = false;
    let ref;
    try {
      ref = parseEntityRef(rootEntityRaw);
    } catch (err) {
      setError(err as Error);
      return undefined;
    }
    const entityPath =
      `${ref.kind}/${ref.namespace}/${ref.name}`.toLocaleLowerCase("en-US");

    rwApi
      .getSiteBaseUrl(entityPath)
      .then((url) => {
        if (!cancelled) setApiBaseUrl(url);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [rwApi, rootEntityRaw]);

  if (error) {
    return <ErrorPanel error={error} />;
  }

  if (!apiBaseUrl) {
    return <Progress />;
  }

  return <RwDocsViewer apiBaseUrl={apiBaseUrl} />;
}
