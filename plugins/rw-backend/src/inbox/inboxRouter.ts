import type { Router } from "express";
import PromiseRouter from "express-promise-router";
import type {
  HttpAuthService,
  PermissionsService,
  UserInfoService,
} from "@backstage/backend-plugin-api";
import { AuthorizeResult } from "@backstage/plugin-permission-common";
import { rwCommentReadPermission } from "@rwdocs/backstage-plugin-rw-common";
import type { CommentStore } from "../comments/CommentStore";
import type { SiteRefreshStore } from "../siteIndex/SiteRefreshStore";
import type { InboxStore } from "./InboxStore";
import { toInboxItem, rawSortValue } from "./mapping";
import { encodeCursor, decodeCursor } from "./cursor";

export interface InboxRouterDeps {
  httpAuth: HttpAuthService;
  permissions: PermissionsService;
  userInfo: UserInfoService;
  store: InboxStore;
  commentStore: CommentStore;
  siteRefreshStore: Pick<SiteRefreshStore, "anyBuilt">;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export function createInboxRouter(deps: InboxRouterDeps): Router {
  const { httpAuth, permissions, userInfo, store, commentStore, siteRefreshStore } = deps;
  const router = PromiseRouter();

  router.get("/comments/inbox", async (req, res) => {
    const credentials = await httpAuth.credentials(req, { allow: ["user"] });
    const decision = await permissions.authorize([{ permission: rwCommentReadPermission }], {
      credentials,
    });
    if (decision[0].result !== AuthorizeResult.ALLOW) {
      res.status(403).end();
      return;
    }
    const { ownershipEntityRefs } = await userInfo.getUserInfo(credentials);
    const limit = parseLimit(req.query.limit);

    // Discriminate on cursor presence (mirrors catalog queryEntities). The cursor
    // carries filter/sort + memoised counts; the initial request reads them from
    // the query and computes the counts once. Subsequent pages reuse the counts
    // from the cursor — intentionally stale across a paginated fetch (saves a
    // count query per scroll; matches catalog queryEntities totalItems behaviour).
    const cursorParam = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

    let filter: "open" | "unanswered";
    let sort: "newest" | "oldest";
    let lastKey: [string | number, string] | undefined;
    let openCount: number;
    let unansweredCount: number;
    let built: boolean;

    if (cursorParam) {
      const cursor = decodeCursor(cursorParam); // throws InputError → 400
      ({ filter, sort } = cursor);
      lastKey = cursor.lastKey;
      openCount = cursor.openCount;
      unansweredCount = cursor.unansweredCount;
      built = await siteRefreshStore.anyBuilt();
    } else {
      filter = req.query.filter === "unanswered" ? "unanswered" : "open";
      sort = req.query.sort === "oldest" ? "oldest" : "newest";
      const [b, c] = await Promise.all([
        siteRefreshStore.anyBuilt(),
        store.counts(ownershipEntityRefs),
      ]);
      built = b;
      openCount = c.openCount;
      unansweredCount = c.unansweredCount;
    }

    const page = await store.ownedOpenThreadsPage(ownershipEntityRefs, {
      filter,
      sort,
      lastKey,
      limit,
    });
    const replyCountMap = await commentStore.replyCountsFor(page.rows.map((r) => r.id));
    const items = page.rows.map((r) => toInboxItem(r, replyCountMap.get(r.id) ?? 0));

    let nextCursor: string | undefined;
    if (page.hasMore && page.rows.length > 0) {
      const last = page.rows[page.rows.length - 1];
      nextCursor = encodeCursor({
        filter,
        sort,
        lastKey: [rawSortValue(last.updated_at), last.id],
        openCount,
        unansweredCount,
      });
    }

    res.json({
      built,
      items,
      pageInfo: nextCursor ? { nextCursor } : {},
      openCount,
      unansweredCount,
    });
  });

  return router;
}
