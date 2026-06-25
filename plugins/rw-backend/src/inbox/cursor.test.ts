import { InputError } from "@backstage/errors";
import { encodeCursor, decodeCursor, type InboxCursor } from "./cursor";

const sample: InboxCursor = {
  filter: "unanswered",
  sort: "oldest",
  lastKey: [1739000000000, "0190a1b2-c3d4-7000-8000-000000000001"],
  openCount: 107,
  unansweredCount: 80,
};

describe("inbox cursor", () => {
  it("round-trips through base64", () => {
    expect(decodeCursor(encodeCursor(sample))).toEqual(sample);
  });

  it("preserves a numeric keyset value as a number", () => {
    const decoded = decodeCursor(encodeCursor(sample));
    expect(typeof decoded.lastKey[0]).toBe("number");
  });

  it("preserves a string keyset value (sqlite/pg)", () => {
    const strKey: InboxCursor = { ...sample, lastKey: ["2026-06-25T10:00:00.000Z", "id-1"] };
    expect(decodeCursor(encodeCursor(strKey)).lastKey[0]).toBe("2026-06-25T10:00:00.000Z");
  });

  it("throws InputError on non-base64 / non-JSON", () => {
    expect(() => decodeCursor("!!!not base64 json!!!")).toThrow(InputError);
    expect(() => decodeCursor("!!!not base64 json!!!")).toThrow(/malformed/i);
  });

  it("throws InputError on a structurally invalid cursor", () => {
    const bad = Buffer.from(JSON.stringify({ filter: "nope" }), "utf8").toString("base64");
    expect(() => decodeCursor(bad)).toThrow(InputError);
  });
});
