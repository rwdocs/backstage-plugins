import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { TestApiProvider } from "@backstage/test-utils";
import { rwApiRef } from "../api/RwClient";
import type { LatestChangeItem } from "../api/RwClient";
import type { LatestChangesResponse } from "@rwdocs/backstage-plugin-rw-common";
import { useLatestChangesData } from "./useLatestChangesData";

function makeItem(title: string): LatestChangeItem {
  return {
    entityRef: "component:default/o",
    viewerPath: `docs/${title}`,
    title,
    lastModified: new Date().toISOString(),
  };
}

const PAGE1: LatestChangesResponse = {
  hasAnyDated: true,
  items: [makeItem("A"), makeItem("B")],
  pageInfo: { nextCursor: "C1" },
};

const PAGE2: LatestChangesResponse = {
  hasAnyDated: true,
  items: [makeItem("C")],
  pageInfo: {},
};

function createMockApi(
  impl: (query?: { cursor?: string; limit?: number }) => Promise<LatestChangesResponse>,
) {
  return {
    getLatestChanges: jest.fn(impl),
  };
}

function buildWrapper(mockApi: ReturnType<typeof createMockApi>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <TestApiProvider apis={[[rwApiRef, mockApi as any]]}>{children}</TestApiProvider>;
  };
}

describe("useLatestChangesData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads page 1 on mount", async () => {
    const mockApi = createMockApi((query) => Promise.resolve(query?.cursor ? PAGE2 : PAGE1));
    const { result } = renderHook(() => useLatestChangesData(), {
      wrapper: buildWrapper(mockApi),
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.items.map((i) => i.title)).toEqual(["A", "B"]);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.hasAnyDated).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(mockApi.getLatestChanges).toHaveBeenCalledWith({ limit: 50 });
  });

  it("appends the next page via loadMore", async () => {
    const mockApi = createMockApi((query) => Promise.resolve(query?.cursor ? PAGE2 : PAGE1));
    const { result } = renderHook(() => useLatestChangesData(), {
      wrapper: buildWrapper(mockApi),
    });

    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.items.map((i) => i.title)).toEqual(["A", "B", "C"]));
    expect(result.current.hasMore).toBe(false);
    expect(mockApi.getLatestChanges).toHaveBeenCalledWith({ cursor: "C1", limit: 50 });
  });

  it("does not double-fire loadMore when called twice in the same tick", async () => {
    const mockApi = createMockApi((query) => Promise.resolve(query?.cursor ? PAGE2 : PAGE1));
    const { result } = renderHook(() => useLatestChangesData(), {
      wrapper: buildWrapper(mockApi),
    });

    await waitFor(() => expect(result.current.hasMore).toBe(true));

    // Two synchronous calls before a re-render: the state-based `loadingMore`
    // flag hasn't updated yet (a fast-scroll IntersectionObserver double-fire),
    // so only the synchronous ref guard prevents a duplicate fetch + append.
    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.items.map((i) => i.title)).toEqual(["A", "B", "C"]));

    const followUpCalls = mockApi.getLatestChanges.mock.calls.filter(([q]) => q?.cursor === "C1");
    expect(followUpCalls).toHaveLength(1);
  });

  it("surfaces a fetch error", async () => {
    const err = new Error("network failure");
    const mockApi = createMockApi(() => Promise.reject(err));
    const { result } = renderHook(() => useLatestChangesData(), {
      wrapper: buildWrapper(mockApi),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("network failure");
    expect(result.current.items).toEqual([]);
    expect(result.current.hasLoaded).toBe(false);
  });
});
