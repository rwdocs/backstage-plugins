import { toEntityPath } from "./entityPath";

describe("toEntityPath", () => {
  it("converts colon format to slash format", () => {
    expect(toEntityPath("component:default/arch")).toBe("component/default/arch");
  });

  it("passes through already-normalized slash format", () => {
    expect(toEntityPath("component/default/arch")).toBe("component/default/arch");
  });

  it("lowercases the result", () => {
    expect(toEntityPath("Component:Default/Arch")).toBe("component/default/arch");
  });

  it("defaults namespace to 'default' when omitted", () => {
    expect(toEntityPath("component:arch")).toBe("component/default/arch");
  });

  it("throws on invalid entity ref", () => {
    expect(() => toEntityPath("")).toThrow();
  });
});
