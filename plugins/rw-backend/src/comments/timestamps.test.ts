import { toIso } from "./timestamps";

describe("toIso", () => {
  it("formats a JS Date (pg driver) to RFC3339", () => {
    const d = new Date("2026-06-21T06:30:00.000Z");
    expect(toIso(d)).toBe("2026-06-21T06:30:00.000Z");
  });

  it("parses an ISO string (sqlite) to RFC3339", () => {
    expect(toIso("2026-06-21T06:30:00.000Z")).toBe("2026-06-21T06:30:00.000Z");
  });

  it('parses a SQL datetime string ("YYYY-MM-DD HH:MM:SS", sqlite) as UTC', () => {
    expect(toIso("2026-06-21 06:30:00")).toBe("2026-06-21T06:30:00.000Z");
  });

  it("converts an epoch-millis number to RFC3339", () => {
    expect(toIso(new Date("2026-06-21T06:30:00.000Z").getTime())).toBe("2026-06-21T06:30:00.000Z");
  });

  it("returns undefined for null/undefined", () => {
    expect(toIso(null)).toBeUndefined();
    expect(toIso(undefined)).toBeUndefined();
  });
});
