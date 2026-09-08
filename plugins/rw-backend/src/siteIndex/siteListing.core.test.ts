import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createSite } from "@rwdocs/core";
import { projectSiteListing } from "@rwdocs/backstage-plugin-rw-common";

const root = "section:default/root";
const shared = "system:default/shared";
const independent = "component:default/independent";
const deep = "component:default/deep";
const ordering = "system:default/ordering";
const unicode = "system:default/unicode";
const winnerMarkdown = "# Winner q\n\nCanonical winner body.\n";

describe("site listing projection with real core", () => {
  it("roundtrips retained identities to canonical Markdown and physical ancestry", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "rw-site-listing-core-"));
    try {
      const write = async (path: string, markdown: string) => {
        const target = join(projectDir, "docs", path);
        await mkdir(join(target, ".."), { recursive: true });
        await writeFile(target, markdown);
      };
      const section = async (path: string, kind: string, name: string, title: string) => {
        await write(
          path ? `${path}/index.md` : "index.md",
          `---\nkind: ${kind}\nname: ${name}\ntitle: ${title}\n---\n# ${title}\n`,
        );
      };
      await writeFile(join(projectDir, "rw.toml"), "");
      await section("", "section", "root", "Home");
      await section("a", "system", "shared", "Winner");
      await section("a-b", "system", "shared", "Loser");
      await section("a/nested", "system", "shared", "Nested loser");
      await section("a-b/unique", "component", "independent", "Independent");
      await section("a/nested/deep", "component", "deep", "Deep");
      await write("a/q.md", winnerMarkdown);
      await write("a-b/q.md", "# Loser q\n\nWrong body.\n");
      await write("a-b/only.md", "# Loser only\n");
      await write("a-b/unique/p.md", "# Independent p\n");
      await write("a/nested/deep/p.md", "# Deep p\n");
      // Distinct even on Darwin's case-insensitive filesystem. These roots expose
      // byte ordering that a locale comparator in the projection would override.
      await section("Z", "system", "ordering", "Ordering winner");
      await section("b", "system", "ordering", "Ordering loser");
      await section("z-unicode", "system", "unicode", "Unicode winner");
      await section("é-unicode", "system", "unicode", "Unicode loser");

      const site = createSite({ projectDir });
      const [sections, pages] = await Promise.all([site.listSections(), site.listPages()]);
      expect(
        sections
          .filter((s) => s.sectionRef === shared)
          .map((s) => s.path)
          .sort(),
      ).toEqual(["a", "a-b", "a/nested"].sort());
      await expect(site.pagePathFor(shared, "")).resolves.toBe("a");
      await expect(site.pagePathFor(ordering, "")).resolves.toBe("Z");
      await expect(site.pagePathFor(unicode, "")).resolves.toBe("z-unicode");
      expect(pages.find((p) => p.path === "a/nested/deep/p")?.anchors).toEqual([
        { sectionRef: deep, subpath: "p" },
        { sectionRef: shared, subpath: "deep/p" },
        { sectionRef: shared, subpath: "nested/deep/p" },
        { sectionRef: root, subpath: "a/nested/deep/p" },
      ]);
      const projected = await projectSiteListing(sections, pages, (ref) =>
        site.pagePathFor(ref, ""),
      );
      expect(projected.pages.map((p) => p.path).sort()).toEqual(
        [
          "",
          "a",
          "a/q",
          "a-b/unique",
          "a-b/unique/p",
          "a/nested/deep",
          "a/nested/deep/p",
          "Z",
          "z-unicode",
        ].sort(),
      );
      expect(
        pages
          .filter((p) => !projected.pages.some((retained) => retained.path === p.path))
          .map((p) => p.path)
          .sort(),
      ).toEqual(["a-b", "a-b/q", "a-b/only", "a/nested", "b", "é-unicode"].sort());
      expect(projected.diagnostics).toEqual({
        collidingRefs: 3,
        omittedSections: 4,
        omittedPages: 6,
      });
      expect(projected.sections.find((s) => s.sectionRef === independent)?.ancestors).toEqual([
        root,
      ]);
      expect(projected.sections.find((s) => s.sectionRef === deep)?.ancestors).toEqual([
        shared,
        root,
      ]);
      expect(projected.pages.find((p) => p.path === "a-b/unique/p")?.anchors).toEqual([
        { sectionRef: independent, subpath: "p" },
        { sectionRef: root, subpath: "a-b/unique/p" },
      ]);
      expect(projected.pages.find((p) => p.path === "a/nested/deep/p")?.anchors).toEqual([
        { sectionRef: deep, subpath: "p" },
        { sectionRef: shared, subpath: "nested/deep/p" },
        { sectionRef: root, subpath: "a/nested/deep/p" },
      ]);
      for (const page of projected.pages) {
        await expect(site.pagePathFor(page.sectionRef, page.subpath)).resolves.toBe(page.path);
        const markdown = await site.getPageMarkdown(page.path);
        expect(markdown).not.toBeNull();
      }
      const qPath = await site.pagePathFor(shared, "q");
      expect(qPath).toBe("a/q");
      await expect(site.getPageMarkdown(qPath!)).resolves.toEqual({ markdown: winnerMarkdown });
      const reversed = await projectSiteListing(
        [...sections].reverse(),
        [...pages].reverse(),
        (ref) => site.pagePathFor(ref, ""),
      );
      expect(reversed.pages.map((p) => p.path).sort()).toEqual(
        projected.pages.map((p) => p.path).sort(),
      );
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
