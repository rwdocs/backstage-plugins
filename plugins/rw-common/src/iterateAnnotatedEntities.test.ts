import { CATALOG_FILTER_EXISTS } from "@backstage/catalog-client";
import { iterateAnnotatedEntities, RW_ANNOTATION } from "./iterateAnnotatedEntities";

function entity(name: string) {
  return { kind: "Component", metadata: { name, annotations: { [RW_ANNOTATION]: "." } } } as any;
}

describe("iterateAnnotatedEntities", () => {
  it("passes the annotation filter and credentials and flattens batches", async () => {
    const a = entity("a");
    const b = entity("b");
    const credentials = { principal: "test" } as any;
    const catalog = {
      streamEntities: jest.fn(async function* batches() {
        yield [a];
        yield [];
        yield [b];
      }),
    };
    const seen = [];
    for await (const item of iterateAnnotatedEntities(catalog, credentials)) {
      seen.push(item);
    }
    expect(seen).toEqual([{ entity: a }, { entity: b }]);
    expect(catalog.streamEntities).toHaveBeenCalledTimes(1);
    expect(catalog.streamEntities).toHaveBeenCalledWith(
      { filter: { [`metadata.annotations.${RW_ANNOTATION}`]: CATALOG_FILTER_EXISTS } },
      { credentials },
    );
  });
});
