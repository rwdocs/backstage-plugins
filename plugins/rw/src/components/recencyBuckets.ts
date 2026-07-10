export type BucketKey = "today" | "yesterday" | "previous7" | "earlier";

export interface RecencyBucket<T> {
  key: BucketKey;
  label: string;
  items: T[];
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
 * Chunk an already-sorted list into recency buckets by a per-item timestamp.
 *
 * Buckets follow the macOS Finder convention: "Today"/"Yesterday" are real
 * calendar days in the viewer's local timezone, and "Previous 7 days" is a
 * rolling window for the days before that. Empty buckets are omitted.
 *
 * Bucket order is derived from the order buckets first appear in `items` (the
 * caller's sort), not from a separate sort-direction flag. This matters during a
 * sort toggle: the previous page is still on screen for one render
 * (stale-while-revalidate), and a flag that flips before the new data lands would
 * flash a reversed header before the rows catch up. Deriving order from the items
 * keeps headers and rows consistent by construction.
 */
export function bucketByTime<T>(
  items: T[],
  getTime: (item: T) => string,
  now: number,
): RecencyBucket<T>[] {
  const groups: Record<BucketKey, T[]> = {
    today: [],
    yesterday: [],
    previous7: [],
    earlier: [],
  };
  // `items` is sorted by time and the bucket key is a monotonic function of it,
  // so recording each key the first time it's seen yields exactly the order the
  // buckets should read in.
  const order: BucketKey[] = [];
  for (const it of items) {
    const days = calendarDaysAgo(now, new Date(getTime(it)).getTime());
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
