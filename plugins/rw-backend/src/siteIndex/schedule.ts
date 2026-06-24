import { createSite, type RwSite } from "@rwdocs/core";
import type { RwSiteConfig } from "@rwdocs/backstage-plugin-rw-common";

export const INTERVAL_MS = 15 * 60_000;
export const LEASE_MS = 5 * 60_000;
export const BATCH_SIZE = 10;
export const CONCURRENCY = 4;

/** now + intervalMs * (0.5 + rng()); rng defaults to Math.random (range [0.5x, 1.5x]). */
export function jitteredNextUpdate(
  now: Date,
  intervalMs: number = INTERVAL_MS,
  rng: () => number = Math.random,
): Date {
  return new Date(now.getTime() + intervalMs * (0.5 + rng()));
}

/** Build an `RwSite` for an entity path, branching projectDir vs S3 (matches the collator). */
export function makeSiteFactory(siteConfig: RwSiteConfig): (entityPath: string) => RwSite {
  return (entityPath: string) =>
    siteConfig.projectDir
      ? createSite({ projectDir: siteConfig.projectDir, diagrams: siteConfig.diagrams })
      : createSite({
          s3: { ...siteConfig.s3!, entity: entityPath },
          diagrams: siteConfig.diagrams,
        });
}
