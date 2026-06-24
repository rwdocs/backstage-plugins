import { jitteredNextUpdate, INTERVAL_MS } from "./schedule";

describe("jitteredNextUpdate", () => {
  it("stays within [0.5x, 1.5x] of the interval", () => {
    const now = new Date("2026-06-24T00:00:00Z");
    const lo = jitteredNextUpdate(now, INTERVAL_MS, () => 0).getTime() - now.getTime();
    const hi = jitteredNextUpdate(now, INTERVAL_MS, () => 1).getTime() - now.getTime();
    expect(lo).toBe(INTERVAL_MS * 0.5);
    expect(hi).toBe(INTERVAL_MS * 1.5);
  });
});
