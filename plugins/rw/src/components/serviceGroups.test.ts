import { groupByServiceAndDay } from "./serviceGroups";
import type { LatestChangeItem } from "../api/RwClient";

const DAY = 86_400_000;

const item = (entityRef: string, title: string, msAgo: number): LatestChangeItem => ({
  entityRef,
  viewerPath: `docs/${title}`,
  title,
  lastModified: new Date(Date.now() - msAgo).toISOString(),
});

describe("groupByServiceAndDay", () => {
  it("keeps a service's same-day changes in one group", () => {
    const groups = groupByServiceAndDay([
      item("component:default/search", "a", 1000),
      item("component:default/search", "b", 2000),
      item("component:default/search", "c", 3000),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entityRef).toBe("component:default/search");
    expect(groups[0].items.map((i) => i.title)).toEqual(["a", "b", "c"]);
  });

  it("splits a service's changes on different days into separate groups", () => {
    const groups = groupByServiceAndDay([
      item("component:default/arch", "recent", 1000), // today
      item("component:default/arch", "older", 10 * DAY), // ~10 days ago
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.entityRef)).toEqual([
      "component:default/arch",
      "component:default/arch",
    ]);
    expect(groups[0].items.map((i) => i.title)).toEqual(["recent"]);
    expect(groups[1].items.map((i) => i.title)).toEqual(["older"]);
  });

  it("keeps a lone change as a single-item group", () => {
    const groups = groupByServiceAndDay([item("component:default/airflow", "Airflow", 1000)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
  });

  it("orders groups by first appearance (recency), preserving item order within", () => {
    const groups = groupByServiceAndDay([
      item("component:default/search", "s1", 1000),
      item("component:default/admin", "a1", 2000),
      item("component:default/search", "s2", 3000),
    ]);
    // All same day, so `search` groups into one entry; it's seen first, so it
    // leads, and its two pages stay in list order even though an `admin` change
    // fell between them in time.
    expect(groups.map((g) => g.entityRef)).toEqual([
      "component:default/search",
      "component:default/admin",
    ]);
    expect(groups[0].items.map((i) => i.title)).toEqual(["s1", "s2"]);
    expect(groups[1].items.map((i) => i.title)).toEqual(["a1"]);
  });

  it("returns an empty array for an empty list", () => {
    expect(groupByServiceAndDay([])).toEqual([]);
  });
});
