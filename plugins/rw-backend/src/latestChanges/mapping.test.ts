import { toLatestChangeItem } from "./mapping";
import type { LatestChangeRow } from "./LatestChangesStore";

function baseRow(overrides?: Partial<LatestChangeRow>): LatestChangeRow {
  return {
    site_ref: "component:default/s",
    section_ref: "component:default/s",
    subpath: "guides/a",
    title: "A",
    last_modified: 1_700_000_000_000,
    entity_ref: "component:default/owner",
    section_path: "docs",
    ...overrides,
  };
}

describe("toLatestChangeItem", () => {
  it("normalises a string last_modified (pg-bigint driver value) to a correct ISO date", () => {
    const row = baseRow({ last_modified: "1700000000000" });
    const item = toLatestChangeItem(row);
    expect(item).toEqual({
      entityRef: "component:default/owner",
      viewerPath: "docs/guides/a",
      title: "A",
      lastModified: new Date(1_700_000_000_000).toISOString(),
    });
  });

  it("produces a bare subpath viewerPath (no leading slash) when section_path is empty", () => {
    const row = baseRow({ section_path: "", subpath: "a" });
    const item = toLatestChangeItem(row);
    expect(item.viewerPath).toBe("a");
  });

  it("joins section_path and subpath for a normal row", () => {
    const row = baseRow({ section_path: "docs/guides", subpath: "deploy" });
    const item = toLatestChangeItem(row);
    expect(item).toEqual({
      entityRef: "component:default/owner",
      viewerPath: "docs/guides/deploy",
      title: "A",
      lastModified: new Date(1_700_000_000_000).toISOString(),
    });
  });
});
