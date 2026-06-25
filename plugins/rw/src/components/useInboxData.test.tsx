import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { TestApiProvider } from "@backstage/test-utils";
import { rwApiRef } from "../api/RwClient";
import type { InboxItem } from "../api/RwClient";
import type { InboxResponse } from "@rwdocs/backstage-plugin-rw-common";
import { useInboxData } from "./useInboxData";
import type { InboxData } from "./useInboxData";
import type { ShowFilter } from "./useInboxFilters";

function makeItem(commentId: string): InboxItem {
  return {
    commentId,
    siteRef: "component:default/docs",
    documentId: "doc-1",
    entityRef: "component:default/docs",
    viewerPath: "guide",
    documentTitle: "Guide",
    author: { id: "user:default/alice", name: "Alice Anderson" },
    bodySnippet: `snippet ${commentId}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    replyCount: 0,
  };
}

const PAGE1: InboxResponse = {
  built: true,
  items: [makeItem("a"), makeItem("b")],
  pageInfo: { nextCursor: "C1" },
  openCount: 3,
  unansweredCount: 1,
};

const PAGE2: InboxResponse = {
  built: true,
  items: [makeItem("c")],
  pageInfo: {},
  openCount: 3,
  unansweredCount: 1,
};

function createMockApi(
  impl: (query?: {
    filter?: string;
    sort?: string;
    cursor?: string;
    limit?: number;
  }) => Promise<InboxResponse>,
) {
  return {
    getCommentInbox: jest.fn(impl),
  };
}

function buildWrapper(mockApi: ReturnType<typeof createMockApi>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <TestApiProvider apis={[[rwApiRef, mockApi as any]]}>{children}</TestApiProvider>;
  };
}

describe("useInboxData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads the first page on mount", async () => {
    const mockApi = createMockApi((query) => Promise.resolve(query?.cursor ? PAGE2 : PAGE1));
    const { result } = renderHook(() => useInboxData({ show: "all", sort: "newest" }), {
      wrapper: buildWrapper(mockApi),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items.map((i) => i.commentId)).toEqual(["a", "b"]);
    expect(result.current.openCount).toBe(3);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.error).toBeUndefined();
    expect(result.current.built).toBe(true);
  });

  it("appends the next page on loadMore", async () => {
    const mockApi = createMockApi((query) => Promise.resolve(query?.cursor ? PAGE2 : PAGE1));
    const { result } = renderHook(() => useInboxData({ show: "all", sort: "newest" }), {
      wrapper: buildWrapper(mockApi),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(result.current.items.map((i) => i.commentId)).toEqual(["a", "b", "c"]);
  });

  it("maps show=unanswered to filter=unanswered and resets on change", async () => {
    const mockApi = createMockApi(() => Promise.resolve(PAGE1));
    const { result, rerender } = renderHook<InboxData, { show: ShowFilter }>(
      ({ show }: { show: ShowFilter }) => useInboxData({ show, sort: "newest" }),
      {
        wrapper: buildWrapper(mockApi),
        initialProps: { show: "all" },
      },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Reset mock call tracking after initial load
    mockApi.getCommentInbox.mockClear();

    // Switch to unanswered
    rerender({ show: "unanswered" });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should have called with filter: "unanswered"
    expect(mockApi.getCommentInbox).toHaveBeenCalledWith(
      expect.objectContaining({ filter: "unanswered" }),
    );

    // Items should be page 1's items (reset, not appended)
    expect(result.current.items.map((i) => i.commentId)).toEqual(["a", "b"]);
  });

  it("discards a stale page-1 response when the filter changes before it resolves", async () => {
    // The genRef safety invariant: a stale in-flight response (from a prior filter/sort)
    // must not overwrite the items loaded by a subsequent effect.
    let resolveFirst!: (value: InboxResponse) => void;
    const firstHangs = new Promise<InboxResponse>((resolve) => {
      resolveFirst = resolve;
    });
    const PAGE_UNANSWERED: InboxResponse = {
      built: true,
      items: [makeItem("u1")],
      pageInfo: {},
      openCount: 1,
      unansweredCount: 1,
    };

    let callCount = 0;
    const mockApi = createMockApi(() => {
      callCount++;
      if (callCount === 1) return firstHangs; // first call hangs
      return Promise.resolve(PAGE_UNANSWERED); // second call resolves immediately
    });

    const { result, rerender } = renderHook<InboxData, { show: ShowFilter }>(
      ({ show }: { show: ShowFilter }) => useInboxData({ show, sort: "newest" }),
      { wrapper: buildWrapper(mockApi), initialProps: { show: "all" } },
    );

    // Rerender with a changed filter — triggers a new effect with incremented genRef
    rerender({ show: "unanswered" });

    // Wait for the second (unanswered) fetch to resolve
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Now resolve the stale first fetch
    resolveFirst(PAGE1);

    // Items must reflect the second fetch (u1), not PAGE1's items (a, b)
    await waitFor(() => expect(result.current.items.map((i) => i.commentId)).toEqual(["u1"]));
    expect(result.current.items.map((i) => i.commentId)).not.toContain("a");
    expect(result.current.items.map((i) => i.commentId)).not.toContain("b");
  });

  it("clears loadingMore when a filter change supersedes an in-flight loadMore", async () => {
    // Regression: loadMore's response, when superseded by a filter/sort change,
    // returned at the genRef guard before setLoadingMore(false) and the page-1
    // effect never reset it — so loadingMore latched true forever, dead-ending
    // all further pagination (loadMore's own guard short-circuits on it).
    let resolveLoadMore!: (value: InboxResponse) => void;
    const loadMoreHangs = new Promise<InboxResponse>((resolve) => {
      resolveLoadMore = resolve;
    });
    const PAGE_UNANSWERED: InboxResponse = {
      built: true,
      items: [makeItem("u1")],
      pageInfo: { nextCursor: "U1" },
      openCount: 1,
      unansweredCount: 1,
    };

    const mockApi = createMockApi((query) => {
      if (query?.cursor) return loadMoreHangs; // the loadMore page hangs
      if (query?.filter === "unanswered") return Promise.resolve(PAGE_UNANSWERED);
      return Promise.resolve(PAGE1); // initial open page 1
    });

    const { result, rerender } = renderHook<InboxData, { show: ShowFilter }>(
      ({ show }: { show: ShowFilter }) => useInboxData({ show, sort: "newest" }),
      { wrapper: buildWrapper(mockApi), initialProps: { show: "all" } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Start a loadMore (its page hangs), then change the filter mid-flight.
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(true));

    rerender({ show: "unanswered" });
    await waitFor(() => expect(result.current.items.map((i) => i.commentId)).toEqual(["u1"]));

    // The new view must not inherit the superseded loadMore's in-flight flag.
    expect(result.current.loadingMore).toBe(false);

    // Resolving the now-stale loadMore must not flip it back on.
    await act(async () => {
      resolveLoadMore(PAGE2);
      await loadMoreHangs;
    });
    expect(result.current.loadingMore).toBe(false);
  });

  it("surfaces a fetch error", async () => {
    const err = new Error("network failure");
    const mockApi = createMockApi(() => Promise.reject(err));
    const { result } = renderHook(() => useInboxData({ show: "all", sort: "newest" }), {
      wrapper: buildWrapper(mockApi),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("network failure");
    expect(result.current.items).toEqual([]);
  });
});
