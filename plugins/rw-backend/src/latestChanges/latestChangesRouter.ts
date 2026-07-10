import type { Router } from "express";
import PromiseRouter from "express-promise-router";
import type { HttpAuthService } from "@backstage/backend-plugin-api";
import type { LatestChangesResponse } from "@rwdocs/backstage-plugin-rw-common";
import type { LatestChangesStore } from "./LatestChangesStore";
import { toLatestChangeItem } from "./mapping";
import { encodeLatestChangesCursor, decodeLatestChangesCursor } from "./latestChangesCursor";

export interface LatestChangesRouterDeps {
  httpAuth: HttpAuthService;
  store: LatestChangesStore;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export function createLatestChangesRouter(deps: LatestChangesRouterDeps): Router {
  const { httpAuth, store } = deps;
  const router = PromiseRouter();

  // Global feed — require an authenticated user, but no ownership filter and no
  // per-page permission (consistent with the plugin's unguarded viewer routes).
  router.get("/pages/latest", async (req, res) => {
    await httpAuth.credentials(req, { allow: ["user"] });
    const limit = parseLimit(req.query.limit);

    const cursorParam = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const lastKey = cursorParam ? decodeLatestChangesCursor(cursorParam).lastKey : undefined;

    // hasAnyDated only drives the page-1 "still indexing" empty state. A paginated
    // request (cursor present) already implies dated rows exist, so skip the
    // full-table count on every scroll — the frontend reads hasAnyDated on page 1 only.
    const [page, hasAnyDated] = await Promise.all([
      store.latestChangesPage({ lastKey, limit }),
      cursorParam ? Promise.resolve(true) : store.hasAnyDated(),
    ]);

    const items = page.rows.map(toLatestChangeItem);

    let nextCursor: string | undefined;
    if (page.hasMore && page.rows.length > 0) {
      const last = page.rows[page.rows.length - 1];
      nextCursor = encodeLatestChangesCursor({
        lastKey: [Number(last.last_modified), last.site_ref, last.section_ref, last.subpath],
      });
    }

    const body: LatestChangesResponse = {
      hasAnyDated,
      items,
      pageInfo: nextCursor ? { nextCursor } : {},
    };
    res.json(body);
  });

  return router;
}
