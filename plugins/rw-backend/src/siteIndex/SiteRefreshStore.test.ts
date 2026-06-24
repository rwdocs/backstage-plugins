import type { Knex } from "knex";
import { createTestDb } from "./__testUtils__/testDb";
import { SiteRefreshStore } from "./SiteRefreshStore";

describe("SiteRefreshStore", () => {
  let knex: Knex;
  let store: SiteRefreshStore;
  beforeEach(async () => {
    knex = await createTestDb();
    store = new SiteRefreshStore(knex);
  });
  afterEach(async () => knex.destroy());

  it("upsertSite inserts new rows as due now and keeps existing schedule on re-scan", async () => {
    const t1 = new Date("2026-06-24T00:00:00Z");
    await store.upsertSite("s", t1);
    let row = await knex("site_refresh").where({ site_ref: "s" }).first();
    expect(new Date(row.next_update_at).getTime()).toBe(t1.getTime());

    // simulate a completed build pushing next_update_at far out
    const future = new Date("2026-06-24T01:00:00Z");
    await store.completeSuccess("s", "h", future, t1);

    const t2 = new Date("2026-06-24T00:30:00Z");
    await store.upsertSite("s", t2);
    row = await knex("site_refresh").where({ site_ref: "s" }).first();
    // next_update_at preserved (not reset to t2); last_discovery_at advanced
    expect(new Date(row.next_update_at).getTime()).toBe(future.getTime());
    expect(new Date(row.last_discovery_at).getTime()).toBe(t2.getTime());
  });

  it("pruneMissing deletes rows not seen this scan", async () => {
    await store.upsertSite("old", new Date("2026-06-24T00:00:00Z"));
    await store.upsertSite("new", new Date("2026-06-24T02:00:00Z"));
    const deleted = await store.pruneMissing(new Date("2026-06-24T01:00:00Z"));
    expect(deleted).toBe(1);
    expect(await knex("site_refresh").pluck("site_ref")).toEqual(["new"]);
  });

  it("claimDue returns due rows oldest-first and bumps next_update_at to the lease", async () => {
    await store.upsertSite("a", new Date("2026-06-24T00:00:00Z"));
    await store.upsertSite("b", new Date("2026-06-24T00:00:01Z"));
    const lease = new Date("2026-06-24T03:00:00Z");
    const claimed = await store.claimDue(new Date("2026-06-24T01:00:00Z"), 10, lease);
    expect(claimed.map((c) => c.siteRef)).toEqual(["a", "b"]);
    // both leased out → no longer due before lease
    const again = await store.claimDue(new Date("2026-06-24T02:00:00Z"), 10, lease);
    expect(again).toEqual([]);
  });

  it("completeSuccess sets last_built_at/result_hash/next_update_at and clears errors", async () => {
    await store.upsertSite("a", new Date("2026-06-24T00:00:00Z"));
    await store.recordError("a", "boom");
    const next = new Date("2026-06-24T04:00:00Z");
    const now = new Date("2026-06-24T00:05:00Z");
    await store.completeSuccess("a", "hash1", next, now);
    const row = await knex("site_refresh").where({ site_ref: "a" }).first();
    expect(row.result_hash).toBe("hash1");
    expect(row.errors).toBeNull();
    expect(new Date(row.last_built_at).getTime()).toBe(now.getTime());
    expect(new Date(row.next_update_at).getTime()).toBe(next.getTime());
  });

  it("allBuilt is false until every row has last_built_at", async () => {
    await store.upsertSite("a", new Date("2026-06-24T00:00:00Z"));
    await store.upsertSite("b", new Date("2026-06-24T00:00:00Z"));
    expect(await store.allBuilt()).toBe(false);
    await store.completeSuccess("a", "h", new Date(), new Date());
    expect(await store.allBuilt()).toBe(false);
    await store.completeSuccess("b", "h", new Date(), new Date());
    expect(await store.allBuilt()).toBe(true);
  });
});
