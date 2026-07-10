import { bucketByTime } from "./recencyBuckets";

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const DAY = 86_400_000;

describe("bucketByTime", () => {
  it("groups items into today/yesterday/previous7/earlier by a timestamp getter", () => {
    const now = Date.now();
    const items = [
      { t: iso(0) }, // today
      { t: iso(DAY + 1000) }, // yesterday
      { t: iso(3 * DAY) }, // previous7
      { t: iso(30 * DAY) }, // earlier
    ];
    const buckets = bucketByTime(items, (it) => it.t, now);
    expect(buckets.map((b) => b.key)).toEqual(["today", "yesterday", "previous7", "earlier"]);
    expect(buckets.every((b) => b.items.length === 1)).toBe(true);
  });

  it("omits empty buckets and preserves first-seen order", () => {
    const now = Date.now();
    const items = [{ t: iso(30 * DAY) }, { t: iso(0) }];
    const buckets = bucketByTime(items, (it) => it.t, now);
    expect(buckets.map((b) => b.key)).toEqual(["earlier", "today"]);
  });
});
