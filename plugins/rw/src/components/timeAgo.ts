/** Compact relative time ("just now", "5m ago", "3d ago") for list rows. */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Absolute local timestamp for the hover tooltip behind the relative time. */
export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * A day-precise label for a change-group's most-recent time: relative within
 * today ("2h ago"), then "Yesterday", a weekday within the past week, and a date
 * beyond that (with the year when it differs). Distinct per calendar day — unlike
 * bare relative time, where several different days all read "1w ago" and make
 * day-grouped entries look like they should have merged.
 */
export function groupDayLabel(iso: string, now: number = Date.now()): string {
  const then = new Date(iso);
  const startOfDay = (ms: number): number => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const daysAgo = Math.round((startOfDay(now) - startOfDay(then.getTime())) / 86_400_000);
  if (daysAgo <= 0) return relativeTime(iso);
  if (daysAgo === 1) return "Yesterday";
  // Days 2–6 read as a weekday; day 7 would repeat today's weekday, so it falls
  // through to a date.
  if (daysAgo < 7) return then.toLocaleDateString(undefined, { weekday: "short" });
  const sameYear = new Date(now).getFullYear() === then.getFullYear();
  return then.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}
