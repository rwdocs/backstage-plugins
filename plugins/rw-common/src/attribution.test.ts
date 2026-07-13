import type { Entity } from "@backstage/catalog-model";
import {
  collectSiteClaims,
  nearestClaim,
  rootClaimOf,
  stripSectionPrefix,
  type SiteClaims,
} from "./attribution";

function entity(name: string, annotation: string, owner?: string, kind = "component"): Entity {
  return {
    apiVersion: "backstage.io/v1alpha1",
    kind,
    metadata: { name, namespace: "default", annotations: { "rwdocs.org/ref": annotation } },
    relations: owner ? [{ type: "ownedBy", targetRef: owner }] : [],
  } as Entity;
}

function catalogOf(entities: Entity[]) {
  return {
    queryEntities: jest.fn().mockResolvedValue({
      items: entities,
      totalItems: entities.length,
      pageInfo: {},
    }),
  } as any;
}

const credentials = { principal: "test" } as any;

async function claimsFor(entities: Entity[], onlySiteEntityPath?: string) {
  return collectSiteClaims({ catalog: catalogOf(entities), credentials, onlySiteEntityPath });
}

describe("collectSiteClaims", () => {
  it("groups entities by the site they document", async () => {
    const sites = await claimsFor([
      entity("arch", "."),
      entity("billing", "component:default/arch#domain:default/billing", undefined, "Domain"),
      entity("other", "."),
    ]);

    expect([...sites.keys()]).toEqual(["component:default/arch", "component:default/other"]);
    const arch = sites.get("component:default/arch")!;
    expect(arch.entityPath).toBe("default/component/arch");
    expect(arch.host?.entityRef).toBe("component:default/arch");
    expect(arch.bySection.get("domain:default/billing")?.entityRef).toBe("domain:default/billing");
  });

  it("records the owner of each claim", async () => {
    const sites = await claimsFor([entity("arch", ".", "group:default/platform")]);

    expect(sites.get("component:default/arch")!.host).toEqual({
      entityRef: "component:default/arch",
      ownerRef: "group:default/platform",
    });
  });

  it("separates a site's host from an entity that merely points at it", async () => {
    const sites = await claimsFor([
      entity("arch", "."),
      entity("viewer", "component:default/arch"),
    ]);
    const arch = sites.get("component:default/arch")!;

    expect(arch.host?.entityRef).toBe("component:default/arch");
    expect(arch.unscoped?.entityRef).toBe("component:default/viewer");
    // A real host owns the site's unclaimed pages; a pointer only stands in for one.
    expect(rootClaimOf(arch)?.entityRef).toBe("component:default/arch");
  });

  it("falls back to an unscoped pointer when no entity hosts the site", async () => {
    const sites = await claimsFor([entity("viewer", "component:default/arch")]);

    expect(rootClaimOf(sites.get("component:default/arch")!)?.entityRef).toBe(
      "component:default/viewer",
    );
  });

  it("resolves a doubly-claimed section deterministically, and says so", async () => {
    const onWarning = jest.fn();
    const sites = await collectSiteClaims({
      // Reverse order: the winner must not depend on which the catalog yielded last,
      // since it orders by metadata.uid and that changes on re-ingestion.
      catalog: catalogOf([
        entity("zebra", "component:default/arch#domain:default/billing", undefined, "Domain"),
        entity("alpha", "component:default/arch#domain:default/billing", undefined, "Domain"),
      ]),
      credentials,
      onWarning,
    });

    const claim = sites.get("component:default/arch")!.bySection.get("domain:default/billing");
    expect(claim?.entityRef).toBe("domain:default/alpha");
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("domain:default/billing"));
  });

  it("skips an entity whose own ref cannot be a path, and says so", async () => {
    const malformed = {
      apiVersion: "backstage.io/v1alpha1",
      kind: "component",
      metadata: { name: "..", namespace: "default", annotations: { "rwdocs.org/ref": "." } },
      relations: [],
    } as Entity;
    const onWarning = jest.fn();

    const sites = await collectSiteClaims({
      catalog: catalogOf([malformed, entity("arch", ".")]),
      credentials,
      onWarning,
    });

    expect([...sites.keys()]).toEqual(["component:default/arch"]);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("component:default/.."));
  });

  it("constrains discovery to one site when asked", async () => {
    const sites = await claimsFor(
      [entity("arch", "."), entity("other", ".")],
      "default/component/arch",
    );

    expect([...sites.keys()]).toEqual(["component:default/arch"]);
  });

  it("ignores an entity whose annotation is unparseable", async () => {
    const sites = await claimsFor([entity("broken", "not a ref!")]);

    expect(sites.size).toBe(0);
  });
});

describe("nearestClaim", () => {
  const claims: SiteClaims = {
    siteRef: "component:default/arch",
    entityPath: "default/component/arch",
    bySection: new Map([
      ["domain:default/billing", { entityRef: "domain:default/billing", ownerRef: null }],
      ["system:default/pay", { entityRef: "system:default/pay", ownerRef: null }],
    ]),
    host: { entityRef: "component:default/arch", ownerRef: null },
    unscoped: undefined,
  };

  it("prefers the innermost claim in the chain", () => {
    // The chain is innermost-first, so the system wins over the domain above it.
    expect(
      nearestClaim(claims, ["system:default/pay", "domain:default/billing", "section:default/root"])
        ?.claim.entityRef,
    ).toBe("system:default/pay");
  });

  it("walks outward to the nearest claiming ancestor", () => {
    expect(
      nearestClaim(claims, ["system:default/unclaimed", "domain:default/billing"])?.claim.entityRef,
    ).toBe("domain:default/billing");
  });

  it("falls back to the site's root claim when nothing in the chain is claimed", () => {
    const owner = nearestClaim(claims, ["section:default/root"]);
    expect(owner?.claim.entityRef).toBe("component:default/arch");
    // No section claimed it, so there is no claimer path to strip.
    expect(owner?.sectionRef).toBe("");
  });

  it("returns undefined when nothing documents the site at all", () => {
    expect(nearestClaim({ ...claims, host: undefined }, ["section:default/root"])).toBeUndefined();
  });
});

describe("stripSectionPrefix", () => {
  it("makes a path relative to its claimer", () => {
    expect(stripSectionPrefix("domains/billing/systems/pay", "domains/billing")).toBe(
      "systems/pay",
    );
  });

  it("returns an empty path for the claimer's own section", () => {
    expect(stripSectionPrefix("domains/billing", "domains/billing")).toBe("");
  });

  it("only strips whole segments", () => {
    // `domains/bill` must not eat the `ing` of `domains/billing`.
    expect(stripSectionPrefix("domains/billing", "domains/bill")).toBe("domains/billing");
  });

  it("strips nothing when there is no claimer", () => {
    expect(stripSectionPrefix("domains/billing", "")).toBe("domains/billing");
  });
});
