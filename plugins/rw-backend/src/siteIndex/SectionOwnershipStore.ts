import type { Knex } from "knex";
import type { SectionOwnershipRow } from "./types";

const TABLE = "section_ownership";

export class SectionOwnershipStore {
  constructor(private readonly knex: Knex) {}

  /** Replace all links for `siteRef`. Pass `executor` to join a per-site transaction. */
  async swapSite(
    siteRef: string,
    links: SectionOwnershipRow[],
    executor?: Knex | Knex.Transaction,
  ): Promise<void> {
    const exec = executor ?? this.knex;
    await exec(TABLE).where({ site_ref: siteRef }).del();
    if (links.length) await exec.batchInsert(TABLE, links, 500);
  }

  /** Return all ownership links for `siteRef`. */
  async listForSite(siteRef: string): Promise<SectionOwnershipRow[]> {
    return this.knex(TABLE).where({ site_ref: siteRef }).select("*");
  }
}
