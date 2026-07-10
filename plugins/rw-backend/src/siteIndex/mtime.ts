/**
 * Convert an RFC-3339 last-modified string (from `listPages().lastModified`) to
 * epoch millis, or `null` when the mtime is unknown. Core returns the Unix epoch
 * for unknown mtimes; we collapse that (and any unparseable / non-positive value)
 * to `null` so "unknown" has a single representation in the DB and is excluded
 * from the Latest Changes feed.
 */
export function parseMtime(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || ms <= 0) return null;
  return ms;
}
