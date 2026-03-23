import { toEntityPath, fromEntityPath } from "./entityPath";

describe("toEntityPath", () => {
  it("converts colon format to slash format", () => {
    expect(toEntityPath("component:default/arch")).toBe("default/component/arch");
  });

  it("lowercases the result", () => {
    expect(toEntityPath("Component:Default/Arch")).toBe("default/component/arch");
  });

  it("defaults namespace to 'default' when omitted", () => {
    expect(toEntityPath("component:arch")).toBe("default/component/arch");
  });

  it("throws on invalid entity ref", () => {
    expect(() => toEntityPath("")).toThrow();
  });
});

describe("fromEntityPath", () => {
  it("converts slash format to colon format", () => {
    expect(fromEntityPath("default/component/arch")).toBe("component:default/arch");
  });

  it("round-trips with toEntityPath", () => {
    const original = "component:default/arch";
    expect(fromEntityPath(toEntityPath(original))).toBe(original);
  });

  it("throws on path with too few segments", () => {
    expect(() => fromEntityPath("default/component")).toThrow(/Invalid entity path/);
  });

  it("throws on path with too many segments", () => {
    expect(() => fromEntityPath("default/component/arch/extra")).toThrow(/Invalid entity path/);
  });

  it("throws on path with empty segments", () => {
    expect(() => fromEntityPath("default//arch")).toThrow(/Invalid entity path/);
  });
});
