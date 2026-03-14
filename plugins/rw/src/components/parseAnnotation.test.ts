import { parseAnnotation } from "./parseAnnotation";

describe("parseAnnotation", () => {
  it("parses self-ref with no scope", () => {
    expect(parseAnnotation(".", "component/default/my-service")).toEqual({
      entityRef: "component/default/my-service",
      scope: undefined,
    });
  });

  it("parses explicit entity ref with no scope", () => {
    expect(
      parseAnnotation("component:default/arch", "component/default/my-service"),
    ).toEqual({
      entityRef: "component/default/arch",
      scope: undefined,
    });
  });

  it("parses explicit entity ref with scope", () => {
    expect(
      parseAnnotation(
        "component:default/arch#domains/billing",
        "component/default/my-service",
      ),
    ).toEqual({
      entityRef: "component/default/arch",
      scope: "domains/billing",
    });
  });

  it("parses self-ref with scope", () => {
    expect(parseAnnotation(".#domains/billing", "component/default/my-service")).toEqual({
      entityRef: "component/default/my-service",
      scope: "domains/billing",
    });
  });

  it("handles deeply nested scope", () => {
    expect(
      parseAnnotation(
        "component:default/arch#domains/billing/systems/wallets",
        "component/default/x",
      ),
    ).toEqual({
      entityRef: "component/default/arch",
      scope: "domains/billing/systems/wallets",
    });
  });

  it("uses default namespace when not specified", () => {
    expect(parseAnnotation("component:arch", "component/default/x")).toEqual({
      entityRef: "component/default/arch",
      scope: undefined,
    });
  });

  it("returns undefined for empty string", () => {
    expect(parseAnnotation("", "component/default/x")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(parseAnnotation(undefined, "component/default/x")).toBeUndefined();
  });

  it("returns undefined for malformed entity ref", () => {
    expect(parseAnnotation(":::", "component/default/x")).toBeUndefined();
  });

  it("treats empty hash as no scope", () => {
    expect(parseAnnotation("component:default/arch#", "component/default/x")).toEqual({
      entityRef: "component/default/arch",
      scope: undefined,
    });
  });
});
