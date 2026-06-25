import { iterateAnnotatedEntities, RW_ANNOTATION } from "./iterateAnnotatedEntities";

function entity(name: string) {
  return { kind: "Component", metadata: { name, annotations: { [RW_ANNOTATION]: "." } } } as any;
}

describe("iterateAnnotatedEntities", () => {
  it("pages through the catalog via cursor", async () => {
    const calls: { req: any; opts: any }[] = [];
    const catalog = {
      queryEntities: async (req: any, opts: any) => {
        calls.push({ req, opts });
        if (!("cursor" in req)) {
          return { items: [entity("a")], pageInfo: { nextCursor: "c1" }, totalItems: 2 };
        }
        return { items: [entity("b")], pageInfo: {}, totalItems: 2 };
      },
    };
    const seen: string[] = [];
    for await (const { entity: e } of iterateAnnotatedEntities(catalog as any, {} as any)) {
      seen.push(e.metadata.name);
    }
    expect(seen).toEqual(["a", "b"]);
    expect(calls[0].req.filter).toEqual({
      [`metadata.annotations.${RW_ANNOTATION}`]: expect.anything(),
    });
    expect(calls[1].req).toEqual({ cursor: "c1" });
    expect(calls[0].opts).toEqual({ credentials: {} });
  });

  it("yields nothing and stops after one page when the catalog is empty", async () => {
    const catalog = {
      queryEntities: jest.fn().mockResolvedValue({ items: [], pageInfo: {} }),
    };
    const out: string[] = [];
    for await (const { entity: e } of iterateAnnotatedEntities(catalog as any, {} as any)) {
      out.push(e.metadata.name);
    }
    expect(out).toEqual([]);
    expect(catalog.queryEntities).toHaveBeenCalledTimes(1);
  });
});
