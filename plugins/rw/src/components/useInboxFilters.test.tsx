import type { ReactNode } from "react";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useInboxFilters } from "./useInboxFilters";

function wrapperFor(initialEntry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  };
}

describe("useInboxFilters", () => {
  it("defaults to show=all, sort=newest with no query params", () => {
    const { result } = renderHook(() => useInboxFilters(), { wrapper: wrapperFor("/") });
    expect(result.current.show).toBe("all");
    expect(result.current.sort).toBe("newest");
  });

  it("reads show=unanswered from query params", () => {
    const { result } = renderHook(() => useInboxFilters(), {
      wrapper: wrapperFor("/?show=unanswered"),
    });
    expect(result.current.show).toBe("unanswered");
  });

  it("reads sort=oldest from query params", () => {
    const { result } = renderHook(() => useInboxFilters(), {
      wrapper: wrapperFor("/?sort=oldest"),
    });
    expect(result.current.sort).toBe("oldest");
  });

  it("falls back to defaults for unknown param values", () => {
    const { result } = renderHook(() => useInboxFilters(), {
      wrapper: wrapperFor("/?show=zzz&sort=qqq"),
    });
    expect(result.current.show).toBe("all");
    expect(result.current.sort).toBe("newest");
  });

  it("setShow toggles the filter and clears the param when set back to all", () => {
    const { result } = renderHook(() => useInboxFilters(), { wrapper: wrapperFor("/") });
    act(() => result.current.setShow("unanswered"));
    expect(result.current.show).toBe("unanswered");
    act(() => result.current.setShow("all"));
    expect(result.current.show).toBe("all");
  });

  it("setSort flips the order and clears the param when set back to newest", () => {
    const { result } = renderHook(() => useInboxFilters(), {
      wrapper: wrapperFor("/?sort=oldest"),
    });
    expect(result.current.sort).toBe("oldest");
    act(() => result.current.setSort("newest"));
    expect(result.current.sort).toBe("newest");
  });

  it("setting one of show/sort preserves the other param", () => {
    const { result } = renderHook(() => useInboxFilters(), {
      wrapper: wrapperFor("/?show=unanswered"),
    });
    // Flipping sort must not drop the active show filter (and vice versa).
    act(() => result.current.setSort("oldest"));
    expect(result.current.show).toBe("unanswered");
    expect(result.current.sort).toBe("oldest");
    act(() => result.current.setShow("all"));
    expect(result.current.sort).toBe("oldest");
    expect(result.current.show).toBe("all");
  });
});
