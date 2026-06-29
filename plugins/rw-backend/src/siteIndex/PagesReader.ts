import type { Knex } from "knex";

const TABLE = "pages";

/** By-key reader for the `pages` registry. Used by CommentActivityResolver to resolve the page
 *  title for a given (siteRef, sectionRef, subpath). */
export class PagesReader {
  constructor(private readonly knex: Knex) {}

  async getTitle(siteRef: string, sectionRef: string, subpath: string): Promise<string | null> {
    const row = await this.knex(TABLE)
      .where({ site_ref: siteRef, section_ref: sectionRef, subpath })
      .select("title")
      .first();
    return row?.title ?? null;
  }
}
