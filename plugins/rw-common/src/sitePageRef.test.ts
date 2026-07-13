import { parseSitePageRef, stringifySitePageRef, SitePageRef } from "./sitePageRef";

const NESTED: SitePageRef = {
  siteRef: "component:default/platform",
  sectionRef: "section:default/handbook",
  subpath: "setup/install",
};
const ROOT: SitePageRef = {
  siteRef: "component:default/platform",
  sectionRef: "section:default/handbook",
  subpath: "",
};

describe("stringifySitePageRef", () => {
  it("joins the three parts with '#'", () => {
    expect(stringifySitePageRef(NESTED)).toBe(
      "component:default/platform#section:default/handbook#setup/install",
    );
  });

  it("omits the trailing separator for a section root", () => {
    expect(stringifySitePageRef(ROOT)).toBe("component:default/platform#section:default/handbook");
  });

  it("normalizes the site ref", () => {
    expect(stringifySitePageRef({ ...ROOT, siteRef: "Component:Default/Platform" })).toBe(
      "component:default/platform#section:default/handbook",
    );
  });

  it("defaults an omitted namespace in the site ref", () => {
    expect(stringifySitePageRef({ ...ROOT, siteRef: "component:platform" })).toBe(
      "component:default/platform#section:default/handbook",
    );
  });

  it("keeps a '#' inside the subpath", () => {
    expect(stringifySitePageRef({ ...NESTED, subpath: "a#b" })).toBe(
      "component:default/platform#section:default/handbook#a#b",
    );
  });

  it("throws on an invalid site ref", () => {
    expect(() => stringifySitePageRef({ ...ROOT, siteRef: "not-an-entity-ref" })).toThrow(
      /is not a valid entity ref/,
    );
  });

  it("throws on an empty section ref", () => {
    expect(() => stringifySitePageRef({ ...ROOT, sectionRef: "" })).toThrow(/section ref is empty/);
  });

  it("throws on a section ref containing '#'", () => {
    expect(() => stringifySitePageRef({ ...ROOT, sectionRef: "a#b" })).toThrow(
      /section ref ".*" contains "#"/,
    );
  });

  it("throws on a site ref containing '#'", () => {
    expect(() => stringifySitePageRef({ ...ROOT, siteRef: "component:default/a#b" })).toThrow(
      /site ref ".*" contains "#"/,
    );
  });
});

describe("parseSitePageRef", () => {
  it("splits the three parts", () => {
    expect(
      parseSitePageRef("component:default/platform#section:default/handbook#setup/install"),
    ).toEqual(NESTED);
  });

  it("reads a two-part ref as a section root", () => {
    expect(parseSitePageRef("component:default/platform#section:default/handbook")).toEqual(ROOT);
  });

  it("reads a trailing separator as a section root", () => {
    expect(parseSitePageRef("component:default/platform#section:default/handbook#")).toEqual(ROOT);
  });

  it("keeps a '#' inside the subpath", () => {
    expect(parseSitePageRef("component:default/platform#section:default/handbook#a#b")).toEqual({
      ...NESTED,
      subpath: "a#b",
    });
  });

  it("normalizes the site ref", () => {
    expect(parseSitePageRef("Component:Default/Platform#section:default/handbook")).toEqual(ROOT);
  });

  it("defaults an omitted namespace in the site ref", () => {
    expect(parseSitePageRef("component:platform#section:default/handbook")).toEqual(ROOT);
  });

  it("does not reject '..' in the subpath (the /markdown route owns that check)", () => {
    expect(
      parseSitePageRef("component:default/platform#section:default/handbook#../../etc/passwd"),
    ).toEqual({ ...NESTED, subpath: "../../etc/passwd" });
  });

  it("throws when there is no separator", () => {
    expect(() => parseSitePageRef("component:default/platform")).toThrow(/expected/);
  });

  it("throws on an invalid site ref", () => {
    expect(() => parseSitePageRef("not-an-entity-ref#section:default/handbook")).toThrow(
      /is not a valid entity ref/,
    );
  });

  it("throws on an empty site ref", () => {
    expect(() => parseSitePageRef("#section:default/handbook")).toThrow(
      /is not a valid entity ref/,
    );
  });

  it("throws on an empty section ref", () => {
    expect(() => parseSitePageRef("component:default/platform#")).toThrow(
      /has an empty section ref/,
    );
  });
});

describe("round trip", () => {
  it.each([
    ["section root", ROOT],
    ["nested page", NESTED],
    ["subpath containing '#'", { ...NESTED, subpath: "a#b" }],
    ["deep subpath", { ...NESTED, subpath: "a/b/c/d" }],
  ])("round-trips a %s", (_name, ref) => {
    expect(parseSitePageRef(stringifySitePageRef(ref as SitePageRef))).toEqual(ref);
  });

  it.each([
    "component:default/platform#section:default/handbook",
    "component:default/platform#section:default/handbook#setup/install",
    "component:default/platform#section:default/handbook#a#b",
    "component:default/platform#section:default/handbook#../../etc/passwd",
  ])("round-trips the canonical string %s", (s) => {
    expect(stringifySitePageRef(parseSitePageRef(s))).toBe(s);
  });
});
