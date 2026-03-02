import rwPlugin, { rwApiRef, RwClient } from "./index";

describe("rwPlugin", () => {
  it("has correct pluginId", () => {
    expect(rwPlugin).toBeDefined();
    expect(rwPlugin.toString()).toContain("rw");
  });

  it("exports rwApiRef with correct id", () => {
    expect(rwApiRef).toBeDefined();
    expect(rwApiRef.id).toBe("plugin.rw.api");
  });

  it("exports RwClient class", () => {
    expect(RwClient).toBeDefined();
    expect(typeof RwClient).toBe("function");
  });
});
