import {
  stringifyEntityRef,
  getCompoundEntityRef,
  parseEntityRef,
  RELATION_OWNED_BY,
  type Entity,
} from "@backstage/catalog-model";
import type { AuthService, LoggerService } from "@backstage/backend-plugin-api";
import type { CatalogService } from "@backstage/plugin-catalog-node";
import {
  iterateAnnotatedEntities,
  parseAnnotation,
  toEntityPath,
  RW_ANNOTATION,
  type RwSiteConfig,
} from "@rwdocs/backstage-plugin-rw-common";
import type { SectionOwnershipStore } from "./SectionOwnershipStore";
import type { SiteRefreshStore } from "./SiteRefreshStore";
import type { SectionOwnershipRow } from "./types";

function ownerOf(entity: Entity): string | null {
  const rel = (entity.relations ?? []).find((r) => r.type === RELATION_OWNED_BY);
  return rel?.targetRef ?? null;
}

export async function runScan(deps: {
  catalog: Pick<CatalogService, "queryEntities">;
  auth: AuthService;
  logger: LoggerService;
  siteConfig: RwSiteConfig;
  sectionOwnershipStore: SectionOwnershipStore;
  siteRefreshStore: SiteRefreshStore;
  now?: () => Date;
}): Promise<void> {
  const { catalog, auth, logger, siteConfig, sectionOwnershipStore, siteRefreshStore } = deps;
  const now = deps.now ?? (() => new Date());
  const credentials = await auth.getOwnServiceCredentials();

  // projectDir mode serves exactly one site; constrain discovery to it.
  const onlySiteRef =
    siteConfig.projectDir && siteConfig.entity
      ? stringifyEntityRef(parseEntityRef(siteConfig.entity))
      : undefined;

  const scanStart = now();
  // Dedup per-site links by section_ref (last-claim-wins) to avoid a PK violation on swap.
  const linksBySite = new Map<string, Map<string, SectionOwnershipRow>>();
  let completed = false;
  let writeFailed = false;

  try {
    for await (const { entity } of iterateAnnotatedEntities(catalog, credentials)) {
      const selfRef = stringifyEntityRef(getCompoundEntityRef(entity));
      const parsed = parseAnnotation(
        entity.metadata?.annotations?.[RW_ANNOTATION],
        toEntityPath(selfRef),
      );
      if (!parsed) continue;
      const siteRef = parsed.entityRef;
      if (onlySiteRef && siteRef !== onlySiteRef) continue;

      let link: SectionOwnershipRow | undefined;
      if (parsed.sectionRef) {
        link = {
          site_ref: siteRef,
          section_ref: parsed.sectionRef,
          entity_ref: selfRef,
          entity_owner_ref: ownerOf(entity),
        };
      } else if (parsed.entityRef === selfRef) {
        // Self-host root claim: no explicit section ref, so use the site ref itself as the
        // section_ref sentinel. At read time, ownership resolution falls back to this sentinel
        // when no more-specific section link is found.
        link = {
          site_ref: siteRef,
          section_ref: siteRef,
          entity_ref: selfRef,
          entity_owner_ref: ownerOf(entity),
        };
      }
      // section-less claim on another site: ignored (matches legacy behavior)
      if (!link) continue;

      const inner = linksBySite.get(siteRef) ?? new Map<string, SectionOwnershipRow>();
      inner.set(link.section_ref, link); // last-claim-wins dedup by section_ref
      linksBySite.set(siteRef, inner);
    }
    completed = true;
  } catch (err) {
    logger.warn(`Site index scan iteration failed; skipping prune: ${err}`);
  }

  // Per site: swap links + upsert queue row atomically in one transaction.
  for (const [siteRef, inner] of linksBySite) {
    try {
      await siteRefreshStore.transaction(async (tx) => {
        await sectionOwnershipStore.swapSite(siteRef, [...inner.values()], tx);
        await siteRefreshStore.upsertSite(siteRef, scanStart, tx);
      });
    } catch (err) {
      logger.warn(`Site index scan failed for site ${siteRef}: ${err}`);
      // A per-site write failure leaves last_discovery_at un-updated, so
      // pruneMissing would incorrectly delete that still-present site. Mark the scan
      // as dirty so we skip the prune entirely.
      writeFailed = true;
    }
  }

  // Prune only after a clean, complete iteration and all per-site writes succeeded —
  // a partial/failed scan must not delete still-present sites from the queue.
  let pruned = 0;
  if (completed && !writeFailed) {
    pruned = await siteRefreshStore.pruneMissing(scanStart);
  }

  logger.info(
    `Site index scan: ${linksBySite.size} site(s) discovered${
      completed && !writeFailed ? `, ${pruned} stale pruned` : ", prune skipped (incomplete scan)"
    }`,
  );
}
