import Router from "express-promise-router";
import type { HttpAuthService, LoggerService } from "@backstage/backend-plugin-api";
import { InputError, NotFoundError, ServiceUnavailableError } from "@backstage/errors";
import type { RwSite } from "@rwdocs/core";
import type { Hub } from "./hub";

export interface RouterOptions {
  logger: LoggerService;
  httpAuth: HttpAuthService;
  hub: Hub;
}

export async function createRouter(options: RouterOptions) {
  const { hub } = options;
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.use("/site/:namespace/:kind/:name", (req, res, next) => {
    const { namespace, kind, name } = req.params;
    const siteRef = `${namespace}/${kind}/${name}`.toLowerCase();

    const site = hub.getSite(siteRef);
    if (!site) {
      throw new NotFoundError(`No documentation site found for entity: ${siteRef}`);
    }

    res.locals.rwSite = site;
    next();
  });

  router.get("/site/:namespace/:kind/:name/config", (_req, res) => {
    res.json({ liveReloadEnabled: false });
  });

  router.get("/site/:namespace/:kind/:name/navigation", async (req, res) => {
    const site: RwSite = res.locals.rwSite;
    const sectionRefParam = req.query.sectionRef;
    const sectionRef = typeof sectionRefParam === "string" ? sectionRefParam : null;
    const nav = await getNavigationOrThrow(site, sectionRef);
    res.json(nav);
  });

  router.get("/site/:namespace/:kind/:name/pages/", async (req, res) => {
    const site: RwSite = res.locals.rwSite;
    const sectionRefParam = req.query.sectionRef;
    const sectionRef = typeof sectionRefParam === "string" ? sectionRefParam : undefined;

    let pagePath = "";
    if (sectionRef) {
      const nav = await getNavigationOrThrow(site, sectionRef);
      if (nav.scope?.path) {
        pagePath = nav.scope.path.replace(/^\//, "");
      }
    }

    const page = await renderPageOrThrow(site, pagePath);
    res.json(page);
  });

  // A page's Markdown source, addressed by the `(sectionRef, subpath)` identity
  // `listPages()` hands out and the search collator indexes.
  router.get("/site/:namespace/:kind/:name/markdown", async (req, res) => {
    const site: RwSite = res.locals.rwSite;
    const { sectionRef, subpath } = req.query;

    if (typeof sectionRef !== "string" || !sectionRef) {
      throw new InputError("sectionRef is required");
    }
    if (subpath !== undefined && typeof subpath !== "string") {
      throw new InputError("subpath must be a string");
    }
    // A section root is `subpath=""`, so an omitted subpath is the root, not a
    // bad request.
    const pageSubpath = subpath ?? "";
    if (pageSubpath.split("/").includes("..")) {
      throw new InputError("Invalid subpath");
    }

    const sitePath = await pagePathForOrThrow(site, sectionRef, pageSubpath);
    // A section root resolves to "" — falsy — so absence must be tested against
    // null, not truthiness.
    if (sitePath === null) {
      throw new NotFoundError(`Page not found: ${sectionRef}#${pageSubpath}`);
    }

    const page = await getPageMarkdownOrThrow(site, sitePath);
    // A virtual page (a directory with no markdown behind it) has no source.
    if (!page) {
      throw new NotFoundError(`Page not found: ${sectionRef}#${pageSubpath}`);
    }
    res.json(page);
  });

  router.get("/site/:namespace/:kind/:name/pages/:path(*)", async (req, res) => {
    const site: RwSite = res.locals.rwSite;
    const pagePath = req.params.path || "";
    if (pagePath.split("/").includes("..")) {
      throw new InputError("Invalid path");
    }
    const page = await renderPageOrThrow(site, pagePath);
    res.json(page);
  });

  return router;
}

async function getNavigationOrThrow(site: RwSite, sectionRef: string | null) {
  try {
    return await site.getNavigation(sectionRef);
  } catch (err) {
    throw toStorageError(err);
  }
}

async function renderPageOrThrow(site: RwSite, pagePath: string) {
  try {
    return await site.renderPage(pagePath);
  } catch (err) {
    throw toReadError(err, pagePath);
  }
}

async function getPageMarkdownOrThrow(site: RwSite, pagePath: string) {
  try {
    return await site.getPageMarkdown(pagePath);
  } catch (err) {
    throw toReadError(err, pagePath);
  }
}

/** Resolves a page's canonical identity to the site path the read methods take.
 *  Rejects (rather than resolving to `null`) when the site can't be loaded, so
 *  the caller's `null` branch stays a genuine 404. */
async function pagePathForOrThrow(site: RwSite, sectionRef: string, subpath: string) {
  try {
    return await site.pagePathFor(sectionRef, subpath);
  } catch (err) {
    throw toStorageError(err);
  }
}

/** Maps a page-read failure from the @rwdocs/core native addon onto an HTTP error. */
function toReadError(err: unknown, pagePath: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  // Message prefixes come from the @rwdocs/core native addon (RenderError).
  // Must be updated if the upstream error format changes. Check the storage
  // (availability) case first so a transient failure whose inner text happens
  // to embed a not-found phrase still surfaces as a 503, not a 404.
  if (message.includes("Storage error")) {
    return toStorageError(err);
  }
  // Two distinct not-found cases, both a 404: "Content not found" (page in the
  // structure but its markdown file is missing) and "Page not found" (no page at
  // this URL — the ordinary missing/stale/doubled path). Do NOT narrow this to
  // the former: the common miss is "Page not found" and would surface as a 500.
  if (message.includes("Content not found") || message.includes("Page not found")) {
    return new NotFoundError(`Page not found: /${pagePath}`);
  }
  return err instanceof Error ? err : new Error(message);
}

export function toStorageError(err: unknown): ServiceUnavailableError {
  const message = err instanceof Error ? err.message : String(err);
  return new ServiceUnavailableError(`Storage unavailable: ${message}`);
}
