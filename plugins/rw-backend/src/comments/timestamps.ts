import { DateTime } from "luxon";

/**
 * Normalize a dateTime column read across drivers to an RFC3339 UTC string.
 * Returns undefined for null/undefined.
 *
 * Driver shapes:
 *   - Postgres      → JS Date object
 *   - sqlite3       → ISO-like string ("YYYY-MM-DD HH:MM:SS" or ISO)
 *   - better-sqlite3 → epoch-millis number
 */
export function toIso(value: Date | string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  let dt: DateTime;
  if (
    value instanceof Date ||
    (typeof value === "object" && typeof (value as any).getTime === "function")
  ) {
    dt = DateTime.fromJSDate(value as Date);
  } else if (typeof value === "number") {
    dt = DateTime.fromMillis(value);
  } else if ((value as string).includes(" ")) {
    dt = DateTime.fromSQL(value, { zone: "utc" }); // "YYYY-MM-DD HH:MM:SS"
  } else {
    dt = DateTime.fromISO(value, { zone: "utc" });
  }
  return dt.toUTC().toISO() ?? undefined;
}
