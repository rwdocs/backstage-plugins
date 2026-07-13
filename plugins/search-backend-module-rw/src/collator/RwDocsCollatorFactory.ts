import { Readable } from "stream";
import type { Config } from "@backstage/config";
import type { LoggerService, AuthService } from "@backstage/backend-plugin-api";
import type { CatalogService } from "@backstage/plugin-catalog-node";
import type { DocumentCollatorFactory, IndexableDocument } from "@backstage/plugin-search-common";
import type { Permission } from "@backstage/plugin-permission-common";
import { catalogEntityReadPermission } from "@backstage/plugin-catalog-common/alpha";
import { parseEntityRef } from "@backstage/catalog-model";
import { createSite, type RwSite } from "@rwdocs/core";
import {
  collectSiteClaims,
  rootClaimOf,
  toEntityPath,
  readRwSiteConfig,
  type RwSiteConfig,
  type SiteClaims,
} from "@rwdocs/backstage-plugin-rw-common";

const DEFAULT_LOCATION_TEMPLATE = "/catalog/:namespace/:kind/:name/docs/:path";

/**
 * An indexed RW page.
 *
 * Beyond the fields Backstage itself reads, each document carries the page's
 * canonical RW identity — `siteRef` plus the `(sectionRef, subpath)` pair that
 * `@rwdocs/core` hands out — so a consumer holding a search hit can read the
 * page it describes:
 *
 * ```
 * GET /api/rw/site/<namespace>/<kind>/<name>/markdown?sectionRef=…&subpath=…
 * ```
 *
 * `location` cannot serve that purpose: it is a frontend route, it is
 * configurable via `search.collators.rw.locationTemplate`, and its path is
 * relative to the entity's section scope rather than the site root.
 * `authorization` cannot either — the search backend strips it before results
 * reach any caller.
 */
export interface RwIndexableDocument extends IndexableDocument {
  /** Entity ref of the site the page lives in — the annotation's target. */
  siteRef: string;
  /** Canonical ref of the section containing the page (an entity ref). */
  sectionRef: string;
  /** The page's path relative to its section root (`""` for the section root). */
  subpath: string;
  /** Entity ref of the catalog entity that owns the page: the one claiming the
   *  nearest section at or above it, else the entity hosting the site. A page is
   *  indexed once, for this entity alone, even though the entities above it can
   *  also reach it — the same attribution rw-backend's siteIndex gives comments and
   *  the changes feed. `location` points into this entity's docs.
   *
   *  This is *attribution*, not access: a hit is filtered by read on `siteRef` (see
   *  `authorization`), because the site is the repo and therefore the unit of docs
   *  access. Which entity documents a page and who may read it are different questions. */
  entityRef: string;
}

function applyLocationTemplate(
  template: string,
  params: { namespace: string; kind: string; name: string; path: string },
): string {
  // Function replacers: a page path is author-controlled, and `$&` (or `$1`) in a
  // string replacement is a substitution pattern, not a literal.
  return template
    .replace(":namespace", () => encodeURIComponent(params.namespace))
    .replace(":kind", () => encodeURIComponent(params.kind))
    .replace(":name", () => encodeURIComponent(params.name))
    .replace(":path", () => params.path);
}

export class RwDocsCollatorFactory implements DocumentCollatorFactory {
  readonly type: string;
  readonly visibilityPermission: Permission = catalogEntityReadPermission;

  private constructor(
    type: string,
    private readonly siteConfig: RwSiteConfig,
    private readonly locationTemplate: string,
    private readonly logger: LoggerService,
    private readonly auth: AuthService,
    private readonly catalog: CatalogService,
  ) {
    this.type = type;
  }

  static fromConfig(
    config: Config,
    deps: {
      logger: LoggerService;
      auth: AuthService;
      catalog: CatalogService;
    },
  ): RwDocsCollatorFactory {
    const siteConfig = readRwSiteConfig(config);

    const type = config.getOptionalString("search.collators.rw.type") ?? "rw";
    const locationTemplate =
      config.getOptionalString("search.collators.rw.locationTemplate") ?? DEFAULT_LOCATION_TEMPLATE;

    return new RwDocsCollatorFactory(
      type,
      siteConfig,
      locationTemplate,
      deps.logger,
      deps.auth,
      deps.catalog,
    );
  }

  async getCollator(): Promise<Readable> {
    return Readable.from(this.execute());
  }

  private async *execute(): AsyncGenerator<IndexableDocument> {
    this.logger.info("Starting RW docs indexing");
    const credentials = await this.auth.getOwnServiceCredentials();
    // `rw.entity` only names a site in projectDir mode; in s3 mode every annotated
    // site is served (see Hub), so a leftover `entity` there must not narrow the
    // index to one site.
    const localEntityPath =
      this.siteConfig.projectDir && this.siteConfig.entity
        ? toEntityPath(this.siteConfig.entity)
        : undefined;

    // Who documents what — the rule search shares with the comment inbox and the
    // changes feed, so one page is attributed to one entity on every surface.
    const sites = await collectSiteClaims({
      catalog: this.catalog,
      credentials,
      onlySiteEntityPath: localEntityPath,
      onConflict: (message) => this.logger.warn(message),
    });
    let docCount = 0;

    for (const site of sites.values()) {
      try {
        for await (const doc of this.indexSite(site)) {
          docCount++;
          yield doc;
        }
      } catch (err) {
        this.logger.warn(`Failed to index site ${site.siteRef}: ${err}`);
      }
    }

    this.logger.info(`RW docs indexing complete: ${docCount} documents indexed`);
  }

  private async *indexSite(claims: SiteClaims): AsyncGenerator<RwIndexableDocument> {
    const site = this.createSite(claims.entityPath);
    const pages = await site.listPages();

    this.logger.info(`Indexing site ${claims.siteRef} (${pages.length} pages)`);

    const rootOwner = rootClaimOf(claims);
    const matchedClaims = new Set<string>();
    let unowned = 0;

    for (const page of pages) {
      // Virtual pages (a directory with no markdown behind it) have nothing to index.
      if (!page.hasContent) continue;

      // `anchors` is every section enclosing the page, innermost first, each paired
      // with the page's path relative to *that* section — so the nearest claiming
      // entity and the path to show under it fall out of one lookup.
      const anchor = page.anchors.find((a) => claims.bySection.has(a.sectionRef));
      const claim = anchor ? claims.bySection.get(anchor.sectionRef)! : rootOwner;
      if (!claim) {
        // No entity surfaces this page, so a hit would have nowhere to link.
        unowned++;
        continue;
      }
      const entityRef = claim.entityRef;
      if (anchor) matchedClaims.add(anchor.sectionRef);

      try {
        const doc = await site.renderSearchDocument(page.path);
        if (!doc) continue;

        const { kind, namespace, name } = parseEntityRef(entityRef);

        yield {
          title: doc.title,
          text: doc.text,
          location: applyLocationTemplate(this.locationTemplate, {
            namespace,
            kind,
            name,
            // Relative to the owning entity's docs root: the anchor's own subpath
            // when an entity claims a section above the page, else the site path.
            path: anchor ? anchor.subpath : page.path,
          }),
          siteRef: claims.siteRef,
          sectionRef: page.sectionRef,
          subpath: page.subpath,
          entityRef,
          authorization: {
            // The site, not the page's owning entity: a site is one repo, so its entity is the
            // unit of docs access, and rw-backend's read routes gate on exactly this. Filtering
            // hits by the *owning* entity instead would hide pages the read route still serves —
            // a user could read a page they cannot find, and a section claim (which exists to
            // scope an entity's Docs view, not to restrict it) would look like a security
            // boundary it is not.
            resourceRef: claims.siteRef,
          },
        };
      } catch (err) {
        this.logger.warn(`Failed to render page ${page.path} for ${claims.siteRef}: ${err}`);
      }
    }

    for (const [sectionRef, { entityRef }] of claims.bySection) {
      if (!matchedClaims.has(sectionRef)) {
        // The usual cause is a typo, or a section the docs repo has since renamed:
        // the entity's pages end up with the site's owner while its own Docs tab —
        // which falls back to the whole site on an unresolvable ref — still shows
        // them. Silent before this warning.
        this.logger.warn(
          `${entityRef} claims ${sectionRef}, which has no pages in ${claims.siteRef}; they will be attributed to the site's owner instead`,
        );
      }
    }

    if (unowned > 0) {
      // One line per site, not per page: a misconfigured catalog would otherwise
      // report "0 documents indexed" with nothing at all to grep for.
      this.logger.warn(
        `Skipped ${unowned} unowned page(s) in ${claims.siteRef}: no entity claims them and none documents the site as a whole (annotate the site entity with 'rwdocs.org/ref: .')`,
      );
    }
  }

  private createSite(entityPath: string): RwSite {
    if (this.siteConfig.projectDir) {
      return createSite({
        projectDir: this.siteConfig.projectDir,
        diagrams: this.siteConfig.diagrams,
      });
    }

    return createSite({
      s3: { ...this.siteConfig.s3!, entity: entityPath },
      diagrams: this.siteConfig.diagrams,
    });
  }
}
