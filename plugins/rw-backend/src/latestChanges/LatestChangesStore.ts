import type { Knex } from "knex";

export interface LatestChangeRow {
  site_ref: string;
  section_ref: string;
  subpath: string;
  title: string;
  /** Driver-native: number (better-sqlite3) or string (pg bigint). */
  last_modified: number | string;
  entity_ref: string;
  section_path: string;
}

export interface LatestChangesParams {
  /** [last_modified, site_ref, section_ref, subpath] of the last row of the prior page. */
  lastKey?: [number | string, string, string, string];
  limit: number;
}

export interface LatestChangesPageResult {
  rows: LatestChangeRow[];
  hasMore: boolean;
}

export class LatestChangesStore {
  constructor(private readonly knex: Knex) {}

  /** One page of the global feed, newest-first, unknown mtimes excluded.
   *  Order: last_modified DESC, then (site_ref, section_ref, subpath) ASC as a
   *  deterministic tiebreak (pages has no single unique sort column). */
  async latestChangesPage(params: LatestChangesParams): Promise<LatestChangesPageResult> {
    let q = this.knex({ p: "pages" })
      .join({ s: "sections" }, function joinSections(this: Knex.JoinClause) {
        this.on("s.site_ref", "p.site_ref").andOn("s.section_ref", "p.section_ref");
      })
      .whereNotNull("p.last_modified")
      .andWhere("p.last_modified", ">", 0);

    if (params.lastKey) {
      const [lm, site, section, sub] = params.lastKey;
      q = q.andWhere(function seek(this: Knex.QueryBuilder) {
        this.where("p.last_modified", "<", lm).orWhere(function tie(this: Knex.QueryBuilder) {
          this.where("p.last_modified", lm).andWhere(function refs(this: Knex.QueryBuilder) {
            this.where("p.site_ref", ">", site).orWhere(function s2(this: Knex.QueryBuilder) {
              this.where("p.site_ref", site).andWhere(function s3(this: Knex.QueryBuilder) {
                this.where("p.section_ref", ">", section).orWhere(function s4(
                  this: Knex.QueryBuilder,
                ) {
                  this.where("p.section_ref", section).andWhere("p.subpath", ">", sub);
                });
              });
            });
          });
        });
      });
    }

    const raw: LatestChangeRow[] = await q
      .orderBy("p.last_modified", "desc")
      .orderBy("p.site_ref", "asc")
      .orderBy("p.section_ref", "asc")
      .orderBy("p.subpath", "asc")
      .select(
        "p.site_ref",
        "p.section_ref",
        "p.subpath",
        "p.title",
        "p.last_modified",
        "s.entity_ref",
        "s.section_path",
      )
      .limit(params.limit + 1);

    const hasMore = raw.length > params.limit;
    if (hasMore) raw.length = params.limit;
    return { rows: raw, hasMore };
  }

  /** True once any page has a known modification time — drives the "still
   *  indexing" vs "no recent changes" empty state. Deliberately NOT
   *  siteRefreshStore.anyBuilt(): that is already true on an upgraded instance
   *  while every last_modified is still NULL. */
  async hasAnyDated(): Promise<boolean> {
    const [{ count }] = await this.knex("pages")
      .whereNotNull("last_modified")
      .andWhere("last_modified", ">", 0)
      .count({ count: "*" });
    return Number(count) > 0;
  }
}
