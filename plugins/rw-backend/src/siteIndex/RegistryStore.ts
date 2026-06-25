import type { Knex } from "knex";
import type { SectionRow, PageRow } from "./types";

export class RegistryStore {
  constructor(private readonly knex: Knex) {}

  /** Replace the site's `sections` and `pages` rows in one transaction. `sections` carries the
   *  effective-ownership rollup, so this swap is the single point where ownership is published. */
  async swapSite(siteRef: string, sections: SectionRow[], pages: PageRow[]): Promise<void> {
    await this.knex.transaction(async (tx) => {
      await tx("sections").where({ site_ref: siteRef }).del();
      await tx("pages").where({ site_ref: siteRef }).del();
      if (sections.length) await tx.batchInsert("sections", sections, 500);
      if (pages.length) await tx.batchInsert("pages", pages, 500);
    });
  }
}
