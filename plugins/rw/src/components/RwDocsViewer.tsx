import { useRef, useEffect, useState } from "react";
import { useApi } from "@backstage/core-plugin-api";
import { ErrorPanel } from "@backstage/core-components";
import { useTheme } from "@material-ui/core/styles";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { rwApiRef } from "../api/RwClient";
import { mountRw } from "@rwdocs/viewer";
import type { RwInstance } from "@rwdocs/viewer";
import "@rwdocs/viewer/embed.css";

interface RwDocsViewerProps {
  apiBaseUrl: string;
  initialScope?: string;
}

export function RwDocsViewer({ apiBaseUrl, initialScope }: RwDocsViewerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const rwApi = useApi(rwApiRef);
  const theme = useTheme();
  const [error, setError] = useState<Error | null>(null);

  const location = useLocation();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const { "*": subPath = "" } = useParams();

  const basePath = subPath ? location.pathname.slice(0, -(subPath.length + 1)) : location.pathname;
  const basePathRef = useRef(basePath);
  basePathRef.current = basePath;

  const instanceRef = useRef<RwInstance | null>(null);
  const prevSubPathRef = useRef(subPath);
  const rwNavigatingRef = useRef(false);

  useEffect(() => {
    if (!ref.current) {
      return undefined;
    }

    try {
      const base = basePathRef.current;
      let initialPath = "/";
      if (initialScope) {
        initialPath = `/${initialScope}`;
      } else if (subPath) {
        initialPath = `/${subPath}`;
      }

      instanceRef.current = mountRw(ref.current, {
        apiBaseUrl,
        initialPath,
        basePath: base,
        fetchFn: rwApi.getFetch(),
        colorScheme: theme.palette.type,
        onNavigate: (rwPath: string) => {
          const browserPath = rwPath === "/" ? base : `${base}${rwPath}`;
          if (window.location.pathname !== browserPath) {
            rwNavigatingRef.current = true;
            navigateRef.current(browserPath, { replace: false });
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
  }, [apiBaseUrl]);

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

  return <div ref={ref} className="rw-root" style={{ height: "100vh" }} />;
}
