import type { Knex } from "knex";
import type { ClaimedSite } from "./types";

const TABLE = "site_refresh";
// SQLite does not implement FOR UPDATE SKIP LOCKED; only take row locks on clients that support it.
const LOCKING_CLIENTS = ["pg", "mysql", "mysql2"];

export class SiteRefreshStore {
  private readonly useLocking: boolean;
  constructor(private readonly knex: Knex) {
    this.useLocking = LOCKING_CLIENTS.includes(String(knex.client.config.client));
  }

  /** Insert a new queue row (due now) or, on conflict, only advance last_discovery_at. */
  async upsertSite(
    siteRef: string,
    scanStart: Date,
    executor?: Knex | Knex.Transaction,
  ): Promise<void> {
    const exec = executor ?? this.knex;
    await exec(TABLE)
      .insert({
        site_ref: siteRef,
        next_update_at: scanStart,
        last_built_at: null,
        result_hash: null,
        errors: null,
        last_discovery_at: scanStart,
      })
      .onConflict("site_ref")
      .merge(["last_discovery_at"]);
  }

  /** Delete queue rows not seen in the current (completed) scan. Returns count. */
  async pruneMissing(scanStart: Date): Promise<number> {
    return this.knex(TABLE).where("last_discovery_at", "<", scanStart).del();
  }

  /** Claim up to `batch` due rows, bumping their lease, in one transaction. */
  async claimDue(now: Date, batch: number, leaseUntil: Date): Promise<ClaimedSite[]> {
    return this.knex.transaction(async (tx) => {
      const q = tx(TABLE)
        .where("next_update_at", "<=", now)
        .orderBy("next_update_at", "asc")
        .limit(batch)
        .select("site_ref", "result_hash");
      if (this.useLocking) q.forUpdate().skipLocked();
      const rows = await q;
      if (rows.length) {
        await tx(TABLE)
          .whereIn(
            "site_ref",
            rows.map((r) => r.site_ref),
          )
          .update({ next_update_at: leaseUntil });
      }
      return rows.map((r) => ({ siteRef: r.site_ref, resultHash: r.result_hash ?? null }));
    });
  }

  async completeSuccess(
    siteRef: string,
    resultHash: string,
    nextUpdateAt: Date,
    now: Date,
  ): Promise<void> {
    await this.knex(TABLE).where({ site_ref: siteRef }).update({
      last_built_at: now,
      result_hash: resultHash,
      errors: null,
      next_update_at: nextUpdateAt,
    });
  }

  async recordError(siteRef: string, message: string): Promise<void> {
    await this.knex(TABLE).where({ site_ref: siteRef }).update({ errors: message });
  }

  /** True iff every queue row has been built at least once. Returns true for an empty table
   *  (vacuous truth) — prefer anyBuilt() to test readiness. */
  async allBuilt(): Promise<boolean> {
    const [{ count }] = await this.knex(TABLE).whereNull("last_built_at").count({ count: "*" });
    return Number(count) === 0;
  }

  /** True iff at least one queue row has been built. Preferred over allBuilt() for the inbox
   *  readiness check: avoids (a) empty-table false-positive and (b) one permanently-failing site
   *  blocking the inbox for all users forever. */
  async anyBuilt(): Promise<boolean> {
    const [{ count }] = await this.knex(TABLE).whereNotNull("last_built_at").count({ count: "*" });
    return Number(count) > 0;
  }

  /** Run fn in a single DB transaction (lets a caller atomically span multiple stores). */
  async transaction<T>(fn: (tx: Knex.Transaction) => Promise<T>): Promise<T> {
    return this.knex.transaction(fn);
  }
}
