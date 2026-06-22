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
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Content not found")) {
      throw new NotFoundError(`Page not found: /${pagePath}`);
    }
    // Message prefix comes from @rwdocs/core native addon (RenderError::Storage).
    // Must be updated if the upstream error format changes.
    if (message.includes("Storage error")) {
      throw toStorageError(err);
    }
    throw err;
  }
}

export function toStorageError(err: unknown): ServiceUnavailableError {
  const message = err instanceof Error ? err.message : String(err);
  return new ServiceUnavailableError(`Storage unavailable: ${message}`);
}
