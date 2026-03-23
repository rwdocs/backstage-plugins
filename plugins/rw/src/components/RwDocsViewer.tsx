import { useRef, useEffect, useState, useCallback } from "react";
import { useApi } from "@backstage/core-plugin-api";
import { ErrorPanel } from "@backstage/core-components";
import { useTheme } from "@material-ui/core/styles";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { rwApiRef } from "../api/RwClient";
import { useSectionRefResolver } from "./useSectionRefResolver";
import { mountRw } from "@rwdocs/viewer";
import type { RwInstance } from "@rwdocs/viewer";
import "@rwdocs/viewer/embed.css";

interface RwDocsViewerProps {
  apiBaseUrl: string;
  sectionRef: string;
  sourceEntityRef: string;
}

export function RwDocsViewer({ apiBaseUrl, sectionRef, sourceEntityRef }: RwDocsViewerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const rwApi = useApi(rwApiRef);
  const theme = useTheme();
  const [error, setError] = useState<Error | null>(null);
  const catalogResolver = useSectionRefResolver(sourceEntityRef);

  const location = useLocation();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const { "*": subPath = "" } = useParams();

  const basePath = subPath ? location.pathname.slice(0, -(subPath.length + 1)) : location.pathname;
  const basePathRef = useRef(basePath);
  basePathRef.current = basePath;

  const resolveSectionRefs = useCallback(
    async (refs: string[]): Promise<Record<string, string>> => {
      const otherRefs = refs.filter((r) => r !== sectionRef);
      const result = otherRefs.length > 0 ? await catalogResolver(otherRefs) : {};
      if (refs.includes(sectionRef)) {
        result[sectionRef] = basePathRef.current;
      }
      return result;
    },
    [catalogResolver, sectionRef],
  );

  const instanceRef = useRef<RwInstance | null>(null);
  const prevSubPathRef = useRef(subPath);
  const rwNavigatingRef = useRef(false);

  useEffect(() => {
    if (!ref.current) {
      return undefined;
    }

    try {
      let initialPath = "/";
      if (subPath) {
        initialPath = `/${subPath}`;
      }
      if (location.hash) {
        initialPath += location.hash;
      }

      instanceRef.current = mountRw(ref.current, {
        apiBaseUrl,
        initialPath,
        sectionRef,
        fetchFn: rwApi.getFetch(),
        colorScheme: theme.palette.type,
        resolveSectionRefs,
        onNavigate: (href: string) => {
          if (window.location.pathname !== href) {
            rwNavigatingRef.current = true;
            navigateRef.current(href, { replace: false });
          }
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }

    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl, sectionRef]);

  useEffect(() => {
    instanceRef.current?.setColorScheme(theme.palette.type);
  }, [theme.palette.type]);

  useEffect(() => {
    if (subPath === prevSubPathRef.current) return;
    prevSubPathRef.current = subPath;

    if (rwNavigatingRef.current) {
      rwNavigatingRef.current = false;
      return;
    }

    const rwPath = subPath ? `/${subPath}` : "/";
    instanceRef.current?.navigateTo(rwPath);
  }, [subPath]);

  if (error) {
    return <ErrorPanel error={error} />;
  }

  return <div ref={ref} className="rw-root" />;
}
