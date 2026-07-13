import { toEntityPath, fromEntityPath } from "./entityPath";
import { InputError } from "@backstage/errors";

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

  it("accepts a compound ref object", () => {
    expect(toEntityPath({ kind: "component", namespace: "default", name: "arch" })).toBe(
      "default/component/arch",
    );
  });

  it("defaults namespace to 'default' for compound ref object", () => {
    expect(toEntityPath({ kind: "component", name: "arch" })).toBe("default/component/arch");
  });

  it("throws on invalid entity ref", () => {
    expect(() => toEntityPath("")).toThrow();
  });

  it("rejects a name that would traverse", () => {
    expect(() => toEntityPath("component:default/..")).toThrow(InputError);
  });

  it("rejects a namespace that would traverse", () => {
    expect(() => toEntityPath("component:../arch")).toThrow(InputError);
  });

  it("rejects a traversing segment in a compound ref", () => {
    expect(() => toEntityPath({ kind: "..", namespace: "default", name: "arch" })).toThrow(
      InputError,
    );
  });

  it("rejects a name containing a slash", () => {
    expect(() => toEntityPath({ kind: "component", namespace: "default", name: "a/b" })).toThrow(
      InputError,
    );
  });

  it("rejects a name starting with a dot", () => {
    expect(() =>
      toEntityPath({ kind: "component", namespace: "default", name: ".hidden" }),
    ).toThrow(InputError);
  });

  it("accepts names with dots, dashes and underscores", () => {
    expect(toEntityPath("component:default/my-site_v2.0")).toBe("default/component/my-site_v2.0");
  });

  it("defaults an empty namespace to default", () => {
    expect(toEntityPath({ kind: "component", namespace: "", name: "arch" })).toBe(
      "default/component/arch",
    );
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
    // Caught by the empty-segment rule (assertSegment), not the arity check
    // above, since split("/") still yields 3 parts for "default//arch".
    expect(() => fromEntityPath("default//arch")).toThrow(/Invalid entity kind/);
  });

  it("rejects a traversing name segment", () => {
    expect(() => fromEntityPath("default/component/..")).toThrow(InputError);
  });

  it("rejects a traversing namespace segment", () => {
    expect(() => fromEntityPath("../component/arch")).toThrow(InputError);
  });
});
