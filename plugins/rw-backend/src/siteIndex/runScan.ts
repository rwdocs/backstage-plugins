import type { AuthService, LoggerService } from "@backstage/backend-plugin-api";
import type { CatalogService } from "@backstage/plugin-catalog-node";
import {
  collectSiteClaims,
  toEntityPath,
  type RwSiteConfig,
} from "@rwdocs/backstage-plugin-rw-common";
import type { SectionOwnershipStore } from "./SectionOwnershipStore";
import type { SiteRefreshStore } from "./SiteRefreshStore";
import type { SectionOwnershipRow } from "./types";

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
  const onlySiteEntityPath =
    siteConfig.projectDir && siteConfig.entity ? toEntityPath(siteConfig.entity) : undefined;

  const scanStart = now();
  const linksBySite = new Map<string, Map<string, SectionOwnershipRow>>();
  let completed = false;
  let writeFailed = false;

  try {
    // Who documents what is decided in rw-common, so the scan, the search collator
    // and every read path agree on it — including which entity wins a section two
    // entities claim, which this used to resolve by catalog iteration order.
    const sites = await collectSiteClaims({
      catalog,
      credentials,
      onlySiteEntityPath,
      onWarning: (message) => logger.warn(message),
    });

    for (const [siteRef, claims] of sites) {
      const links = new Map<string, SectionOwnershipRow>();
      for (const [sectionRef, claim] of claims.bySection) {
        links.set(sectionRef, {
          site_ref: siteRef,
          section_ref: sectionRef,
          entity_ref: claim.entityRef,
          entity_owner_ref: claim.ownerRef,
        });
      }
      // The self-host claim is stored under the site ref as its section_ref: a
      // sentinel the ownership rollup falls back to when no section claim matches.
      // Only a true host is stored — an entity merely pointing at someone else's
      // site does not own its sections (search still surfaces those pages under it;
      // ownership, and the deep links built from it, belong to the host).
      if (claims.host) {
        links.set(siteRef, {
          site_ref: siteRef,
          section_ref: siteRef,
          entity_ref: claims.host.entityRef,
          entity_owner_ref: claims.host.ownerRef,
        });
      }
      if (links.size > 0) linksBySite.set(siteRef, links);
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
