import rwPlugin, { rwApiRef, RwClient } from "./index";
import { docsRouteRef, commentInboxRouteRef } from "./plugin";

// FrontendPlugin's public type doesn't expose `extensions` (runtime-only), so
// read it through a precise local cast (no `any`) to assert the plugin's wiring.
const extensionIds = (): string[] =>
  (rwPlugin as unknown as { extensions: ReadonlyArray<{ id: string }> }).extensions.map(
    (e) => e.id,
  );

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

  it("mounts the Docs page and the Comments sub-page", () => {
    const ids = extensionIds();
    expect(ids).toContain("page:rw/docs");
    expect(ids).toContain("sub-page:rw/comments");
  });

  it("drops the standalone comment-inbox page and the legacy nav-item extension", () => {
    const ids = extensionIds();
    expect(ids).not.toContain("page:rw/comment-inbox");
    expect(ids).not.toContain("rw/comment-inbox-nav-item");
  });

  it("exports the docs and comment-inbox route refs as two distinct refs", () => {
    // The import above already proves both are exported (a missing export would
    // fail module load). The substantive invariant is that they are *distinct*
    // refs: a copy-paste wiring the same ref to both the page and the sub-page
    // would break /docs/comments resolution, and would fail here.
    expect(docsRouteRef).not.toBe(commentInboxRouteRef);
  });
});
