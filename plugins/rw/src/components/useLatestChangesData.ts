import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@backstage/core-plugin-api";
import { rwApiRef } from "../api/RwClient";
import type { LatestChangeItem } from "../api/RwClient";

export interface LatestChangesData {
  hasAnyDated: boolean;
  items: LatestChangeItem[];
  hasMore: boolean;
  loading: boolean; // page-1 fetch in flight
  hasLoaded: boolean; // a first page-1 fetch has resolved at least once
  loadingMore: boolean; // a follow-up page in flight
  error?: Error;
  loadMore: () => void;
}

const PAGE_LIMIT = 50;

export function useLatestChangesData(): LatestChangesData {
  const api = useApi(rwApiRef);

  const [hasAnyDated, setHasAnyDated] = useState(false);
  const [items, setItems] = useState<LatestChangeItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  // Guards a stale in-flight response (e.g. a StrictMode re-mount) from being
  // applied after a newer generation has started. loadMore reads but never
  // increments it — incrementing would discard the page it is extending.
  const genRef = useRef(0);

  // Synchronous in-flight guard for loadMore. The `loadingMore` state only
  // updates on re-render, so two loadMore() calls in the same tick — a fast-scroll
  // IntersectionObserver double-fire — would both pass a state-based guard and
  // fetch (and append) the same page twice. A ref flips synchronously, so the
  // second call bails immediately.
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const gen = ++genRef.current;
    setLoading(true);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setError(undefined);
    api
      .getLatestChanges({ limit: PAGE_LIMIT })
      .then((res) => {
        if (gen !== genRef.current) return;
        setHasAnyDated(res.hasAnyDated);
        setItems(res.items);
        setNextCursor(res.pageInfo.nextCursor);
        setLoading(false);
        setHasLoaded(true);
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [api]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMoreRef.current || loading) return;
    loadingMoreRef.current = true;
    const gen = genRef.current;
    setLoadingMore(true);
    api
      .getLatestChanges({ cursor: nextCursor, limit: PAGE_LIMIT })
      .then((res) => {
        loadingMoreRef.current = false;
        if (gen !== genRef.current) return;
        setItems((prev) => [...prev, ...res.items]);
        setNextCursor(res.pageInfo.nextCursor);
        setLoadingMore(false);
      })
      .catch((err) => {
        loadingMoreRef.current = false;
        if (gen !== genRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoadingMore(false);
      });
  }, [api, nextCursor, loading]);

  return {
    hasAnyDated,
    items,
    hasMore: Boolean(nextCursor),
    loading,
    hasLoaded,
    loadingMore,
    error,
    loadMore,
  };
}
