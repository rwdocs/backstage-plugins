import { sectionRefOf } from "./types";

describe("sectionRefOf", () => {
  it("returns the section ref verbatim, including a non-default root namespace", () => {
    expect(sectionRefOf("system:default/payments#api/v2")).toBe("system:default/payments");
    expect(sectionRefOf("section:default/root#about")).toBe("section:default/root");
    expect(sectionRefOf("section:payments/root#x")).toBe("section:payments/root"); // no default-collapse
  });

  it("returns the whole string when there is no '#' fragment (total accessor)", () => {
    expect(sectionRefOf("system:default/payments")).toBe("system:default/payments");
  });
});
