import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createSite } from "@rwdocs/core";

it("preserves RW 0.2 page identities, includes and attrs across plugin read surfaces", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "rw-02-core-"));
  try {
    await mkdir(join(projectDir, "docs/guides"), { recursive: true });
    await mkdir(join(projectDir, "docs/_snippets"));
    await writeFile(join(projectDir, "rw.toml"), "");
    await writeFile(join(projectDir, "docs/index.md"), "# Home\n");
    const markdown = [
      "---",
      "kind: system",
      "name: handbook",
      "attrs:",
      "  owner: payments",
      "---",
      "# Guides",
      "",
      "::include[../_snippets/shared.md]",
      "",
      "[Download](../report.csv)",
      "",
    ].join("\n");
    await writeFile(join(projectDir, "docs/guides/README.md"), markdown);
    await writeFile(
      join(projectDir, "docs/_snippets/shared.md"),
      "Reusable operational guidance.\n",
    );
    await writeFile(join(projectDir, "docs/guides/c#.md"), "# C sharp\n");
    await writeFile(join(projectDir, "docs/report.csv"), "name,value\nexample,1\n");
    await writeFile(join(projectDir, "docs/private.csv"), "not linked\n");

    const site = createSite({ projectDir });
    const pages = await site.listPages();
    expect(pages.map((page) => page.path).sort()).toEqual(["", "guides", "guides/c#"]);
    await expect(site.pagePathFor("system:default/handbook", "")).resolves.toBe("guides");
    await expect(site.pagePathFor("system:default/handbook", "c#")).resolves.toBe("guides/c#");
    const page = await site.renderPage("guides");
    expect(page.meta).toMatchObject({
      sectionRef: "system:default/handbook",
      subpath: "",
      documentId: "system:default/handbook#",
      attrs: { owner: "payments" },
    });
    expect(page.content).toContain("Reusable operational guidance.");
    expect(page.content).toContain("/_api/files/docs/report.csv");
    const file = await site.getFile("docs/report.csv");
    expect(file?.content.toString()).toBe("name,value\nexample,1\n");
    expect(file?.headers).toMatchObject({
      "content-security-policy": "sandbox",
      "x-content-type-options": "nosniff",
      "cache-control": "no-cache",
      "content-disposition": expect.stringContaining("attachment;"),
    });
    await expect(site.getFile("docs/private.csv")).resolves.toBeNull();
    await expect(site.getFile("../outside.csv")).resolves.toBeNull();
    const search = await site.renderSearchDocument("guides");
    expect(search?.text).toContain("Reusable operational guidance.");
    await expect(site.getPageMarkdown("guides")).resolves.toEqual({ markdown });
    expect((await site.renderPage("guides/c#")).meta.documentId).toBe("system:default/handbook#c#");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});
