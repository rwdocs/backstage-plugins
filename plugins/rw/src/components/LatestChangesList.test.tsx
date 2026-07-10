import { fireEvent, screen } from "@testing-library/react";
import { renderInTestApp } from "@backstage/test-utils";
import { LatestChangesList } from "./LatestChangesList";
import type { LatestChangeItem } from "../api/RwClient";
import type { LatestChangesData } from "./useLatestChangesData";

// ---------------------------------------------------------------------------
// Global stubs — jsdom has no IntersectionObserver.
// ---------------------------------------------------------------------------
type IoCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
let capturedIoCallback: IoCallback | undefined;

beforeAll(() => {
  // @ts-expect-error jsdom has no IntersectionObserver
  global.IntersectionObserver = class {
    constructor(cb: IoCallback) {
      capturedIoCallback = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
});

// ---------------------------------------------------------------------------
// Catalog-react / core-plugin-api mocks (mirrors CommentInboxList.test.tsx).
// ---------------------------------------------------------------------------
const mockEntityRoute = jest.fn(
  ({ kind, namespace, name }: { kind: string; namespace: string; name: string }) =>
    `/catalog/${namespace}/${kind}/${name}`,
);

const mockPresentation: Record<string, string> = {
  "component:default/payments": "payments",
  "domain:default/billing": "billing",
};

jest.mock("@backstage/plugin-catalog-react", () => ({
  ...jest.requireActual("@backstage/plugin-catalog-react"),
  entityRouteRef: { id: "mock-entity-route-ref" },
  useEntityPresentation: (ref: string) => ({
    primaryTitle: mockPresentation[ref] ?? ref.split("/").pop() ?? ref,
  }),
}));

jest.mock("@backstage/core-plugin-api", () => ({
  ...jest.requireActual("@backstage/core-plugin-api"),
  useRouteRef: () => mockEntityRoute,
}));

// ---------------------------------------------------------------------------
// Data-layer mock — useLatestChangesData is mocked so tests don't need a live
// rwApiRef; the mock reads the global `mockLatestChangesData` set per test.
// ---------------------------------------------------------------------------
let mockLatestChangesData: LatestChangesData = {
  hasAnyDated: true,
  items: [],
  hasMore: false,
  loading: false,
  hasLoaded: true,
  loadingMore: false,
  error: undefined,
  loadMore: jest.fn(),
};

jest.mock("./useLatestChangesData", () => ({
  useLatestChangesData: () => mockLatestChangesData,
}));

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function makeItem(overrides?: Partial<LatestChangeItem>): LatestChangeItem {
  return {
    entityRef: "component:default/payments",
    viewerPath: "docs/deploy-runbook",
    title: "Deploy runbook",
    lastModified: new Date(Date.now() - 60000).toISOString(),
    ...overrides,
  };
}

function renderList(
  items: LatestChangeItem[],
  opts?: {
    hasAnyDated?: boolean;
    hasMore?: boolean;
    loadMore?: jest.Mock;
    loadingMore?: boolean;
    loading?: boolean;
    hasLoaded?: boolean;
    error?: Error;
  },
) {
  mockLatestChangesData = {
    hasAnyDated: opts?.hasAnyDated ?? true,
    items,
    hasMore: opts?.hasMore ?? false,
    loading: opts?.loading ?? false,
    hasLoaded: opts?.hasLoaded ?? true,
    loadingMore: opts?.loadingMore ?? false,
    error: opts?.error,
    loadMore: opts?.loadMore ?? jest.fn(),
  };

  return renderInTestApp(<LatestChangesList />);
}

describe("LatestChangesList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders bucketed page titles once loaded", async () => {
    await renderList([makeItem({ title: "Deploy runbook" })], { hasAnyDated: true });
    expect(screen.getByText("Deploy runbook")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
  });

  it("shows the still-indexing empty state when nothing is dated yet", async () => {
    await renderList([], { hasAnyDated: false });
    expect(screen.getByText(/indexing/i)).toBeInTheDocument();
  });

  it("shows the no-changes empty state when dated but empty", async () => {
    await renderList([], { hasAnyDated: true });
    expect(screen.getByText(/no recent changes/i)).toBeInTheDocument();
  });

  it("shows the full-page spinner on the very first load (loading, never loaded)", async () => {
    await renderList([], { loading: true, hasLoaded: false });
    expect(screen.getByTestId("progress")).toBeInTheDocument();
  });

  it("shows an error panel when the fetch failed", async () => {
    await renderList([], { error: new Error("boom") });
    expect(screen.getAllByText(/boom/).length).toBeGreaterThan(0);
  });

  it("links a row to the entity's Documentation tab at that page, with no comment suffix", async () => {
    await renderList([
      makeItem({
        entityRef: "component:default/payments",
        viewerPath: "guides/deploy-runbook",
        title: "Deploy runbook",
      }),
    ]);
    const link = screen.getByRole("link", { name: "Deploy runbook" });
    // The `/docs` segment is the entity's Documentation content-tab; the viewer
    // path follows it. Missing `/docs` would land on a non-existent entity route.
    expect(link.getAttribute("href")).toBe(
      "/catalog/default/component/payments/docs/guides/deploy-runbook",
    );
    expect(link.getAttribute("href")).not.toMatch(/#comment-/);
  });

  it("links to the section-root doc page (bare /docs) when viewerPath is empty", async () => {
    await renderList([
      makeItem({ entityRef: "domain:default/billing", viewerPath: "", title: "Billing overview" }),
    ]);
    const link = screen.getByRole("link", { name: "Billing overview" });
    expect(link.getAttribute("href")).toBe("/catalog/default/domain/billing/docs");
  });

  it("shows the resolved entity title and a relative time with an absolute-time tooltip", async () => {
    await renderList([
      makeItem({
        entityRef: "component:default/payments",
        lastModified: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      }),
    ]);
    expect(screen.getByText("payments")).toBeInTheDocument();
    const time = screen.getByText("2m ago");
    expect(time).toBeInTheDocument();
    expect(time.getAttribute("title")).toMatch(/2026/);
  });

  it("renders date-bucket headers across a multi-age list", async () => {
    const noonDaysAgo = (n: number) => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - n);
      return d.toISOString();
    };
    await renderList([
      makeItem({ title: "today doc", lastModified: noonDaysAgo(0) }),
      makeItem({ title: "yesterday doc", lastModified: noonDaysAgo(1) }),
      makeItem({ title: "week doc", lastModified: noonDaysAgo(3) }),
      makeItem({ title: "old doc", lastModified: noonDaysAgo(10) }),
    ]);
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Yesterday" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Previous 7 days" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Earlier" })).toBeInTheDocument();
  });

  describe("footer + pagination", () => {
    it("shows no Load more button and no sentinel when hasMore is false", async () => {
      await renderList([makeItem()], { hasMore: false });
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });

    it("shows a Load more button when hasMore is true", async () => {
      await renderList([makeItem()], { hasMore: true });
      expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    });

    it("calls loadMore when the Load more button is pressed", async () => {
      const loadMore = jest.fn();
      await renderList([makeItem()], { hasMore: true, loadMore });
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
      expect(loadMore).toHaveBeenCalledTimes(1);
    });

    it("shows 'Loading…' and disables the button when loadingMore is true", async () => {
      await renderList([makeItem()], { hasMore: true, loadingMore: true });
      const btn = screen.getByRole("button", { name: "Loading…" });
      expect(btn).toBeInTheDocument();
      expect(btn).toBeDisabled();
    });

    it("does not show a total count in the footer (no total for this feed)", async () => {
      await renderList([makeItem()], { hasMore: true });
      expect(screen.queryByText(/of \d+/)).not.toBeInTheDocument();
      expect(screen.queryByText(/shown/)).not.toBeInTheDocument();
    });

    it("auto-loads more when the IntersectionObserver sentinel intersects", async () => {
      const loadMore = jest.fn();
      capturedIoCallback = undefined;
      await renderList([makeItem()], { hasMore: true, loadMore });
      expect(capturedIoCallback).toBeDefined();

      capturedIoCallback!([{ isIntersecting: true }]);

      expect(loadMore).toHaveBeenCalledTimes(1);
    });
  });
});
