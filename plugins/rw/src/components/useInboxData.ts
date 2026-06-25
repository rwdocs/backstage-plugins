import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@backstage/core-plugin-api";
import { rwApiRef } from "../api/RwClient";
import type { InboxItem } from "../api/RwClient";
import type { ShowFilter, SortOrder } from "./useInboxFilters";

export interface InboxData {
  built: boolean;
  items: InboxItem[];
  openCount: number;
  unansweredCount: number;
  hasMore: boolean;
  loading: boolean; // page-1 fetch in flight (initial load or a filter/sort refetch)
  hasLoaded: boolean; // a first page-1 fetch has resolved at least once
  loadingMore: boolean; // a follow-up page in flight
  error?: Error;
  loadMore: () => void;
}

const PAGE_LIMIT = 50;

export function useInboxData(args: { show: ShowFilter; sort: SortOrder }): InboxData {
  const api = useApi(rwApiRef);
  const filter: "open" | "unanswered" = args.show === "unanswered" ? "unanswered" : "open";
  const { sort } = args;

  const [built, setBuilt] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [unansweredCount, setUnansweredCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  // Distinguishes the first load (nothing to show — render the full-page spinner)
  // from a filter/sort refetch (keep the prior results on screen while the new
  // page loads). Latches true on the first resolved page-1 fetch and never resets.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  // Identifies the current filter/sort generation; a stale in-flight response
  // (from a previous filter/sort) is discarded rather than appended.
  // The effect increments (++genRef.current) on each filter/sort change to
  // invalidate any in-flight page-1 fetch. loadMore reads but must NOT
  // increment: incrementing would discard the page-1 response that loadMore
  // is about to extend.
  const genRef = useRef(0);

  // (Re)load page 1 whenever filter or sort changes.
  useEffect(() => {
    const gen = ++genRef.current;
    setLoading(true);
    // A new generation invalidates any in-flight loadMore: its response will be
    // dropped at the genRef guard before it can clear loadingMore, so reset the
    // flag here or it latches true and dead-ends pagination for the new view.
    setLoadingMore(false);
    setError(undefined);
    api
      .getCommentInbox({ filter, sort, limit: PAGE_LIMIT })
      .then((res) => {
        if (gen !== genRef.current) return;
        setBuilt(res.built);
        setItems(res.items);
        setOpenCount(res.openCount);
        setUnansweredCount(res.unansweredCount);
        setNextCursor(res.pageInfo.nextCursor);
        setLoading(false);
        setHasLoaded(true);
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [api, filter, sort]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore || loading) return;
    const gen = genRef.current;
    setLoadingMore(true);
    api
      .getCommentInbox({ cursor: nextCursor, limit: PAGE_LIMIT })
      .then((res) => {
        if (gen !== genRef.current) return; // filter/sort changed mid-flight
        setItems((prev) => [...prev, ...res.items]);
        setNextCursor(res.pageInfo.nextCursor);
        setLoadingMore(false);
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoadingMore(false);
      });
  }, [api, nextCursor, loadingMore, loading]);

  return {
    built,
    items,
    openCount,
    unansweredCount,
    hasMore: Boolean(nextCursor),
    loading,
    hasLoaded,
    loadingMore,
    error,
    loadMore,
  };
}
