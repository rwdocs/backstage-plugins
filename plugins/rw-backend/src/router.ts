import Router from "express-promise-router";
import type { HttpAuthService, LoggerService } from "@backstage/backend-plugin-api";
import { InputError, NotFoundError } from "@backstage/errors";
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

  router.use("/site/:namespace/:kind/:name", (req, _res, next) => {
    const entityRef = `${req.params.namespace}/${req.params.kind}/${req.params.name}`;
    const site = hub.getSite(entityRef);
    if (!site) {
      throw new NotFoundError(`No documentation site found for entity: ${entityRef}`);
    }
    (req as any).rwSite = site;
    next();
  });

  router.get("/site/:namespace/:kind/:name/config", (_req, res) => {
    res.json({ liveReloadEnabled: false });
  });

  router.get("/site/:namespace/:kind/:name/navigation", (req, res) => {
    const site: RwSite = (req as any).rwSite;
    const scopeParam = req.query.scope;
    const scope = typeof scopeParam === "string" ? scopeParam : undefined;
    const nav = site.getNavigation(scope ?? null);
    res.json(nav);
  });

  router.get("/site/:namespace/:kind/:name/pages/", async (req, res) => {
    const site: RwSite = (req as any).rwSite;
    const page = await renderPageOrThrow(site, "");
    res.json(page);
  });

  router.get("/site/:namespace/:kind/:name/pages/:path(*)", async (req, res) => {
    const site: RwSite = (req as any).rwSite;
    const pagePath = req.params.path || "";
    if (pagePath.split("/").includes("..")) {
      throw new InputError("Invalid path");
    }
    const page = await renderPageOrThrow(site, pagePath);
    res.json(page);
  });

  return router;
}

async function renderPageOrThrow(site: RwSite, pagePath: string) {
  try {
    return await site.renderPage(pagePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Content not found")) {
      throw new NotFoundError(`Page not found: /${pagePath}`);
    }
    throw err;
  }
}
