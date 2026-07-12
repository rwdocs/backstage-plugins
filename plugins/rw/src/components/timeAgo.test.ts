import { groupDayLabel } from "./timeAgo";

describe("groupDayLabel", () => {
  // Sunday, 12 Jul 2026, local noon.
  const now = new Date(2026, 6, 12, 12, 0, 0).getTime();
  const label = (y: number, m: number, d: number) =>
    groupDayLabel(new Date(y, m, d, 10, 0, 0).toISOString(), now);

  it("labels the day before as Yesterday", () => {
    expect(label(2026, 6, 11)).toBe("Yesterday");
  });

  it("distinguishes different days that bare relative time would blur", () => {
    // Both Jul 7 and Jul 8 read "4–5d ago" relatively; the labels must differ.
    expect(label(2026, 6, 8)).not.toBe(label(2026, 6, 7));
  });

  it("labels an older change with a date, not a relative time", () => {
    const old = label(2026, 3, 1); // 1 Apr 2026
    expect(old).not.toMatch(/ago/);
    expect(old).not.toBe("Yesterday");
  });

  it("still shows relative time for today", () => {
    // groupDayLabel defers to relativeTime for same-day changes.
    expect(groupDayLabel(new Date(Date.now() - 2 * 60 * 1000).toISOString())).toMatch(
      /ago|just now/,
    );
  });
});
