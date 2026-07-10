import { z } from "zod";
import { InputError } from "@backstage/errors";

const cursorSchema = z.object({
  // [last_modified, site_ref, section_ref, subpath]. last_modified compares
  // against its own column, so a driver-mismatched type (number for
  // better-sqlite3, string for pg bigint) works structurally either way; the
  // router normalizes to a number when building a cursor — safe because
  // last-modified epoch-millis stay well under Number.MAX_SAFE_INTEGER for
  // centuries. This is not a general bigint round-trip. The three ref parts form
  // the deterministic tiebreak (pages has no single unique sort column — its PK
  // is the triple).
  lastKey: z.tuple([z.union([z.string(), z.number()]), z.string(), z.string(), z.string()]),
});

export type LatestChangesCursor = z.infer<typeof cursorSchema>;

export function encodeLatestChangesCursor(cursor: LatestChangesCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64");
}

export function decodeLatestChangesCursor(encoded: string): LatestChangesCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new InputError("Malformed latest-changes cursor");
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) {
    throw new InputError(`Malformed latest-changes cursor: ${result.error.message}`);
  }
  return result.data;
}
