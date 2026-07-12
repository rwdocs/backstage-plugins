import type { LatestChangeItem } from "../api/RwClient";

/** A run of pages the same doc-site entity published on the same calendar day —
 *  roughly one deploy. `entityRef` is the owning service; `items` keep the
 *  caller's original (recency-descending) order, so `items[0]` is the group's
 *  most recent page and its time labels the group. */
export interface ServiceGroup {
  entityRef: string;
  items: LatestChangeItem[];
}

/** A stable per-item key for the viewer-local calendar day. Grouping keys on
 *  this (not the raw timestamp) so a deploy's pages — published within seconds —
 *  land in one group, while a later day's changes start a new one. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Collapse an already-sorted list of changes into per-service, per-day groups.
 *
 * A deploy republishes all of a service's docs at once, so the raw feed carries
 * one row per page — the same service and timestamp repeated N times. Grouping
 * turns that batch into a single entry the reader can scan.
 *
 * The key is `(entityRef, calendar-day)`, not just the service: the recency
 * buckets that feed this ("Previous 7 days", "Earlier") span many days, so
 * grouping by service alone would merge a service's separate days into one
 * entry with one misleading timestamp. Splitting by day keeps each group to
 * roughly one deploy. There is no deploy/commit id in the data, so two of a
 * service's deploys on the *same* day still merge — the accepted granularity.
 *
 * Groups appear in first-seen order — a `Map` preserves insertion order, and
 * because the caller sorts by time that is recency order: the group with the
 * most recent change comes first (so a service with two days can appear twice,
 * newest day first), and within each group the pages stay in that order.
 */
export function groupByServiceAndDay(items: LatestChangeItem[]): ServiceGroup[] {
  const groups = new Map<string, LatestChangeItem[]>();
  for (const item of items) {
    const key = `${item.entityRef} ${dayKey(item.lastModified)}`;
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()].map((groupItems) => ({
    entityRef: groupItems[0].entityRef,
    items: groupItems,
  }));
}
