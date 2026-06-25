import { fireEvent, screen } from "@testing-library/react";
import { renderInTestApp } from "@backstage/test-utils";
import { CommentInboxList } from "./CommentInboxList";
import type { InboxItem } from "../api/RwClient";
import type { InboxData } from "./useInboxData";

// ---------------------------------------------------------------------------
// Global stubs — jsdom has no IntersectionObserver.
// ---------------------------------------------------------------------------
beforeAll(() => {
  // @ts-expect-error jsdom has no IntersectionObserver
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
});

// ---------------------------------------------------------------------------
// Catalog-react / core-plugin-api mocks (unchanged from prior test suite).
// ---------------------------------------------------------------------------
const mockEntityRoute = jest.fn(
  ({ kind, namespace, name }: { kind: string; namespace: string; name: string }) =>
    `/catalog/${namespace}/${kind}/${name}`,
);

// Human titles the (mocked) presentation API resolves refs to. Mirrors how the
// real useEntityPresentation humanizes an entity ref (display name / metadata
// title, or a humanized fallback for refs with no catalog entity like a guest).
const mockPresentation: Record<string, string> = {
  "user:default/alice": "Alice Anderson",
  // A ref with no catalog entity humanizes to "namespace/name" for non-default
  // namespaces (Backstage's humanizeEntityRef) — verified live for the dev guest.
  "user:development/guest": "development/guest",
  "domain:default/billing": "billing",
  "component:default/payments": "payments",
  // A non-default-namespace entity renders as "namespace/name" (same rule as the
  // guest author above); an entity with a metadata.title would resolve to that
  // title instead — both come straight from primaryTitle, which we render verbatim.
  "system:payments/gateway": "payments/gateway",
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
// Data-layer mocks.
// ---------------------------------------------------------------------------

// useInboxFilters: the real implementation reads from URL search params, which
// renderInTestApp supports via routeEntries. We use the real hook so that
// ?show=unanswered and ?sort=oldest keep working exactly as before.
// No mock needed for useInboxFilters.

// useInboxData: mocked so tests don't need a live rwApiRef. The mock reads the
// global `mockInboxData` object set by each test (or the renderList helper).
let mockInboxData: InboxData = {
  built: true,
  items: [],
  openCount: 0,
  unansweredCount: 0,
  hasMore: false,
  loading: false,
  hasLoaded: true,
  loadingMore: false,
  error: undefined,
  loadMore: jest.fn(),
};

jest.mock("./useInboxData", () => ({
  useInboxData: () => mockInboxData,
}));

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function makeItem(overrides?: Partial<InboxItem>): InboxItem {
  return {
    commentId: "c1",
    siteRef: "component:default/billing",
    documentId: "doc-1",
    entityRef: "domain:default/billing",
    viewerPath: "usage/guide",
    documentTitle: "Usage Guide",
    author: { id: "user:default/alice", name: "Alice Anderson" },
    bodySnippet: "Great point here",
    createdAt: new Date(Date.now() - 60000).toISOString(),
    updatedAt: new Date(Date.now() - 60000).toISOString(),
    replyCount: 2,
    ...overrides,
  };
}

const daysAgoIso = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

/**
 * Renders `<CommentInboxList />` (no props) with a mocked `useInboxData` that
 * returns the supplied items. `show`/`sort` are driven by URL (routeEntries) as
 * before — but because the server does the filtering in the new architecture,
 * the mock returns items as-is (pre-filtered) rather than having the component
 * do client-side filtering. Tests that check filter/sort behaviour set the items
 * to the already-filtered set and pass the corresponding routeEntries.
 */
function renderList(
  items: InboxItem[],
  opts?: {
    built?: boolean;
    routeEntries?: string[];
    unansweredCount?: number;
    openCount?: number;
    hasMore?: boolean;
    loadMore?: jest.Mock;
    loadingMore?: boolean;
    loading?: boolean;
    hasLoaded?: boolean;
  },
) {
  const built = opts?.built ?? true;
  const openCount = opts?.openCount ?? items.length;
  const unansweredCount = opts?.unansweredCount ?? items.filter((i) => i.replyCount <= 0).length;

  mockInboxData = {
    built,
    items,
    openCount,
    unansweredCount,
    hasMore: opts?.hasMore ?? false,
    loading: opts?.loading ?? false,
    hasLoaded: opts?.hasLoaded ?? true,
    loadingMore: opts?.loadingMore ?? false,
    error: undefined,
    loadMore: opts?.loadMore ?? jest.fn(),
  };

  return renderInTestApp(
    <CommentInboxList />,
    opts?.routeEntries ? { routeEntries: opts.routeEntries } : undefined,
  );
}

// Comment IDs of the rendered rows, in DOM order (from each row's deep-link href).
function renderedCommentOrder(): string[] {
  return screen
    .queryAllByRole("link")
    .map((l) => l.getAttribute("href") ?? "")
    .filter((h) => h.includes("#comment-"))
    .map((h) => h.split("#comment-")[1]);
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("CommentInboxList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders a link with the correct deep-link href", async () => {
    const item = makeItem();
    await renderList([item]);

    const link = screen.getByRole("link", { name: /Great point here/ });
    expect(link.getAttribute("href")).toMatch(
      /\/catalog\/default\/domain\/billing\/docs\/usage\/guide#comment-c1$/,
    );
  });

  it("renders body snippet and author name", async () => {
    const item = makeItem();
    await renderList([item]);

    expect(screen.getByText("Great point here")).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it("shows last-activity time from updatedAt with an absolute-time tooltip", async () => {
    const item = makeItem({
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10d → "1w ago" if shown
      updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2m ago
    });
    await renderList([item]);

    const time = screen.getByText("2m ago");
    expect(time).toBeInTheDocument();
    expect(time.getAttribute("title")).toMatch(/2026/); // absolute timestamp tooltip
    expect(screen.queryByText("1w ago")).not.toBeInTheDocument(); // createdAt is not used
  });

  it("formats older timestamps in weeks, months, and years", async () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
    await renderList([
      makeItem({ commentId: "w", updatedAt: daysAgo(10) }),
      makeItem({ commentId: "mo", updatedAt: daysAgo(60) }),
      makeItem({ commentId: "y", updatedAt: daysAgo(400) }),
    ]);
    expect(screen.getByText("1w ago")).toBeInTheDocument();
    expect(screen.getByText("2mo ago")).toBeInTheDocument();
    expect(screen.getByText("1y ago")).toBeInTheDocument();
  });

  it("renders 'No replies yet' for an unanswered thread", async () => {
    await renderList([makeItem({ replyCount: 0 })]);
    expect(screen.getByText(/No replies yet/)).toBeInTheDocument();
  });

  it("renders the reply count for an answered thread", async () => {
    await renderList([makeItem({ replyCount: 1 })]);
    expect(screen.getByText(/\b1 reply\b/)).toBeInTheDocument();
    expect(screen.queryByText(/No replies yet/)).not.toBeInTheDocument();
  });

  it("shows empty state when openCount is 0 and built is true", async () => {
    await renderList([], { openCount: 0 });
    expect(screen.getByText("No open comments")).toBeInTheDocument();
  });

  it("shows building notice when built is false", async () => {
    await renderList([], { built: false });
    expect(screen.getByText("Attribution still building…")).toBeInTheDocument();
  });

  it("shows building notice even when items are present and built is false", async () => {
    const item = makeItem();
    await renderList([item], { built: false });
    expect(screen.getByText("Attribution still building…")).toBeInTheDocument();
    expect(screen.queryByText("Great point here")).not.toBeInTheDocument();
  });

  it("builds href without viewerPath segment when viewerPath is empty", async () => {
    const item = makeItem({ viewerPath: "" });
    await renderList([item]);

    const link = screen.getByRole("link", { name: /Great point here/ });
    expect(link.getAttribute("href")).toMatch(
      /\/catalog\/default\/domain\/billing\/docs#comment-c1$/,
    );
  });

  it("renders items from multiple entities in one flat list, each showing its entity", async () => {
    const item1 = makeItem({ commentId: "c1", entityRef: "domain:default/billing" });
    const item2 = makeItem({
      commentId: "c2",
      entityRef: "component:default/payments",
      viewerPath: "api/overview",
    });
    await renderList([item1, item2]);

    // Each row renders a comment deep-link into its own entity's docs.
    const allLinks = screen.getAllByRole("link");
    const commentLinks = allLinks.filter((l) => l.getAttribute("href")?.includes("#comment-"));
    expect(commentLinks).toHaveLength(2);
    const hrefs = commentLinks.map((l) => l.getAttribute("href"));
    expect(hrefs.some((h) => h?.includes("billing") && h?.includes("#comment-c1"))).toBe(true);
    expect(hrefs.some((h) => h?.includes("payments") && h?.includes("#comment-c2"))).toBe(true);

    // The owning entity is a plain label, not a link — its catalog page isn't a
    // triage destination. Both entity names render as text, and no entity catalog
    // link exists (the only non-comment links point at the authors, under /user/).
    expect(screen.getByText("billing")).toBeInTheDocument();
    expect(screen.getByText("payments")).toBeInTheDocument();
    const entityCatalogLinks = allLinks.filter((l) => {
      const h = l.getAttribute("href") ?? "";
      return (
        h.includes("/catalog/") &&
        !h.includes("/docs") &&
        !h.includes("#comment-") &&
        !h.includes("/user/")
      );
    });
    expect(entityCatalogLinks).toHaveLength(0);
  });

  it("humanizes the author via the entity presentation API", async () => {
    // A guest has no profile, so the snapshot name is the raw ref; the presentation
    // API resolves it to a human-readable name.
    const item = makeItem({
      author: { id: "user:development/guest", name: "user:development/guest" },
    });
    await renderList([item]);

    expect(screen.getByText("development/guest")).toBeInTheDocument();
    expect(screen.queryByText("user:development/guest")).not.toBeInTheDocument();
  });

  it("links the author to their catalog entity page", async () => {
    const item = makeItem({ author: { id: "user:default/alice", name: "Alice Anderson" } });
    await renderList([item]);

    const authorLink = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("href") === "/catalog/default/user/alice");
    expect(authorLink).toBeDefined();
  });

  it("shows the resolved entity name, not the raw ref", async () => {
    const item = makeItem({ entityRef: "domain:default/billing" });
    await renderList([item]);

    expect(screen.getByText("billing")).toBeInTheDocument();
    expect(screen.queryByText("domain:default/billing")).not.toBeInTheDocument();
  });

  it("renders a non-default-namespace entity as namespace/name", async () => {
    const item = makeItem({ entityRef: "system:payments/gateway" });
    await renderList([item]);

    expect(screen.getByText("payments/gateway")).toBeInTheDocument();
    expect(screen.queryByText("system:payments/gateway")).not.toBeInTheDocument();
  });

  it("falls back to the placeholder when documentTitle is an empty string", async () => {
    // Empty string is falsy; the component falls through to docTitlePlaceholder(viewerPath).
    // The last segment "guide" humanizes to "Guide".
    await renderList([makeItem({ documentTitle: "", viewerPath: "usage/guide" })]);
    expect(screen.getByText("Guide")).toBeInTheDocument();
  });

  it("shows the server documentTitle, not the path-slug placeholder", async () => {
    await renderList([makeItem({ documentTitle: "Billing Overview", viewerPath: "usage/guide" })]);
    expect(screen.getByText("Billing Overview")).toBeInTheDocument();
    expect(screen.queryByText("Guide")).not.toBeInTheDocument();
  });

  // ToggleButtonGroup (selectionMode="single") renders as a radiogroup, so each
  // segment ToggleButton has role="radio" — not "button". The sort control is a
  // plain Button (role="button").
  describe("filter + sort toolbar", () => {
    // In the new architecture the server filters items; the toolbar counts come
    // from openCount/unansweredCount (not derived from items). Tests that check
    // the "unanswered" filter simulate the server returning only unanswered items
    // while keeping openCount/unansweredCount reflecting the full set.
    const allItems = () => [
      makeItem({
        commentId: "a",
        bodySnippet: "answered alpha",
        replyCount: 2,
        updatedAt: daysAgoIso(1),
      }),
      makeItem({
        commentId: "b",
        bodySnippet: "unanswered beta",
        replyCount: 0,
        updatedAt: daysAgoIso(3),
      }),
      makeItem({
        commentId: "c",
        bodySnippet: "unanswered gamma",
        replyCount: 0,
        updatedAt: daysAgoIso(2),
      }),
    ];

    it("renders segment counts from the unfiltered set", async () => {
      await renderList(allItems(), { openCount: 3, unansweredCount: 2 });
      expect(screen.getByRole("radio", { name: "Open (3)" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Unanswered \(2\)/ })).toBeInTheDocument();
    });

    it("renders a sort control labelled for its current (newest) state", async () => {
      await renderList(allItems(), { openCount: 3, unansweredCount: 2 });
      expect(
        screen.getByRole("button", { name: /Sort by activity, newest first/ }),
      ).toBeInTheDocument();
    });

    it("shows only unanswered rows when ?show=unanswered", async () => {
      // Simulate the server returning only unanswered items when show=unanswered.
      const unansweredItems = allItems().filter((i) => i.replyCount <= 0);
      await renderList(unansweredItems, {
        routeEntries: ["/?show=unanswered"],
        openCount: 3,
        unansweredCount: 2,
      });
      expect(screen.getByText("unanswered beta")).toBeInTheDocument();
      expect(screen.getByText("unanswered gamma")).toBeInTheDocument();
      expect(screen.queryByText("answered alpha")).not.toBeInTheDocument();
      // Segment counts stay over the full set even while the filter is active:
      // "Open (3)", not "Open (2)".
      expect(screen.getByRole("radio", { name: "Open (3)" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Unanswered \(2\)/ })).toBeInTheDocument();
    });

    it("sorts oldest-first when ?sort=oldest", async () => {
      // Simulate the server returning items sorted oldest-first.
      const sortedOldest = [...allItems()].sort(
        (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
      );
      await renderList(sortedOldest, {
        routeEntries: ["/?sort=oldest"],
        openCount: 3,
        unansweredCount: 2,
      });
      // oldest updatedAt first: b (3d), c (2d), a (1d)
      expect(renderedCommentOrder()).toEqual(["b", "c", "a"]);
    });

    it("keeps the toolbar and shows an inline message when the filter matches nothing", async () => {
      // Server returns no items because the unanswered filter matched nothing;
      // openCount=2 so we don't hit the "No open comments" empty state.
      await renderList([], {
        routeEntries: ["/?show=unanswered"],
        openCount: 2,
        unansweredCount: 0,
      });
      expect(
        screen.getByText("No unanswered threads — every open thread has at least one reply."),
      ).toBeInTheDocument();
      // Toolbar stays so "All" is one click away; no comment rows render.
      expect(screen.getByRole("radio", { name: "Open (2)" })).toBeInTheDocument();
      expect(renderedCommentOrder()).toEqual([]);
    });

    it("clicking the Unanswered segment selects it (aria-checked becomes true)", async () => {
      // useInboxFilters updates the URL on click; useInboxData would re-fetch.
      // With a static mock we can't test the re-fetch, but we can prove the click
      // took effect by asserting the Unanswered radio becomes selected.
      await renderList(allItems(), { openCount: 3, unansweredCount: 2 });
      const unansweredBtn = screen.getByRole("radio", { name: /Unanswered \(2\)/ });
      expect(unansweredBtn).toHaveAttribute("aria-checked", "false");
      fireEvent.click(unansweredBtn);
      expect(unansweredBtn).toHaveAttribute("aria-checked", "true");
    });

    it("no longer renders the old waiting/thread-count header copy", async () => {
      await renderList(allItems(), { openCount: 3, unansweredCount: 2 });
      expect(screen.queryByText(/waiting for a reply/)).not.toBeInTheDocument();
      expect(screen.queryByText(/open threads across/)).not.toBeInTheDocument();
    });

    // Refetch on a filter/sort change must not blank the page. The hook keeps the
    // previous items mounted while the new page is in flight (stale-while-
    // revalidate), so the toolbar and the prior rows stay on screen — only the
    // very first load (no data yet) shows the full-page spinner.
    it("keeps the toolbar and prior rows mounted while refetching (loading after first load)", async () => {
      await renderList(allItems(), {
        openCount: 3,
        unansweredCount: 2,
        loading: true,
        hasLoaded: true,
      });
      // Toolbar still present (not unmounted to a spinner)…
      expect(screen.getByRole("radio", { name: "Open (3)" })).toBeInTheDocument();
      // …and the stale rows are still shown.
      expect(screen.getByText("answered alpha")).toBeInTheDocument();
      // No full-page progress bar swapped in over the content.
      expect(screen.queryByTestId("progress")).not.toBeInTheDocument();
    });

    it("shows the full-page spinner on the very first load (loading, never loaded)", async () => {
      await renderList(allItems(), {
        openCount: 3,
        unansweredCount: 2,
        loading: true,
        hasLoaded: false,
      });
      // First load has nothing to show yet, so the spinner replaces the content
      // and the toolbar is not yet rendered.
      expect(screen.getByTestId("progress")).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "Open (3)" })).not.toBeInTheDocument();
    });
  });

  it("does not render a warning left-border on unanswered rows", async () => {
    const { container } = await renderList([makeItem({ commentId: "u1", replyCount: 0 })]);
    const bordered = Array.from(container.querySelectorAll<HTMLElement>("*")).filter((el) =>
      (el.getAttribute("style") ?? "").includes("border-left"),
    );
    expect(bordered).toHaveLength(0);
  });

  it("omits the row divider on the last comment in a bucket", async () => {
    // Two comments with the same recent timestamp share the "Today" bucket.
    const today = new Date(Date.now() - 3600_000).toISOString();
    const { container } = await renderList([
      makeItem({ commentId: "a", updatedAt: today }),
      makeItem({ commentId: "b", updatedAt: today }),
    ]);
    const bordered = Array.from(container.querySelectorAll<HTMLElement>("*")).filter((el) =>
      (el.getAttribute("style") ?? "").includes("border-bottom"),
    );
    // The divider separates rows, so two rows produce a single border (between
    // them); the last row omits it rather than doubling against the card edge.
    expect(bordered).toHaveLength(1);
  });

  it("orders buckets by the items on screen, not the URL sort (no header flip mid-refetch)", async () => {
    // Reproduces the stale-while-revalidate window: the user just toggled to
    // ?sort=oldest, but the newest-first page is still on screen until the
    // refetch resolves. Bucket order must follow the items actually shown
    // (newest-first → "Today" leads), not the not-yet-applied oldest-first flag —
    // otherwise the first heading flashes a reversed order (Today → Earlier) for
    // one render before the oldest-first page arrives.
    const noonDaysAgo = (n: number) => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - n);
      return d.toISOString();
    };
    const newestFirst = [
      makeItem({ commentId: "t", updatedAt: noonDaysAgo(0) }), // today
      makeItem({ commentId: "e", updatedAt: noonDaysAgo(10) }), // earlier
    ];
    await renderList(newestFirst, { routeEntries: ["/?sort=oldest"], openCount: 2 });
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.indexOf("Today")).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf("Today")).toBeLessThan(headings.indexOf("Earlier"));
  });

  it("renders date-bucket headers across a multi-age list", async () => {
    // Pin fixtures to local noon so calendar-day bucketing is deterministic and
    // can't drift into an adjacent day when the suite runs near midnight.
    const noonDaysAgo = (n: number) => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - n);
      return d.toISOString();
    };
    await renderList([
      makeItem({ commentId: "today", updatedAt: noonDaysAgo(0) }),
      makeItem({ commentId: "yest", updatedAt: noonDaysAgo(1) }),
      makeItem({ commentId: "wk", updatedAt: noonDaysAgo(3) }),
      makeItem({ commentId: "old", updatedAt: noonDaysAgo(10) }),
    ]);
    // Match on the heading role (bucket labels render as <h3>) so the assertions
    // can't collide with any incidental body text.
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Yesterday" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Previous 7 days" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Earlier" })).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // InboxFooter + pagination.
  // ---------------------------------------------------------------------------

  describe("InboxFooter", () => {
    it("shows 'All N shown' when hasMore is false", async () => {
      await renderList([makeItem()], { openCount: 1, hasMore: false });
      expect(screen.getByText("All 1 shown")).toBeInTheDocument();
    });

    it("shows 'Showing N of M' when hasMore is true", async () => {
      const items = [makeItem({ commentId: "a" }), makeItem({ commentId: "b" })];
      await renderList(items, { openCount: 10, hasMore: true });
      expect(screen.getByText("Showing 2 of 10")).toBeInTheDocument();
    });

    it("shows a Load more button when hasMore is true", async () => {
      await renderList([makeItem()], { openCount: 5, hasMore: true });
      expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    });

    it("does not show a Load more button when hasMore is false", async () => {
      await renderList([makeItem()], { openCount: 1, hasMore: false });
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });

    it("calls loadMore when the Load more button is pressed", async () => {
      const loadMore = jest.fn();
      await renderList([makeItem()], { openCount: 5, hasMore: true, loadMore });
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
      expect(loadMore).toHaveBeenCalledTimes(1);
    });

    it("shows 'Loading…' and disables the button when loadingMore is true", async () => {
      await renderList([makeItem()], { openCount: 5, hasMore: true, loadingMore: true });
      const btn = screen.getByRole("button", { name: "Loading…" });
      expect(btn).toBeInTheDocument();
      expect(btn).toBeDisabled();
    });

    it("uses unansweredCount as total when show=unanswered", async () => {
      const items = [makeItem({ replyCount: 0 })];
      await renderList(items, {
        routeEntries: ["/?show=unanswered"],
        openCount: 10,
        unansweredCount: 3,
        hasMore: true,
      });
      // shown=1, total=unansweredCount=3
      expect(screen.getByText("Showing 1 of 3")).toBeInTheDocument();
    });
  });
});
