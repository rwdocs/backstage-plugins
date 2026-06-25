import { registryHash } from "./registryHash";

describe("registryHash", () => {
  it("is stable for identical input and changes when content changes", () => {
    const sections = [
      {
        site_ref: "a",
        section_ref: "s1",
        section_path: "",
        parent_section_ref: null,
        entity_ref: "a",
        entity_owner_ref: null,
      },
    ];
    const pages = [{ site_ref: "a", section_ref: "s1", subpath: "", title: "Home" }];
    const h1 = registryHash(sections, pages);
    expect(registryHash(sections, pages)).toBe(h1);
    expect(registryHash(sections, [{ ...pages[0], title: "Changed" }])).not.toBe(h1);
    expect(registryHash([{ ...sections[0], section_path: "changed" }], pages)).not.toBe(h1);
  });
});
