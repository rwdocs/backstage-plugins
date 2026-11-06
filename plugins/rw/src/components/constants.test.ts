import { entityDocsPath } from "./constants";

const entityRoute = ({
  kind,
  namespace,
  name,
}: {
  kind: string;
  namespace: string;
  name: string;
}) => `/catalog/${namespace}/${kind}/${name}`;

describe("entityDocsPath", () => {
  it("uses catalog defaults and normalization for entities", () => {
    expect(
      entityDocsPath(entityRoute, {
        apiVersion: "backstage.io/v1alpha1",
        kind: "Component",
        metadata: { name: "my-docs" },
      }),
    ).toBe("/catalog/default/component/my-docs/docs");
  });

  it("accepts entity refs without inventing a separate route representation", () => {
    expect(entityDocsPath(entityRoute, "System:Payments/gateway")).toBe(
      "/catalog/payments/system/gateway/docs",
    );
  });

  it("encodes catalog parameters without encoding the RW tab suffix", () => {
    expect(
      entityDocsPath(entityRoute, { kind: "Component", namespace: "Team", name: "my docs#100%" }),
    ).toBe("/catalog/team/component/my%20docs%23100%25/docs");
  });
});
