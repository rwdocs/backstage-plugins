import type { Knex } from "knex";
import { SectionRow } from "./types";

const TABLE = "sections";

/** By-key reader for the dense `sections` registry. Used by CommentActivityResolver
 *  to resolve a section's effective owner (`entity_owner_ref`), its owning entity
 *  (`entity_ref`), and its owner-relative `section_path` for the deep link. One indexed
 *  point-read on PK (site_ref, section_ref); no RwSite load. Kept separate from the
 *  swap-only RegistryStore and the by-owner InboxStore reads. */
export class SectionsReader {
  constructor(private readonly knex: Knex) {}

  async getSection(siteRef: string, sectionRef: string): Promise<SectionRow | undefined> {
    return this.knex<SectionRow>(TABLE)
      .where({ site_ref: siteRef, section_ref: sectionRef })
      .first();
  }
}
