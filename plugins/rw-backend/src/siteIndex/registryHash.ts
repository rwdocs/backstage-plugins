import { createHash } from "crypto";
import type { SectionRow, PageRow } from "./types";

/** Deterministic hash of a site's registries. Caller must pass sorted arrays. */
export function registryHash(sections: SectionRow[], pages: PageRow[]): string {
  return createHash("sha256").update(JSON.stringify({ sections, pages })).digest("hex");
}
