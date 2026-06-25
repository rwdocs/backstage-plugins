import { computeSectionRows } from "./effectiveOwnership";
import type { SectionOwnershipRow } from "./types";

const SITE = "component:default/docs";
const sections = [
  { sectionRef: "section:default/root", path: "", ancestors: [] },
  {
    sectionRef: "section:default/billing",
    path: "systems/billing",
    ancestors: ["section:default/root"],
  },
  {
    sectionRef: "section:default/billing-api",
    path: "systems/billing/api",
    ancestors: ["section:default/billing", "section:default/root"],
  },
];

it("attributes a section to its nearest claiming ancestor and relativizes the path", () => {
  const claims: SectionOwnershipRow[] = [
    {
      site_ref: SITE,
      section_ref: "section:default/billing",
      entity_ref: "domain:default/billing",
      entity_owner_ref: "group:default/billing-team",
    },
  ];
  const rows = computeSectionRows(SITE, sections, claims);
  const api = rows.find((r) => r.section_ref === "section:default/billing-api")!;
  expect(api.entity_ref).toBe("domain:default/billing");
  expect(api.entity_owner_ref).toBe("group:default/billing-team");
  expect(api.section_path).toBe("api"); // "systems/billing/api" relative to claimer "systems/billing"
  // parent_section_ref is the immediate parent (ancestors[0], nearest-first)
  expect(api.parent_section_ref).toBe("section:default/billing");
  expect(api.site_ref).toBe(SITE);

  // The direct claimer's own path is empty: stripPrefix(full, full) = ""
  const billing = rows.find((r) => r.section_ref === "section:default/billing")!;
  expect(billing.section_path).toBe("");
  expect(billing.parent_section_ref).toBe("section:default/root");

  // A root section has no parent
  const root = rows.find((r) => r.section_ref === "section:default/root")!;
  expect(root.parent_section_ref).toBeNull();
});

it("attributes to the nearest ancestor when both a near and a far ancestor are claimed", () => {
  const claims: SectionOwnershipRow[] = [
    // far ancestor: root sentinel
    {
      site_ref: SITE,
      section_ref: SITE,
      entity_ref: SITE,
      entity_owner_ref: "group:default/site-owner",
    },
    // near ancestor: billing (more specific than root)
    {
      site_ref: SITE,
      section_ref: "section:default/billing",
      entity_ref: "domain:default/billing",
      entity_owner_ref: "group:default/billing-team",
    },
  ];
  const rows = computeSectionRows(SITE, sections, claims);
  const api = rows.find((r) => r.section_ref === "section:default/billing-api")!;
  // Must resolve to the NEAR claim (billing), not the far root sentinel
  expect(api.entity_ref).toBe("domain:default/billing");
  expect(api.entity_owner_ref).toBe("group:default/billing-team");
  expect(api.section_path).toBe("api"); // relative to billing's path "systems/billing"
});

it("falls back to the site-root sentinel for unclaimed sections", () => {
  const claims: SectionOwnershipRow[] = [
    {
      site_ref: SITE,
      section_ref: SITE,
      entity_ref: SITE,
      entity_owner_ref: "group:default/site-owner",
    },
  ];
  const rows = computeSectionRows(SITE, sections, claims);
  const billing = rows.find((r) => r.section_ref === "section:default/billing")!;
  expect(billing.entity_ref).toBe(SITE);
  expect(billing.entity_owner_ref).toBe("group:default/site-owner");
  expect(billing.section_path).toBe("systems/billing"); // unchanged (site-root scope, empty prefix)
});

it("uses null owner when there is no sentinel and no claim", () => {
  const rows = computeSectionRows(SITE, sections, []);
  const root = rows.find((r) => r.section_ref === "section:default/root")!;
  expect(root.entity_ref).toBe(SITE);
  expect(root.entity_owner_ref).toBeNull();
  const billing = rows.find((r) => r.section_ref === "section:default/billing")!;
  expect(billing.entity_ref).toBe(SITE);
  expect(billing.entity_owner_ref).toBeNull();
  const billingApi = rows.find((r) => r.section_ref === "section:default/billing-api")!;
  expect(billingApi.entity_ref).toBe(SITE);
  expect(billingApi.entity_owner_ref).toBeNull();
});

it("keeps a direct claim's null owner; does not inherit the site-root sentinel owner", () => {
  const claims: SectionOwnershipRow[] = [
    // site-root sentinel with a real owner
    {
      site_ref: SITE,
      section_ref: SITE,
      entity_ref: SITE,
      entity_owner_ref: "group:default/site-owner",
    },
    // direct claim on billing whose entity has no owner relation (null owner)
    {
      site_ref: SITE,
      section_ref: "section:default/billing",
      entity_ref: "domain:default/billing",
      entity_owner_ref: null,
    },
  ];
  const rows = computeSectionRows(SITE, sections, claims);
  // The direct claim wins: billing is attributed to its entity with a null owner,
  // NOT the sentinel's owner — a claimed section is never re-owned by the site fallback.
  const billing = rows.find((r) => r.section_ref === "section:default/billing")!;
  expect(billing.entity_ref).toBe("domain:default/billing");
  expect(billing.entity_owner_ref).toBeNull();
  // Its descendant inherits the same direct claim, also with a null owner.
  const billingApi = rows.find((r) => r.section_ref === "section:default/billing-api")!;
  expect(billingApi.entity_ref).toBe("domain:default/billing");
  expect(billingApi.entity_owner_ref).toBeNull();
  // A sibling with no claim still falls back to the sentinel owner.
  const root = rows.find((r) => r.section_ref === "section:default/root")!;
  expect(root.entity_owner_ref).toBe("group:default/site-owner");
});

it("strips the claimer prefix only on a path-segment boundary, not a shared string prefix", () => {
  // billing-x shares the string prefix "systems/billing" with its claiming ancestor billing,
  // but "systems/billingX" is not under "systems/billing/" — the prefix must NOT be stripped.
  const boundarySections = [
    { sectionRef: "section:default/root", path: "", ancestors: [] },
    {
      sectionRef: "section:default/billing",
      path: "systems/billing",
      ancestors: ["section:default/root"],
    },
    {
      sectionRef: "section:default/billing-x",
      path: "systems/billingX",
      ancestors: ["section:default/billing", "section:default/root"],
    },
  ];
  const claims: SectionOwnershipRow[] = [
    {
      site_ref: SITE,
      section_ref: "section:default/billing",
      entity_ref: "domain:default/billing",
      entity_owner_ref: "group:default/billing-team",
    },
  ];
  const rows = computeSectionRows(SITE, boundarySections, claims);
  const billingX = rows.find((r) => r.section_ref === "section:default/billing-x")!;
  // Attributed to the claiming ancestor, but the path is left intact (no spurious strip to "X").
  expect(billingX.entity_ref).toBe("domain:default/billing");
  expect(billingX.section_path).toBe("systems/billingX");
});
