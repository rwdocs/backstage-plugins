import express from "express";
import PromiseRouter from "express-promise-router";
import type { Router } from "express";
import {
  InputError,
  NotAllowedError,
  NotFoundError,
  ServiceUnavailableError,
} from "@backstage/errors";
import { parseEntityRef } from "@backstage/catalog-model";
import {
  AuthService,
  BackstageCredentials,
  HttpAuthService,
  LoggerService,
  PermissionsService,
  PermissionsRegistryService,
  UserInfoService,
} from "@backstage/backend-plugin-api";
import type { CatalogService } from "@backstage/plugin-catalog-node";
import { AuthorizeResult } from "@backstage/plugin-permission-common";
import type { ResourcePermission } from "@backstage/plugin-permission-common";
import { createConditionAuthorizer } from "@backstage/plugin-permission-node";
import {
  rwCommentReadPermission,
  rwCommentCreatePermission,
  rwCommentEditPermission,
  rwCommentResolvePermission,
  rwCommentDeletePermission,
} from "@rwdocs/backstage-plugin-rw-common";
import { CommentStore } from "./CommentStore";
import { toCommentResponse } from "./mapping";
import type { CommentResponse } from "./mapping";
import { resolveAuthor } from "./author";
import { logCommentOp } from "./logging";
import { commentResourceRef } from "./permissions";
import type { CommentEventPublisher } from "./CommentEventPublisher";

const MAX_BODY_BYTES = 16 * 1024;

/**
 * Validates that `siteRef` is a well-formed Backstage entity ref string.
 * Throws InputError(400) on any parse failure so callers receive a 400, not 503.
 */
function validateSiteRef(siteRef: unknown): asserts siteRef is string {
  if (typeof siteRef !== "string" || !siteRef) throw new InputError("siteRef is required");
  try {
    parseEntityRef(siteRef);
  } catch {
    throw new InputError("Invalid siteRef");
  }
}

export interface CommentsRouterDeps {
  store: CommentStore;
  logger: LoggerService;
  httpAuth: HttpAuthService;
  auth: AuthService;
  userInfo: UserInfoService;
  permissions: PermissionsService;
  permissionsRegistry: PermissionsRegistryService;
  catalog: CatalogService;
  commentsEnabled: boolean;
  /** Optional: when present, comment create/resolve fire-and-forget a domain event.
   *  Absent in tests that don't exercise notifications. */
  publisher?: CommentEventPublisher;
}

/** Split a viewer pageRef ("<sectionRef>#<subpath>"); throws InputError(400) on a
 *  non-string, missing or leading '#'. The error messages intentionally say
 *  "documentId" — they are returned verbatim to the viewer, which only knows the
 *  frozen wire field name (not the internal `pageRef`). */
export function parsePageRef(pageRef: unknown): { sectionRef: string; subpath: string } {
  if (typeof pageRef !== "string") throw new InputError("documentId must be a string");
  const i = pageRef.indexOf("#");
  if (i <= 0) throw new InputError(`Malformed documentId: ${pageRef}`);
  return { sectionRef: pageRef.slice(0, i), subpath: pageRef.slice(i + 1) };
}

export function createCommentsRouter(deps: CommentsRouterDeps): Router {
  const router = PromiseRouter();
  const { store, logger, httpAuth, permissions, catalog } = deps;

  /**
   * Framework resource-permission check only. The caller must ALSO call
   * `assertAuthorFloor` where author ownership is required (edit, delete,
   * restore) — this function does not enforce that floor.
   *
   * Calls authorizeConditional and evaluates the returned PolicyDecision in-memory:
   * - ALLOW       → true
   * - DENY        → false
   * - CONDITIONAL → evaluates the conditions tree against `comment` using the registered ruleset
   */
  async function checkResourcePermission(
    permission: ResourcePermission,
    credentials: BackstageCredentials,
    comment: CommentResponse,
  ): Promise<boolean> {
    const [decision] = await permissions.authorizeConditional([{ permission }], { credentials });
    if (decision.result === AuthorizeResult.ALLOW) return true;
    if (decision.result === AuthorizeResult.DENY) return false;
    // CONDITIONAL: evaluate conditions tree against the in-memory comment
    const ruleset = deps.permissionsRegistry.getPermissionRuleset(commentResourceRef);
    return createConditionAuthorizer(ruleset)(decision, comment);
  }

  router.use(express.json({ limit: "64kb" }));

  if (!deps.commentsEnabled) {
    router.get("/comments/config", (_req, res) => res.json({ enabled: false }));
    router.all("/comments", (_req, res) => res.status(404).end());
    router.all("/comments/*", (_req, res) => res.status(404).end());
    return router;
  }

  router.get("/comments/config", (_req, res) => res.json({ enabled: true }));

  /**
   * Read authorization is intentionally governed by the host `siteRef`'s read scope.
   * The host site entity governs all comment content it hosts — a caller who can read
   * the site may read its comments, regardless of which section (section_ref) a comment
   * belongs to. The stored `section_ref` is for future cross-section / entity-scoped
   * querying (see `ListFilter`), not a security boundary. This is by design.
   */
  // Entity-read scope: caller must be able to read the host site entity.
  async function assertSiteVisible(req: any, siteRef: string): Promise<void> {
    const credentials = await httpAuth.credentials(req);
    let entity: Awaited<ReturnType<typeof catalog.getEntityByRef>>;
    try {
      entity = await catalog.getEntityByRef(siteRef, { credentials });
    } catch {
      throw new ServiceUnavailableError("Catalog unavailable");
    }
    if (!entity) {
      throw new NotFoundError("Site not found");
    }
  }

  async function callerUserRef(req: any): Promise<string> {
    const credentials = await httpAuth.credentials(req, { allow: ["user"] });
    const { userEntityRef } = await deps.userInfo.getUserInfo(credentials);
    return userEntityRef;
  }

  function assertAuthorFloor(userRef: string, row: { author_ref: string }): void {
    if (userRef !== row.author_ref) {
      logCommentOp(logger, {
        kind: "denied",
        op: "mutate",
        permission: "author-floor",
        userEntityRef: userRef,
      });
      throw new NotAllowedError("Only the author may perform this operation");
    }
  }

  router.get("/comments", async (req, res) => {
    if (typeof req.query.siteRef !== "string") throw new InputError("siteRef is required");
    const siteRef = req.query.siteRef;
    validateSiteRef(siteRef);
    if (typeof req.query.documentId !== "string") throw new InputError("documentId is required");
    const pageRef = req.query.documentId; // viewer wire: req.query.documentId → internal pageRef
    parsePageRef(pageRef); // 400 guard
    const credentials = await httpAuth.credentials(req);
    const decision = await permissions.authorize([{ permission: rwCommentReadPermission }], {
      credentials,
    });
    if (decision[0].result !== AuthorizeResult.ALLOW) {
      res.status(403).end();
      return;
    }
    await assertSiteVisible(req, siteRef);
    const rows = await store.list(siteRef, { pageRef });
    const callerRef = await callerUserRef(req).catch(() => undefined);
    res.json(rows.map((r) => toCommentResponse(r, callerRef)));
  });

  router.post("/comments", async (req, res) => {
    // documentId is the viewer wire field name — kept frozen on the wire and
    // renamed to the internal pageRef at the destructure so it never leaks into internals.
    const { siteRef, documentId: pageRef, parentId, body, selectors } = req.body ?? {};
    validateSiteRef(siteRef);
    parsePageRef(pageRef); // 400 guard
    if (!body || typeof body !== "string") throw new InputError("body must be a non-empty string");
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES)
      throw new InputError("body exceeds maximum length");
    if (selectors !== undefined && !Array.isArray(selectors))
      throw new InputError("selectors must be an array");
    if (parentId !== undefined && (typeof parentId !== "string" || parentId.trim() === ""))
      throw new InputError("parentId must be a non-empty string");
    const credentials = await httpAuth.credentials(req, { allow: ["user"] });
    const decision = await permissions.authorize([{ permission: rwCommentCreatePermission }], {
      credentials,
    });
    if (decision[0].result !== AuthorizeResult.ALLOW) {
      res.status(403).end();
      return;
    }

    const { authorRef, authorProfile } = await resolveAuthor({
      userInfo: deps.userInfo,
      auth: deps.auth,
      catalog,
      credentials,
    });
    if (parentId) {
      const parent = await store.get(parentId);
      if (
        !parent ||
        parent.site_ref !== siteRef ||
        parent.page_ref !== pageRef ||
        parent.parent_id !== null ||
        parent.deleted_at !== null
      ) {
        throw new InputError("Invalid parentId");
      }
    }
    const row = await store.create(siteRef, {
      pageRef,
      parentId,
      authorRef,
      authorProfile,
      body,
      selectors: selectors ?? [],
    });
    logCommentOp(logger, { kind: "mutation", op: "create", siteRef, commentId: row.id, parentId });
    res.status(201).json(toCommentResponse(row, authorRef));
    void deps.publisher?.onCommentCreated(row, authorRef);
  });

  router.get("/comments/:id", async (req, res) => {
    const row = await store.get(req.params.id);
    if (!row || row.deleted_at !== null) throw new NotFoundError("Comment not found");
    const credentials = await httpAuth.credentials(req);
    const decision = await permissions.authorize([{ permission: rwCommentReadPermission }], {
      credentials,
    });
    if (decision[0].result !== AuthorizeResult.ALLOW) {
      res.status(403).end();
      return;
    }
    await assertSiteVisible(req, row.site_ref);
    const callerRef = await callerUserRef(req).catch(() => undefined);
    res.json(toCommentResponse(row, callerRef));
  });

  router.patch("/comments/:id", async (req, res) => {
    const row = await store.get(req.params.id);
    if (!row) throw new NotFoundError("Comment not found");
    const { body, status, selectors } = req.body ?? {};
    if (status !== undefined && status !== "open" && status !== "resolved") {
      throw new InputError("Invalid status");
    }
    if (body !== undefined && (typeof body !== "string" || !body))
      throw new InputError("body must be a non-empty string");
    if (body !== undefined && Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES)
      throw new InputError("body exceeds maximum length");
    if (selectors !== undefined && !Array.isArray(selectors))
      throw new InputError("selectors must be an array");
    if (body === undefined && status === undefined && selectors === undefined)
      throw new InputError("No editable fields provided");
    const editing = body !== undefined || selectors !== undefined;
    const userRef = await callerUserRef(req);
    const credentials = await httpAuth.credentials(req, { allow: ["user"] });
    const commentAsResource = toCommentResponse(row, userRef);

    if (row.deleted_at !== null) {
      // Only restore (status:'open') is legal on a deleted row.
      if (editing || status !== "open") throw new InputError("Cannot edit a deleted comment");
      // Restore reuses rwCommentDeletePermission — the same capability gate as
      // deletion (undoing a delete is as powerful as performing one) — plus the
      // author floor so only the original author can un-delete their own comment.
      const frameworkAllowed = await checkResourcePermission(
        rwCommentDeletePermission,
        credentials,
        commentAsResource,
      );
      if (!frameworkAllowed) {
        logCommentOp(logger, {
          kind: "denied",
          op: "mutate",
          permission: "rwComment.delete",
          userEntityRef: userRef,
        });
        res.status(403).end();
        return;
      }
      assertAuthorFloor(userRef, row);
      // Same TOCTOU guard as DELETE: re-read under a row lock inside a transaction
      // and re-assert the row is still deleted before conditionally restoring.
      // Permission + author-floor checks remain outside the transaction.
      const restored = await store.transaction(async (tx) => {
        const fresh = await store.get(row.id, { executor: tx, forUpdate: true });
        if (!fresh || fresh.deleted_at === null) {
          throw new NotFoundError("Comment not found");
        }
        return store.restore(row.id, tx);
      });
      logCommentOp(logger, {
        kind: "mutation",
        op: "restore",
        siteRef: row.site_ref,
        commentId: row.id,
      });
      res.json(toCommentResponse(restored!, userRef));
      return;
    }

    if (editing) {
      // Framework check (rwCommentEditPermission) + author floor (both must pass).
      const frameworkAllowed = await checkResourcePermission(
        rwCommentEditPermission,
        credentials,
        commentAsResource,
      );
      if (!frameworkAllowed) {
        logCommentOp(logger, {
          kind: "denied",
          op: "mutate",
          permission: "rwComment.edit",
          userEntityRef: userRef,
        });
        res.status(403).end();
        return;
      }
      assertAuthorFloor(userRef, row);
    }

    if (status !== undefined) {
      // Replies cannot be resolved/reopened — canResolve is advertised false for replies.
      if (row.parent_id !== null) throw new InputError("Cannot resolve a reply");
      // status change on a live row = resolve/reopen (collaborative — no floor, but framework applies)
      const frameworkAllowed = await checkResourcePermission(
        rwCommentResolvePermission,
        credentials,
        commentAsResource,
      );
      if (!frameworkAllowed) {
        logCommentOp(logger, {
          kind: "denied",
          op: "mutate",
          permission: "rwComment.resolve",
          userEntityRef: userRef,
        });
        res.status(403).end();
        return;
      }
    }

    const updated = await store.update(row.id, {
      ...(body !== undefined ? { body } : {}),
      ...(selectors !== undefined ? { selectors } : {}),
      ...(status !== undefined ? { status } : {}),
      resolverRef: userRef,
    });
    logCommentOp(logger, {
      kind: "mutation",
      op: status ? "resolve" : "edit",
      siteRef: row.site_ref,
      commentId: row.id,
    });
    res.json(toCommentResponse(updated!, userRef));
    // Notify participants only on resolve; reopens/edits aren't a thread-ending event worth a push (spec §6 noise model).
    if (status === "resolved") {
      // Resolve the display name of the resolver (best-effort; falls back to parsed entity name).
      const resolverName = await resolveAuthor({
        userInfo: deps.userInfo,
        auth: deps.auth,
        catalog,
        credentials,
      })
        .then((a) => a.authorProfile?.displayName ?? undefined)
        .catch(() => undefined);
      void deps.publisher?.onCommentResolved(updated!, userRef, resolverName);
    }
  });

  router.delete("/comments/:id", async (req, res) => {
    const row = await store.get(req.params.id);
    if (!row || row.parent_id === null || row.deleted_at !== null)
      throw new NotFoundError("Reply not found");
    const userRef = await callerUserRef(req);
    const credentials = await httpAuth.credentials(req, { allow: ["user"] });
    const commentAsResource = toCommentResponse(row, userRef);
    // Framework check (rwCommentDeletePermission) — must pass alongside author floor.
    const frameworkAllowed = await checkResourcePermission(
      rwCommentDeletePermission,
      credentials,
      commentAsResource,
    );
    if (!frameworkAllowed) {
      logCommentOp(logger, {
        kind: "denied",
        op: "mutate",
        permission: "rwComment.delete",
        userEntityRef: userRef,
      });
      res.status(403).end();
      return;
    }
    assertAuthorFloor(userRef, row);
    // State-sensitive re-read + write inside a transaction closes the TOCTOU race
    // between the `row` read above and the mutation: re-assert the reply is still
    // live under a row lock, then conditionally soft-delete. The permission +
    // author-floor checks stay OUTSIDE the transaction so we never hold a DB lock
    // across external permission-service / auth calls.
    const deleted = await store.transaction(async (tx) => {
      const fresh = await store.get(row.id, { executor: tx, forUpdate: true });
      if (!fresh || fresh.parent_id === null || fresh.deleted_at !== null) {
        throw new NotFoundError("Reply not found");
      }
      return store.softDelete(row.id, tx);
    });
    logCommentOp(logger, {
      kind: "mutation",
      op: "delete",
      siteRef: row.site_ref,
      commentId: row.id,
    });
    // Return the full soft-deleted row so the viewer can evict the reply from its
    // local cache by documentId (viewer wire field, emitted by toCommentResponse).
    // A 204 No Content would leave the viewer without the documentId it needs to
    // locate and remove the reply from state.
    res.json(toCommentResponse(deleted!, userRef));
  });

  return router;
}
