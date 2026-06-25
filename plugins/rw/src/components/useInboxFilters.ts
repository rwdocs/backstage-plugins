import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export type ShowFilter = "all" | "unanswered";
export type SortOrder = "newest" | "oldest";

export interface InboxFilters {
  show: ShowFilter;
  sort: SortOrder;
  setShow: (next: ShowFilter) => void;
  setSort: (next: SortOrder) => void;
}

// Unknown / absent values fall back to the default so the canonical clean URL
// carries no param.
function parseShow(value: string | null): ShowFilter {
  return value === "unanswered" ? "unanswered" : "all";
}

function parseSort(value: string | null): SortOrder {
  return value === "oldest" ? "oldest" : "newest";
}

/**
 * URL view-state for the inbox list, persisted in the URL query string so the
 * back-button and refresh restore the owner's filter/sort.
 */
export function useInboxFilters(): InboxFilters {
  const [searchParams, setSearchParams] = useSearchParams();
  const show = parseShow(searchParams.get("show"));
  const sort = parseSort(searchParams.get("sort"));

  const setShow = useCallback(
    (next: ShowFilter) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (next === "all") params.delete("show");
        else params.set("show", next);
        return params;
      });
    },
    [setSearchParams],
  );

  const setSort = useCallback(
    (next: SortOrder) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (next === "newest") params.delete("sort");
        else params.set("sort", next);
        return params;
      });
    },
    [setSearchParams],
  );

  return { show, sort, setShow, setSort };
}
