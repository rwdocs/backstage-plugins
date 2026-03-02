import Router from "express-promise-router";
import type { HttpAuthService, LoggerService } from "@backstage/backend-plugin-api";
import { InputError, NotFoundError } from "@backstage/errors";
import { createSite, type RwSite, type SiteConfig } from "@rwdocs/core";

export interface S3Options {
  bucket: string;
  entity: string;
  region?: string;
  endpoint?: string;
  bucketRootPath?: string;
}

export interface RouterOptions {
  logger: LoggerService;
  httpAuth: HttpAuthService;
  projectDir?: string;
  s3?: S3Options;
  linkPrefix?: string;
}

export async function createRouter(options: RouterOptions) {
  const { logger, projectDir, s3, linkPrefix } = options;
  const router = Router();

  const config: SiteConfig = { projectDir, s3, linkPrefix };
  logger.info(
    s3
      ? `Creating RW site from S3 (${s3.bucket}/${s3.entity})`
      : `Creating RW site from ${projectDir}`,
  );
  const site: RwSite = createSite(config);

  router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/config", (_req, res) => {
    res.json({ liveReloadEnabled: false });
  });

  router.get("/navigation", (req, res) => {
    const scopeParam = req.query.scope;
    const scope = typeof scopeParam === "string" ? scopeParam : undefined;
    const nav = site.getNavigation(scope ?? null);
    res.json(nav);
  });

  router.get("/pages/", async (_req, res) => {
    const page = await renderPageOrThrow(site, "");
    res.json(page);
  });

  router.get("/pages/:path(*)", async (req, res) => {
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
