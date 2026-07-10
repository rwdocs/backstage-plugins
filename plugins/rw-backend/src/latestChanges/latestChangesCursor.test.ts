import { InputError } from "@backstage/errors";
import { encodeLatestChangesCursor, decodeLatestChangesCursor } from "./latestChangesCursor";

describe("latestChanges cursor", () => {
  it("round-trips a keyset key", () => {
    const cursor = {
      lastKey: [1_700_000_000_000, "component:default/a", "component:default/a", "guides/x"] as [
        number,
        string,
        string,
        string,
      ],
    };
    expect(decodeLatestChangesCursor(encodeLatestChangesCursor(cursor))).toEqual(cursor);
  });

  it("throws InputError on malformed base64", () => {
    expect(() => decodeLatestChangesCursor("%%%not-base64%%%")).toThrow(InputError);
  });

  it("throws InputError on a wrong-shape payload", () => {
    const bad = Buffer.from(JSON.stringify({ lastKey: [1, "a"] }), "utf8").toString("base64");
    expect(() => decodeLatestChangesCursor(bad)).toThrow(InputError);
  });
});
