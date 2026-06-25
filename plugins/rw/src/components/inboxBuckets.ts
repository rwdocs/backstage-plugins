// plugins/rw/src/components/inboxBuckets.ts
import type { InboxItem } from "../api/RwClient";

export type BucketKey = "today" | "yesterday" | "previous7" | "earlier";

export interface InboxBucket {
  key: BucketKey;
  label: string;
  items: InboxItem[];
}

const DAY = 86_400_000;
const LABELS: Record<BucketKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  previous7: "Previous 7 days",
  earlier: "Earlier",
};

/** Whole calendar days between two instants in the viewer's local timezone. */
function calendarDaysAgo(now: number, then: number): number {
  const startOfDay = (ms: number): number => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  // Round so a DST-shortened/lengthened day (23 or 25h) still counts as one day.
  return Math.round((startOfDay(now) - startOfDay(then)) / DAY);
}

/**
 * Chunk an already-sorted inbox list into recency buckets by `updatedAt`.
 *
 * Buckets follow the macOS Finder convention: "Today"/"Yesterday" are real
 * calendar days in the viewer's local timezone (so "Today" means since local
 * midnight, not the last 24h), and "Previous 7 days" is an explicit rolling
 * window for the days before that — which sidesteps the Sunday-vs-Monday
 * ambiguity of a calendar "this week". Empty buckets are omitted.
 *
 * Bucket order follows the order the buckets first appear in `items`, which is
 * the server's sort (newest- or oldest-first). Deriving order from the items
 * shown — rather than a separate sort flag — keeps the headers consistent with
 * the rows by construction: during a sort toggle the previous page is still on
 * screen for one render (stale-while-revalidate), and ordering off a flag that
 * flips before the data would flash a reversed header before the new page lands.
 */
export function bucketByActivity(items: InboxItem[], now: number): InboxBucket[] {
  const groups: Record<BucketKey, InboxItem[]> = {
    today: [],
    yesterday: [],
    previous7: [],
    earlier: [],
  };
  // Record each bucket the first time an item lands in it; since `items` is sorted
  // by updatedAt and the bucket is a monotonic function of it, this first-seen
  // sequence is exactly the order the buckets should read in.
  const order: BucketKey[] = [];
  for (const it of items) {
    const days = calendarDaysAgo(now, new Date(it.updatedAt).getTime());
    let key: BucketKey;
    if (days <= 0) key = "today";
    else if (days === 1) key = "yesterday";
    else if (days <= 7) key = "previous7";
    else key = "earlier";
    if (groups[key].length === 0) order.push(key);
    groups[key].push(it);
  }
  return order.map((key) => ({ key, label: LABELS[key], items: groups[key] }));
}
