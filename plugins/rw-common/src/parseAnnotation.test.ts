import { parseAnnotation } from "./parseAnnotation";

describe("parseAnnotation", () => {
  describe("without selfEntityPath", () => {
    it("parses a full entity ref without section", () => {
      const result = parseAnnotation("component:default/arch");
      expect(result).toEqual({
        entityPath: "default/component/arch",
        entityRef: "component:default/arch",
        sectionRef: undefined,
      });
    });

    it("parses a full entity ref with section", () => {
      const result = parseAnnotation("component:default/arch#domains/billing");
      expect(result).toEqual({
        entityPath: "default/component/arch",
        entityRef: "component:default/arch",
        sectionRef: "domains/billing",
      });
    });

    it("parses a short entity ref (defaults namespace)", () => {
      const result = parseAnnotation("component:my-docs");
      expect(result).toEqual({
        entityPath: "default/component/my-docs",
        entityRef: "component:default/my-docs",
        sectionRef: undefined,
      });
    });

    it("returns undefined for empty value", () => {
      expect(parseAnnotation(undefined)).toBeUndefined();
      expect(parseAnnotation("")).toBeUndefined();
    });

    it("returns undefined for unparseable value", () => {
      expect(parseAnnotation("///invalid///")).toBeUndefined();
    });

    it("ignores empty section after hash", () => {
      const result = parseAnnotation("component:default/arch#");
      expect(result).toEqual({
        entityPath: "default/component/arch",
        entityRef: "component:default/arch",
        sectionRef: undefined,
      });
    });

    it("returns undefined for self-ref without selfEntityPath", () => {
      expect(parseAnnotation(".")).toBeUndefined();
      expect(parseAnnotation(".#section")).toBeUndefined();
    });
  });

  describe("with selfEntityPath", () => {
    it("parses self-ref with no sectionRef", () => {
      expect(parseAnnotation(".", "default/component/my-service")).toEqual({
        entityPath: "default/component/my-service",
        entityRef: "component:default/my-service",
        sectionRef: undefined,
      });
    });

    it("parses explicit entity ref with no sectionRef", () => {
      expect(parseAnnotation("component:default/arch", "default/component/my-service")).toEqual({
        entityPath: "default/component/arch",
        entityRef: "component:default/arch",
        sectionRef: undefined,
      });
    });

    it("parses explicit entity ref with sectionRef", () => {
      expect(
        parseAnnotation("component:default/arch#domains/billing", "default/component/my-service"),
      ).toEqual({
        entityPath: "default/component/arch",
        entityRef: "component:default/arch",
        sectionRef: "domains/billing",
      });
    });

    it("parses self-ref with sectionRef", () => {
      expect(parseAnnotation(".#domains/billing", "default/component/my-service")).toEqual({
        entityPath: "default/component/my-service",
        entityRef: "component:default/my-service",
        sectionRef: "domains/billing",
      });
    });

    it("handles deeply nested sectionRef", () => {
      expect(
        parseAnnotation(
          "component:default/arch#domains/billing/systems/wallets",
          "default/component/x",
        ),
      ).toEqual({
        entityPath: "default/component/arch",
        entityRef: "component:default/arch",
        sectionRef: "domains/billing/systems/wallets",
      });
    });

    it("uses default namespace when not specified", () => {
      expect(parseAnnotation("component:arch", "default/component/x")).toEqual({
        entityPath: "default/component/arch",
        entityRef: "component:default/arch",
        sectionRef: undefined,
      });
    });

    it("returns undefined for empty string", () => {
      expect(parseAnnotation("", "default/component/x")).toBeUndefined();
    });

    it("returns undefined for undefined input", () => {
      expect(parseAnnotation(undefined, "default/component/x")).toBeUndefined();
    });

    it("returns undefined for malformed entity ref", () => {
      expect(parseAnnotation(":::", "default/component/x")).toBeUndefined();
    });

    it("returns undefined for a self-ref whose own path is unusable", () => {
      expect(parseAnnotation(".", "default/component/..")).toBeUndefined();
    });

    it("treats empty hash as no sectionRef", () => {
      expect(parseAnnotation("component:default/arch#", "default/component/x")).toEqual({
        entityPath: "default/component/arch",
        entityRef: "component:default/arch",
        sectionRef: undefined,
      });
    });
  });
});
