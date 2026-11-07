import { useRef, useEffect, useState, useCallback } from "react";
import { useApi } from "@backstage/core-plugin-api";
import { ErrorPanel } from "@backstage/core-components";
import { CookieAuthRefreshProvider } from "@backstage/plugin-auth-react";
import { useTheme } from "@material-ui/core/styles";
import { useLocation, useNavigate, useResolvedPath } from "react-router-dom";
import { rwApiRef } from "../api/RwClient";
import { useSectionRefResolver } from "./useSectionRefResolver";
import { mountRw } from "@rwdocs/viewer";
import type { RwInstance, CommentApiClient } from "@rwdocs/viewer";
import "@rwdocs/viewer/embed.css";

interface RwDocsViewerProps {
  apiBaseUrl: string;
  sectionRef: string;
  sourceEntityRef: string;
  rootSectionRef: string;
  comments?: CommentApiClient;
}

export function RwDocsViewer(props: RwDocsViewerProps) {
  return (
    <CookieAuthRefreshProvider pluginId="rw">
      <RwDocsViewerInner {...props} />
    </CookieAuthRefreshProvider>
  );
}

function RwDocsViewerInner({
  apiBaseUrl,
  sectionRef,
  sourceEntityRef,
  rootSectionRef,
  comments,
}: RwDocsViewerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const rwApi = useApi(rwApiRef);
  const theme = useTheme();
  const [error, setError] = useState<Error | null>(null);
  const catalogResolver = useSectionRefResolver(sourceEntityRef, rootSectionRef);

  const location = useLocation();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const basePath = useResolvedPath(".").pathname;
  const hostLocation = `${location.pathname}${location.search}${location.hash}`;
  const locationRef = useRef(hostLocation);
  locationRef.current = hostLocation;
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

  useEffect(() => {
    if (!ref.current) {
      return undefined;
    }

    try {
      instanceRef.current = mountRw(ref.current, {
        apiBaseUrl,
        basePath,
        location: locationRef.current,
        sectionRef,
        fetchFn: rwApi.getFetch(),
        colorScheme: theme.palette.type,
        resolveSectionRefs,
        onNavigate: (href: string) => {
          if (locationRef.current !== href) {
            navigateRef.current(href, { replace: false });
          }
        },
        ...(comments ? { comments } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }

    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl, basePath, sectionRef, comments, sourceEntityRef, rootSectionRef]);

  useEffect(() => {
    instanceRef.current?.setColorScheme(theme.palette.type);
  }, [theme.palette.type]);

  useEffect(() => {
    instanceRef.current?.navigateTo(hostLocation);
  }, [hostLocation]);

  if (error) {
    return <ErrorPanel error={error} />;
  }

  return <div ref={ref} className="rw-root" />;
}
