import { createHash } from "crypto";
import type { SectionRow, PageRow } from "./types";

/** Deterministic hash of a site's registries. Both arrays (sections, pages) must be pre-sorted by
 *  the caller: JSON.stringify is order-sensitive. `sections` carries effective ownership, so an
 *  ownership change flips the hash and triggers a re-swap. */
export function registryHash(sections: SectionRow[], pages: PageRow[]): string {
  return createHash("sha256").update(JSON.stringify({ sections, pages })).digest("hex");
}
