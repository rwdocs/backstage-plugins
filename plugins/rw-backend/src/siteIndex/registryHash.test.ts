import { registryHash } from "./registryHash";
import type { SectionRow } from "./types";

const section = (over: Partial<SectionRow> = {}): SectionRow => ({
  site_ref: "a",
  section_ref: "s1",
  section_path: "",
  parent_section_ref: null,
  entity_ref: "a",
  entity_owner_ref: null,
  ...over,
});

describe("registryHash", () => {
  it("is stable for identical input and changes when content changes", () => {
    const sections = [section()];
    const pages = [
      { site_ref: "a", section_ref: "s1", subpath: "", title: "Home", last_modified: null },
    ];
    const h1 = registryHash(sections, pages);
    expect(registryHash(sections, pages)).toBe(h1);
    expect(registryHash(sections, [{ ...pages[0], title: "Changed" }])).not.toBe(h1);
    expect(registryHash([section({ section_path: "changed" })], pages)).not.toBe(h1);
  });

  it("changes when a section's effective ownership changes even if pages do not", () => {
    const pages = [
      { site_ref: "a", section_ref: "s1", subpath: "", title: "Home", last_modified: null },
    ];
    const a = registryHash([section({ entity_owner_ref: "o1", entity_ref: "e1" })], pages);
    const b = registryHash([section({ entity_owner_ref: "o2", entity_ref: "e2" })], pages);
    expect(a).not.toBe(b);
  });

  it("is order-sensitive for sections (proving why the call site must sort)", () => {
    const pages = [
      { site_ref: "a", section_ref: "s1", subpath: "", title: "Home", last_modified: null },
    ];
    const rowA = section({ section_ref: "a", section_path: "a" });
    const rowB = section({ section_ref: "b", section_path: "b" });
    const h1 = registryHash([rowA, rowB], pages);
    const h2 = registryHash([rowB, rowA], pages);
    // registryHash is intentionally order-sensitive; the caller (runWorker) must sort before calling
    expect(h1).not.toBe(h2);
  });
});
