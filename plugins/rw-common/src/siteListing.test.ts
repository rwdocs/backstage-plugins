import { projectSiteListing } from "./siteListing";

const root = "section:default/root";
const shared = "system:default/shared";
const independent = "component:default/independent";
const deep = "component:default/deep";
const section = (sectionRef: string, path: string, ancestors: string[] = []) => ({
  sectionRef,
  path,
  ancestors,
});
const anchor = (sectionRef: string, subpath: string) => ({ sectionRef, subpath });
const page = (
  sectionRef: string,
  subpath: string,
  path: string,
  title = path,
  anchors = [anchor(sectionRef, subpath), anchor(root, path)],
) => ({
  sectionRef,
  subpath,
  path,
  title,
  anchors,
  hasContent: true,
  lastModified: "2026-06-24T00:00:00Z",
});

function fixture() {
  return {
    sections: [
      section(root, ""),
      section(shared, "a", [root]),
      section(shared, "a-b", [root]),
      section(independent, "a-b/unique", [shared, root]),
    ],
    pages: [
      page(root, "", "", "Home", [anchor(root, "")]),
      page(shared, "", "a", "Winner"),
      page(shared, "", "a-b", "Loser"),
      page(shared, "q", "a/q", "Winner q"),
      page(shared, "q", "a-b/q", "Loser q"),
      page(shared, "only", "a-b/only", "Loser only"),
      page(independent, "p", "a-b/unique/p", "Independent p", [
        anchor(independent, "p"),
        anchor(shared, "unique/p"),
        anchor(root, "a-b/unique/p"),
      ]),
    ],
  };
}

describe("projectSiteListing", () => {
  it.each(["original", "reversed", "shuffled"])(
    "projects canonical content independent of listing order (%s)",
    async (order) => {
      const { sections, pages } = fixture();
      if (order === "reversed") {
        sections.reverse();
        pages.reverse();
      }
      if (order === "shuffled") {
        sections.push(...sections.splice(0, 2));
        pages.push(...pages.splice(0, 3));
      }
      const original = JSON.parse(JSON.stringify({ sections, pages }));
      const resolve = jest.fn().mockResolvedValue("a");
      const projected = await projectSiteListing(sections, pages, resolve);
      expect(projected.sections.find((s) => s.sectionRef === shared)?.path).toBe("a");
      expect(projected.pages.map((p) => p.path).sort()).toEqual(
        ["", "a", "a-b/unique/p", "a/q"].sort(),
      );
      expect(projected.sections.find((s) => s.sectionRef === independent)?.ancestors).toEqual([
        root,
      ]);
      expect(projected.pages.find((p) => p.path === "a-b/unique/p")?.anchors).toEqual([
        anchor(independent, "p"),
        anchor(root, "a-b/unique/p"),
      ]);
      expect(projected.pages.find((p) => p.path === "a/q")).toMatchObject({
        title: "Winner q",
        lastModified: "2026-06-24T00:00:00Z",
        hasContent: true,
      });
      expect(projected.diagnostics).toEqual({
        collidingRefs: 1,
        omittedSections: 1,
        omittedPages: 3,
      });
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve).toHaveBeenCalledWith(shared);
      expect({ sections, pages }).toEqual(original);
    },
  );

  it("filters invalid repeated-ref anchors before keeping the valid outer anchor, using directory boundaries", async () => {
    const { sections, pages } = fixture();
    sections.push(
      section(shared, "a/nested", [shared, root]),
      section(deep, "a/nested/deep", [shared, shared, root]),
      section("component:default/sibling", "a2/unique", [root]),
    );
    pages.push(
      page(deep, "p", "a/nested/deep/p", "Deep p", [
        anchor(deep, "p"),
        anchor(shared, "deep/p"),
        anchor(shared, "nested/deep/p"),
        anchor(root, "a/nested/deep/p"),
      ]),
    );
    const original = JSON.parse(JSON.stringify({ sections, pages }));
    const projected = await projectSiteListing(sections, pages, async () => "a");
    expect(projected.sections.find((s) => s.sectionRef === deep)?.ancestors).toEqual([
      shared,
      root,
    ]);
    expect(projected.sections.find((s) => s.path === "a2/unique")?.ancestors).toEqual([root]);
    expect(projected.pages.find((p) => p.sectionRef === deep)?.anchors).toEqual([
      anchor(deep, "p"),
      anchor(shared, "nested/deep/p"),
      anchor(root, "a/nested/deep/p"),
    ]);
    expect({ sections, pages }).toEqual(original);
  });

  it.each([
    ["Z", "b"],
    ["b", "Z"],
    ["é", "中"],
    ["中", "é"],
    ["", "a"],
  ])("delegates the winner exactly to the resolver: %s over %s", async (winner, loser) => {
    for (const sections of [
      [section(shared, winner), section(shared, loser)],
      [section(shared, loser), section(shared, winner)],
    ]) {
      const result = await projectSiteListing(
        sections,
        [page(shared, "", winner), page(shared, "", loser)],
        async () => winner,
      );
      expect(result.sections.map((s) => s.path)).toEqual([winner]);
      expect(result.pages.map((p) => p.path)).toEqual([winner]);
    }
  });

  it.each([null, "not-listed"])(
    "rejects inconsistent canonical resolution %s with the ref",
    async (result) => {
      const { sections, pages } = fixture();
      await expect(projectSiteListing(sections, pages, async () => result)).rejects.toThrow(
        `Cannot resolve canonical section root for ${shared}`,
      );
    },
  );

  it("propagates resolver rejection", async () => {
    const { sections, pages } = fixture();
    const error = new Error("lookup failed");
    await expect(
      projectSiteListing(sections, pages, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it("never resolves unique refs and removes anchors and pages with unknown roots", async () => {
    const resolve = jest.fn();
    const result = await projectSiteListing(
      [section(root, "")],
      [page(root, "p", "p", "P", [anchor(shared, "p"), anchor(root, "p")]), page(shared, "q", "q")],
      resolve,
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].anchors).toEqual([anchor(root, "p")]);
    expect(result.diagnostics).toEqual({ collidingRefs: 0, omittedSections: 0, omittedPages: 1 });
  });
});
