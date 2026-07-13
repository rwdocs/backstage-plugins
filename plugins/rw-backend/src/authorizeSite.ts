import type {
  AuditorService,
  BackstageCredentials,
  HttpAuthService,
  PermissionsService,
} from "@backstage/backend-plugin-api";
import { NotFoundError } from "@backstage/errors";
import { catalogEntityReadPermission } from "@backstage/plugin-catalog-common/alpha";
import { AuthorizeResult } from "@backstage/plugin-permission-common";
import { fromEntityPath } from "@rwdocs/backstage-plugin-rw-common";
// Aliased: the bare name resolves to the DOM's fetch Request, not Express's.
import type { Request as ExpressRequest } from "express";

/** How long a decision is reused. Matches TechDocs' CachedEntityLoader: long enough to collapse a
 *  page view's burst of requests, short enough that a revoked permission takes effect promptly. */
const DECISION_TTL_MS = 5_000;

/** Bounds memory: decisions are keyed per (caller, site), and a busy instance sees many of both. */
const MAX_CACHED_DECISIONS = 1000;

export interface SiteAuthorizerDeps {
  permissions: PermissionsService;
  httpAuth: HttpAuthService;
  auditor: AuditorService;
  now?: () => number;
}

/**
 * A site's docs are readable by whoever may read the site's catalog entity.
 *
 * The site is the unit of access because the site is the repo: everything one serves comes from a
 * single source tree, published under a single entity's prefix. A section claim inside that tree
 * (`rwdocs.org/ref: <site>#<section>`) scopes an entity's Docs *view*, and drives attribution for
 * search, comments and the changes feed — it is not an access boundary, and treating it as one
 * would gate pages on entities whose readers can already fetch the same markdown from the repo.
 * Docs that need a narrower audience get their own repo, hence their own site, hence their own
 * entity to gate on.
 *
 * This is the rule the comments router already applies when it gates comment reads on the host site
 * entity, and the one TechDocs applies to its own docs — it has no permission of its own and simply
 * requires read on the entity the docs belong to.
 *
 * Two properties this inherits from the framework, and does not try to override, because every
 * other Backstage plugin (the catalog included) behaves the same way — so overriding them here
 * would buy no protection while breaking legitimate callers:
 * - With `permission.enabled: false` (the default), every decision is ALLOW.
 * - A **service** principal is always ALLOWed. A service token is a trusted backend identity, not
 *   an end user; a holder could read the same entities straight from the catalog.
 */
export class SiteAuthorizer {
  /** (caller, site) -> decision. Insertion-ordered, so the oldest entry is the first key. */
  private readonly decisions = new Map<string, { allowed: boolean; expiresAt: number }>();
  private readonly now: () => number;

  constructor(private readonly deps: SiteAuthorizerDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * Throws the same {@link NotFoundError} an unknown site throws, so a caller cannot tell a site
   * they may not read from one that does not exist.
   */
  async assertReadable(req: ExpressRequest, siteEntityPath: string): Promise<void> {
    const credentials = await this.deps.httpAuth.credentials(req);
    const key = `${principalKey(credentials)}|${siteEntityPath}`;

    const cached = this.decisions.get(key);
    if (cached && cached.expiresAt > this.now()) {
      if (cached.allowed) return;
      throw this.notFound(siteEntityPath);
    }

    const [decision] = await this.deps.permissions.authorize(
      [{ permission: catalogEntityReadPermission, resourceRef: fromEntityPath(siteEntityPath) }],
      { credentials },
    );
    // A missing decision denies: an authorize call that answers nothing is not an ALLOW.
    const allowed = decision?.result === AuthorizeResult.ALLOW;
    this.remember(key, allowed);

    if (!allowed) {
      const error = this.notFound(siteEntityPath);
      // Audited, not logged: the caller must not be able to tell a denial from a missing site, but
      // an operator debugging "my docs 404" needs to. Only a *fresh* denial is audited — a denied
      // browser retries, and re-auditing every retry would let one caller flood the audit log.
      const event = await this.deps.auditor.createEvent({
        eventId: "site-read",
        severityLevel: "medium",
        request: req,
        meta: { siteEntityPath },
      });
      await event.fail({ error });
      throw error;
    }
  }

  private notFound(siteEntityPath: string): NotFoundError {
    return new NotFoundError(`No documentation site found for entity: ${siteEntityPath}`);
  }

  private remember(key: string, allowed: boolean): void {
    // Re-inserting moves the key to the end, so eviction stays least-recently-decided.
    this.decisions.delete(key);
    this.decisions.set(key, { allowed, expiresAt: this.now() + DECISION_TTL_MS });
    if (this.decisions.size > MAX_CACHED_DECISIONS) {
      const oldest = this.decisions.keys().next().value;
      if (oldest !== undefined) this.decisions.delete(oldest);
    }
  }
}

/**
 * The caller identity a decision belongs to. It must not be the raw token: a user holds many tokens
 * over a session, and each would miss the cache and pin a credential in memory. The permission
 * policy decides on the principal, so the principal is the correct cache key.
 */
function principalKey(credentials: BackstageCredentials): string {
  const principal = credentials.principal as {
    type: string;
    userEntityRef?: string;
    subject?: string;
  };
  switch (principal.type) {
    case "user":
      return `user:${principal.userEntityRef}`;
    case "service":
      return `service:${principal.subject}`;
    default:
      return principal.type;
  }
}
