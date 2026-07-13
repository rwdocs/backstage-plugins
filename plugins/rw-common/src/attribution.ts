import {
  stringifyEntityRef,
  getCompoundEntityRef,
  RELATION_OWNED_BY,
} from "@backstage/catalog-model";
import type { Entity } from "@backstage/catalog-model";
import type { BackstageCredentials } from "@backstage/backend-plugin-api";
import type { CatalogService } from "@backstage/plugin-catalog-node";
import { iterateAnnotatedEntities, RW_ANNOTATION } from "./iterateAnnotatedEntities";
import { parseAnnotation } from "./parseAnnotation";
import { toEntityPath } from "./entityPath";

/**
 * Which catalog entity documents which part of an rw site.
 *
 * A page (or section) belongs to exactly one entity: the one claiming the nearest
 * section at or above it. Several entities can *reach* the same page — a system,
 * its domain and the site root all show it in their Docs tab — but only the
 * nearest one owns it, so a search hit, a comment and a changes-feed entry all
 * name the same entity and the same entity-relative path.
 *
 * This module is the single source of that rule. It lived twice before — once in
 * the search collator and once in rw-backend's siteIndex — and the two copies
 * disagreed about which entity wins a doubly-claimed section, so the same page
 * was attributed differently depending on which surface you looked at.
 */

/** An entity's claim on a site or one of its sections. */
export interface SiteClaim {
  /** The claiming entity. */
  entityRef: string;
  /** Its `ownedBy` target, for surfaces that filter by ownership. */
  ownerRef: string | null;
}

/** The entities documenting one rw site. */
export interface SiteClaims {
  /** Entity ref of the site itself (the annotation's target). */
  siteRef: string;
  /** Slash-delimited form of {@link siteRef}, for `createSite`. */
  entityPath: string;
  /** Claimed section ref -> the entity claiming it. */
  bySection: Map<string, SiteClaim>;
  /** The entity whose annotation is a self-reference: it hosts the site. */
  host: SiteClaim | undefined;
  /** An entity pointing at this site unscoped without hosting it. Its Docs tab
   *  shows the whole site, so it can surface the pages the host would. */
  unscoped: SiteClaim | undefined;
}

/** The entity owning everything no section claims, or undefined when nothing
 *  documents the site as a whole. A real host beats a mere pointer. */
export function rootClaimOf(claims: SiteClaims): SiteClaim | undefined {
  return claims.host ?? claims.unscoped;
}

/**
 * The nearest claim at or above a section, given its ancestry chain
 * (nearest-first, self included), else the site's root claim.
 *
 * `chain` is `[sectionRef, ...ancestors]` from `listSections()`, or the
 * `sectionRef`s of a page's `anchors` from `listPages()` — both are ordered
 * innermost-first, which is what makes "nearest" a `find`.
 */
export function nearestClaim(
  claims: SiteClaims,
  chain: string[],
): { sectionRef: string; claim: SiteClaim } | undefined {
  for (const sectionRef of chain) {
    const claim = claims.bySection.get(sectionRef);
    if (claim) return { sectionRef, claim };
  }
  const root = rootClaimOf(claims);
  return root ? { sectionRef: "", claim: root } : undefined;
}

/** A section path relative to its owner's docs root. Only a whole-segment prefix
 *  counts, so a section at `domains/bill` never eats the `ing` of one at
 *  `domains/billing`. */
export function stripSectionPrefix(path: string, prefix: string): string {
  if (!prefix) return path;
  if (path === prefix) return "";
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : path;
}

function ownerOf(entity: Entity): string | null {
  return (entity.relations ?? []).find((r) => r.type === RELATION_OWNED_BY)?.targetRef ?? null;
}

/** Two entities claiming one thing is a catalog mistake rw can't resolve for us.
 *  The lexicographically first wins, so a page lands on the same entity across
 *  runs — the catalog yields entities in `metadata.uid` order, which is arbitrary
 *  and changes when an entity is re-ingested, so "last one wins" would silently
 *  reattribute pages. */
function pickClaim(
  current: SiteClaim | undefined,
  candidate: SiteClaim,
  claimed: string,
  onConflict: (message: string) => void,
): SiteClaim {
  if (!current) return candidate;
  const [winner, loser] =
    current.entityRef < candidate.entityRef ? [current, candidate] : [candidate, current];
  onConflict(
    `Both ${current.entityRef} and ${candidate.entityRef} claim ${claimed}; attributing it to ${winner.entityRef} (${loser.entityRef} ignored)`,
  );
  return winner;
}

/**
 * Groups every entity annotated with `rwdocs.org/ref` by the site it documents.
 *
 * `onlySiteEntityPath` constrains discovery to a single site (projectDir mode
 * serves exactly one); pass it only when `rw.projectDir` is set, since in s3 mode
 * every annotated site is served.
 */
export async function collectSiteClaims(args: {
  catalog: Pick<CatalogService, "queryEntities">;
  credentials: BackstageCredentials;
  onlySiteEntityPath?: string;
  /** Reports a catalog-data problem rw cannot resolve: a doubly-claimed section,
   *  or an entity whose ref is not a usable path. Both drop data, quietly. */
  onWarning?: (message: string) => void;
}): Promise<Map<string, SiteClaims>> {
  const { catalog, credentials, onlySiteEntityPath } = args;
  const onWarning = args.onWarning ?? (() => {});
  const sites = new Map<string, SiteClaims>();

  for await (const { entity } of iterateAnnotatedEntities(catalog, credentials)) {
    const entityRef = stringifyEntityRef(getCompoundEntityRef(entity));

    // `toEntityPath` can reject a ref the catalog itself admitted (a custom entity
    // policy allows names our path rule doesn't). This runs once per annotated entity
    // across a whole-catalog pass from which both callers attribute *every* site, so a
    // bad ref must cost only its own entity — letting the throw escape would fail every
    // site because of one. `parseAnnotation` already drops bad data this way.
    let selfEntityPath: string;
    try {
      selfEntityPath = toEntityPath(entityRef);
    } catch (err) {
      onWarning(`Skipping ${entityRef}: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    const parsed = parseAnnotation(entity.metadata?.annotations?.[RW_ANNOTATION], selfEntityPath);
    if (!parsed) continue;
    if (onlySiteEntityPath && parsed.entityPath !== onlySiteEntityPath) continue;

    // Created only once an entity actually claims something: an annotation that
    // claims nothing must not cost a site load that yields nothing.
    let site = sites.get(parsed.entityRef);
    if (!site) {
      site = {
        siteRef: parsed.entityRef,
        entityPath: parsed.entityPath,
        bySection: new Map(),
        host: undefined,
        unscoped: undefined,
      };
      sites.set(parsed.entityRef, site);
    }

    const claim: SiteClaim = { entityRef, ownerRef: ownerOf(entity) };

    if (!parsed.sectionRef) {
      // Both kinds of unscoped annotation show the whole site in their Docs tab, so
      // both can own its unclaimed pages — but a self-hosting entity is the better
      // owner and wins in `rootClaimOf`.
      const slot = parsed.entityRef === entityRef ? "host" : "unscoped";
      site[slot] = pickClaim(site[slot], claim, "the whole site", onWarning);
      continue;
    }

    site.bySection.set(
      parsed.sectionRef,
      pickClaim(site.bySection.get(parsed.sectionRef), claim, parsed.sectionRef, onWarning),
    );
  }

  return sites;
}
