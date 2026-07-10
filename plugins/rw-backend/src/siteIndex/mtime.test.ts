import { parseMtime } from "./mtime";

describe("parseMtime", () => {
  it("parses an RFC-3339 timestamp to epoch millis", () => {
    expect(parseMtime("2026-07-09T10:35:00+00:00")).toBe(Date.parse("2026-07-09T10:35:00+00:00"));
  });

  it("returns null for the Unix epoch sentinel (unknown mtime)", () => {
    expect(parseMtime("1970-01-01T00:00:00+00:00")).toBeNull();
  });

  it("returns null for a non-positive parse result", () => {
    expect(parseMtime("1969-12-31T00:00:00+00:00")).toBeNull();
  });

  it("returns null for an unparseable string", () => {
    expect(parseMtime("not-a-date")).toBeNull();
  });

  it("returns null for undefined/null input", () => {
    expect(parseMtime(undefined)).toBeNull();
    expect(parseMtime(null)).toBeNull();
  });
});
