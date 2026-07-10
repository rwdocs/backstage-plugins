import pLimit from "p-limit";
import type { LoggerService } from "@backstage/backend-plugin-api";
import { toEntityPath } from "@rwdocs/backstage-plugin-rw-common";
import type { RwSite } from "@rwdocs/core";
import type { SiteRefreshStore } from "./SiteRefreshStore";
import type { RegistryStore } from "./RegistryStore";
import type { SectionOwnershipStore } from "./SectionOwnershipStore";
import type { SectionRow, PageRow } from "./types";
import { registryHash } from "./registryHash";
import { parseMtime } from "./mtime";
import { computeSectionRows } from "./effectiveOwnership";
import { jitteredNextUpdate, BATCH_SIZE, CONCURRENCY, LEASE_MS, INTERVAL_MS } from "./schedule";

function sortSections(rows: SectionRow[]): SectionRow[] {
  return [...rows].sort((a, b) => a.section_ref.localeCompare(b.section_ref));
}
function sortPages(rows: PageRow[]): PageRow[] {
  return [...rows].sort(
    (a, b) => a.section_ref.localeCompare(b.section_ref) || a.subpath.localeCompare(b.subpath),
  );
}

export async function runWorker(deps: {
  logger: LoggerService;
  siteRefreshStore: SiteRefreshStore;
  registryStore: RegistryStore;
  sectionOwnershipStore: Pick<SectionOwnershipStore, "listForSite">;
  makeSite: (entityPath: string) => Pick<RwSite, "listSections" | "listPages">;
  now?: () => Date;
  rng?: () => number;
}): Promise<void> {
  const { logger, siteRefreshStore, registryStore, sectionOwnershipStore, makeSite } = deps;
  const now = deps.now ?? (() => new Date());

  const claimNow = now();
  const claimed = await siteRefreshStore.claimDue(
    claimNow,
    BATCH_SIZE,
    new Date(claimNow.getTime() + LEASE_MS),
  );
  if (!claimed.length) return;
  logger.info(`Site index worker: rebuilding ${claimed.length} site(s)`);

  const limit = pLimit(CONCURRENCY);
  await Promise.all(
    claimed.map(({ siteRef, resultHash }) =>
      limit(async () => {
        try {
          const site = makeSite(toEntityPath(siteRef));
          // listForSite is independent of the doc-structure reads, so fetch all three together.
          const [rawSections, rawPages, claims] = await Promise.all([
            site.listSections(),
            site.listPages(),
            sectionOwnershipStore.listForSite(siteRef),
          ]);
          // computeSectionRows folds the effective-ownership rollup into each dense section row.
          // registryHash is order-sensitive (JSON.stringify) and listSections order is unspecified,
          // so sort by section_ref for a stable hash.
          const sections = sortSections(computeSectionRows(siteRef, rawSections, claims));
          const pages = sortPages(
            rawPages.map((p) => ({
              site_ref: siteRef,
              section_ref: p.sectionRef,
              subpath: p.subpath,
              title: p.title,
              last_modified: parseMtime(p.lastModified),
            })),
          );
          const hash = registryHash(sections, pages);
          const changed = hash !== resultHash;
          if (changed) {
            await registryStore.swapSite(siteRef, sections, pages);
          }
          const completedAt = now();
          await siteRefreshStore.completeSuccess(
            siteRef,
            hash,
            jitteredNextUpdate(completedAt, INTERVAL_MS, deps.rng),
            completedAt,
          );
          logger.debug(
            `Rebuilt ${siteRef}: ${sections.length} sections, ${pages.length} pages${
              changed ? "" : " (unchanged)"
            }`,
          );
        } catch (err) {
          logger.warn(`Site index rebuild failed for site ${siteRef}: ${err}`);
          // recordError is best-effort: if it also throws (e.g. DB down), swallow it so one
          // site's failure never rejects Promise.all and aborts the rest of the batch.
          try {
            await siteRefreshStore.recordError(siteRef, String(err));
          } catch (recordErr) {
            logger.warn(`Failed to record rebuild error for site ${siteRef}: ${recordErr}`);
          }
        }
      }),
    ),
  );
}
