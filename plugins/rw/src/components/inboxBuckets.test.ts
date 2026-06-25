// plugins/rw/src/components/inboxBuckets.test.ts
import { bucketByActivity } from "./inboxBuckets";
import type { InboxItem } from "../api/RwClient";

const NOW = 1_700_000_000_000;

// A timestamp `daysAgo` whole calendar days before NOW, pinned to local noon so
// the calendar-day math is deterministic regardless of the runner's timezone
// (and away from midnight, so it can't drift into an adjacent day).
function daysAgoLocal(daysAgo: number): string {
  const d = new Date(NOW);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function item(id: string, daysAgo: number): InboxItem {
  const ts = daysAgoLocal(daysAgo);
  return {
    commentId: id,
    siteRef: "component:default/arch",
    documentId: "domain:default/billing#x",
    entityRef: "domain:default/billing",
    viewerPath: "x",
    documentTitle: "X",
    author: { id: "user:default/alice", name: "Alice" },
    bodySnippet: id,
    createdAt: ts,
    updatedAt: ts,
    replyCount: 0,
  };
}

describe("bucketByActivity", () => {
  const items = [
    item("a", 0), // today
    item("b", 0), // today
    item("y", 1), // yesterday
    item("c", 3), // previous 7 days
    item("d", 10), // earlier
  ];

  it("groups by calendar-day recency and labels buckets", () => {
    const buckets = bucketByActivity(items, NOW);
    expect(buckets.map((b) => [b.key, b.label, b.items.map((i) => i.commentId)])).toEqual([
      ["today", "Today", ["a", "b"]],
      ["yesterday", "Yesterday", ["y"]],
      ["previous7", "Previous 7 days", ["c"]],
      ["earlier", "Earlier", ["d"]],
    ]);
  });

  it("puts 7 days ago in Previous 7 days and 8 days ago in Earlier", () => {
    const buckets = bucketByActivity([item("seven", 7), item("eight", 8)], NOW);
    expect(buckets.map((b) => [b.key, b.items.map((i) => i.commentId)])).toEqual([
      ["previous7", ["seven"]],
      ["earlier", ["eight"]],
    ]);
  });

  it("orders buckets by the order they appear in the (server-sorted) items", () => {
    // Newest-first input → newest bucket leads.
    const newestFirst = bucketByActivity(items, NOW);
    expect(newestFirst.map((b) => b.key)).toEqual(["today", "yesterday", "previous7", "earlier"]);
    // Oldest-first input (the server's oldest-first page) → oldest bucket leads.
    // Order tracks the items themselves, with no separate sort flag to fall out
    // of step with the rows during a sort-change refetch.
    const oldestFirst = bucketByActivity([...items].reverse(), NOW);
    expect(oldestFirst.map((b) => b.key)).toEqual(["earlier", "previous7", "yesterday", "today"]);
  });

  it("omits empty buckets", () => {
    const buckets = bucketByActivity([item("a", 0)], NOW);
    expect(buckets.map((b) => b.key)).toEqual(["today"]);
  });

  it("preserves input order within a bucket", () => {
    const buckets = bucketByActivity(items, NOW);
    expect(buckets[0].items.map((i) => i.commentId)).toEqual(["a", "b"]);
  });
});
