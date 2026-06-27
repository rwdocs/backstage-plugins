import { sectionRefOf, subpathOf } from "./types";

describe("subpathOf", () => {
  it("returns the part after # when present", () => {
    expect(subpathOf("section:default/root#guide")).toBe("guide");
  });

  it("returns empty string when no # is present", () => {
    expect(subpathOf("section:default/root")).toBe("");
  });

  it("handles pageRef with multiple # by slicing at the first one", () => {
    expect(subpathOf("section:default/root#guide#extra")).toBe("guide#extra");
  });
});

describe("sectionRefOf", () => {
  it("returns the section ref verbatim, including a non-default root namespace", () => {
    expect(sectionRefOf("system:default/payments#api/v2")).toBe("system:default/payments");
    expect(sectionRefOf("section:default/root#about")).toBe("section:default/root");
    expect(sectionRefOf("section:payments/root#x")).toBe("section:payments/root"); // no default-collapse
  });

  it("returns the whole pageRef when there is no fragment", () => {
    expect(sectionRefOf("section:default/root")).toBe("section:default/root");
  });

  it("returns empty string when the pageRef begins with the fragment separator", () => {
    expect(sectionRefOf("#frag")).toBe("");
  });
});
