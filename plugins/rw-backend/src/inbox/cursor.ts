import { z } from "zod";
import { InputError } from "@backstage/errors";

const cursorSchema = z.object({
  filter: z.enum(["open", "unanswered"]),
  sort: z.enum(["newest", "oldest"]),
  // [raw updated_at column value, comment id]. updated_at is the column's native
  // value per driver (number for better-sqlite3, string for sqlite3/pg ISO), kept
  // opaque so it round-trips back into the seek against its own column type.
  lastKey: z.tuple([z.union([z.string(), z.number()]), z.string()]),
  openCount: z.number().int().nonnegative(),
  unansweredCount: z.number().int().nonnegative(),
});

export type InboxCursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: InboxCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64");
}

export function decodeCursor(encoded: string): InboxCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new InputError("Malformed inbox cursor");
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) {
    throw new InputError(`Malformed inbox cursor: ${result.error.message}`);
  }
  return result.data;
}
