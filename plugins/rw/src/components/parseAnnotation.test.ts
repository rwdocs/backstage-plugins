import { parseAnnotation } from "./parseAnnotation";

describe("parseAnnotation", () => {
  it("parses self-ref with no scope", () => {
    expect(parseAnnotation(".", "default/component/my-service")).toEqual({
      entityRef: "default/component/my-service",
      scope: undefined,
    });
  });

  it("parses explicit entity ref with no scope", () => {
    expect(parseAnnotation("default/component/arch", "default/component/my-service")).toEqual({
      entityRef: "default/component/arch",
      scope: undefined,
    });
  });

  it("parses explicit entity ref with scope", () => {
    expect(
      parseAnnotation("default/component/arch:domains/billing", "default/component/my-service"),
    ).toEqual({
      entityRef: "default/component/arch",
      scope: "domains/billing",
    });
  });

  it("parses self-ref with scope", () => {
    expect(parseAnnotation(".:domains/billing", "default/component/my-service")).toEqual({
      entityRef: "default/component/my-service",
      scope: "domains/billing",
    });
  });

  it("handles deeply nested scope", () => {
    expect(
      parseAnnotation(
        "default/component/arch:domains/billing/systems/wallets",
        "default/component/x",
      ),
    ).toEqual({
      entityRef: "default/component/arch",
      scope: "domains/billing/systems/wallets",
    });
  });

  it("returns undefined for empty string", () => {
    expect(parseAnnotation("", "default/component/x")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(parseAnnotation(undefined, "default/component/x")).toBeUndefined();
  });
});
