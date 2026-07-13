# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Backstage plugins for embedding RW documentation sites. Yarn 4.12.0 workspace monorepo with six packages:

- **`@rwdocs/backstage-plugin-rw`** (frontend) — Renders RW docs in Backstage UI via `@rwdocs/viewer`
- **`@rwdocs/backstage-plugin-rw-backend`** (backend) — Express-based API serving docs via `@rwdocs/core`
- **`@rwdocs/backstage-plugin-search-backend-module-rw`** (search) — Indexes RW documentation for Backstage search via a collator module
- **`@rwdocs/backstage-plugin-rw-common`** (common) — Shared utilities: entity path construction, annotation parsing, S3 config reading
- **`@rwdocs/backstage-plugin-rw-node`** (node-library) — Knex-free shared library: the comment-processing extension point (`rwCommentProcessingExtensionPoint`) plus the `CommentProcessor` / `CommentActivity` types. rw-backend registers the extension point and pushes a resolved `CommentActivity`; the notifications module registers a `CommentProcessor`. No `@rwdocs/core`, no DB.
- **`@rwdocs/backstage-plugin-rw-backend-module-notifications`** (notifications) — Opt-in backend module: registers a `CommentProcessor` on rw-backend's comment-processing extension point that formats a resolved `CommentActivity` and delivers doc-comment notifications via the native notifications plugin. No DB, events, or catalog.

## Commands

The root `package.json` exposes workspace-wide scripts that fan out to every
`@rwdocs/*` plugin via `yarn workspaces foreach` (so adding a plugin needs no
script changes):

```bash
# Full typecheck + lint + test + format + build
yarn all

# Build all plugins (topological order)
yarn build

# Type-check (tsc across all plugins)
yarn typecheck

# Lint (ESLint via backstage-cli package lint)
yarn lint

# Test (backstage-cli package test, --watchAll=false)
yarn test

# Format (Prettier, printWidth: 100) / check-only
yarn format
yarn format:check

# Publish all publishable plugins to npm (release CI uses this)
yarn publish:all

# Bump every plugin to a version (e.g. release prep)
yarn version:all 0.2.0

# Build a single plugin
yarn workspace @rwdocs/backstage-plugin-rw run build
yarn workspace @rwdocs/backstage-plugin-rw-backend run build
yarn workspace @rwdocs/backstage-plugin-search-backend-module-rw run build

# Lint a single plugin
yarn workspace @rwdocs/backstage-plugin-rw run lint
yarn workspace @rwdocs/backstage-plugin-rw-backend run lint
yarn workspace @rwdocs/backstage-plugin-search-backend-module-rw run lint
```

Tests use `backstage-cli package test` (Jest). Note: `backstage-cli` forces `--watch` mode by default, ignoring jest config. Always pass `--watchAll=false` when running tests:

```bash
yarn workspace @rwdocs/backstage-plugin-rw run test --watchAll=false
yarn workspace @rwdocs/backstage-plugin-rw-backend run test --watchAll=false
yarn workspace @rwdocs/backstage-plugin-search-backend-module-rw run test --watchAll=false
```

## Architecture

### Common Library (`plugins/rw-common/`)

Shared utilities used by both frontend and backend plugins:
- **`entityPath`** — Converts between entity refs (`kind:namespace/name`) and URL path segments (`namespace/kind/name`) using `@backstage/catalog-model`
- **`parseAnnotation`** — Parses `rwdocs.org/ref` entity annotations into site ref and optional section ref
- **`attribution`** — **Which catalog entity documents which part of a site.** The single source of that rule (see below)
- **`sitePageRef`** — `SitePageRef` and its `stringifySitePageRef` / `parseSitePageRef` pair: a page's absolute identity (`<siteRef>#<sectionRef>[#<subpath>]`) as one string, for consumers that must pass a page handle around with no ambient site (e.g. an MCP search hit fed into a read tool)
- **`config`** — Reads S3 configuration (`S3Config`) from Backstage config

Also owns the Backstage configuration schema (`config.d.ts`).

#### Attribution (`attribution.ts`)

A page belongs to exactly one entity: the one claiming the nearest section at or above it (`nearestClaim`), else the entity documenting the site as a whole (`rootClaimOf`). Several entities can *reach* a page — a system, its domain and the site root all show it in their Docs tab — but only the nearest owns it.

Consumers: `siteIndex/runScan` + `siteIndex/effectiveOwnership` (comment inbox, changes feed, notifications) and `RwDocsCollatorFactory` (search). **A new surface must call this, not re-derive it** — it was implemented twice before and the copies silently disagreed, attributing one page to different entities depending on where you looked.

### Frontend Plugin (`plugins/rw/`)

Defines two Backstage extensions in `plugin.tsx`:
1. **rwApi** — `ApiBlueprint` providing `RwClient` (wraps `discoveryApi` + `fetchApi`)
2. **rwEntityContent** — Catalog entity tab ("Documentation") via `EntityContentBlueprint`, renders `RwEntityDocsViewer` (filtered by `rwdocs.org/ref` annotation)

Two viewer components:
- **`RwDocsViewer`** — Core component that mounts `@rwdocs/viewer` into a DOM ref, maintains two-way navigation sync between React Router and the RW viewer instance, and resolves cross-entity section refs. A `rwNavigatingRef` flag prevents infinite nav loops.
- **`RwEntityDocsViewer`** — Wrapper for catalog entity pages. Reads the entity's `rwdocs.org/ref` annotation via `parseAnnotation` and passes the resolved API base URL and section ref to `RwDocsViewer`.

#### Docs page (standalone, tabbed)

The plugin also contributes a standalone **Docs** surface, built with the new
Frontend System's native tabbed-page support:

- **`rwDocsPage`** — a `PageBlueprint` (`name: "docs"` → extension id
  `page:rw/docs`) mounted at **`/docs`**, `title: "Docs"`, icon `LibraryBooks`,
  `routeRef: docsRouteRef`, with **no loader**. With no loader and ≥1 attached
  sub-page, the framework renders the plugin header + a tab strip and redirects
  bare `/docs` to the first tab. The sidebar nav item is auto-discovered from the
  page's `title`/`icon`/`routeRef` (no nav-item extension — `NavItemBlueprint`
  was removed in `@backstage/frontend-plugin-api` 0.17.0).
- **`rwCommentsSubPage`** — a `SubPageBlueprint` (`name: "comments"` → id
  `sub-page:rw/comments`) at **`/docs/comments`**, tab label "Comments", rendering
  `CommentInboxPage` (the doc-comment inbox). It attaches to the page explicitly
  by id (`attachTo: { id: "page:rw/docs", input: "pages" }`); the default
  `relative` attachTo resolves to the un-named id `page:rw`, not the named
  `page:rw/docs`, so the explicit id is required.

**Configuring the route prefix.** The `/docs` path is the default and is
overridable per Backstage instance via standard extension config — no custom
schema. This matters because TechDocs also defaults to `/docs`; if both plugins
are installed, override one:

```yaml
app:
  extensions:
    - page:rw/docs:
        config:
          path: /rwdocs
```

(The Comments tab's own path is likewise overridable via the `sub-page:rw/comments`
extension config if ever needed.)

### Backend Plugin (`plugins/rw-backend/`)

`plugin.ts` reads config (`rw.projectDir` or `rw.s3`, mutually exclusive) and creates a `Hub` for managing `RwSite` instances.

Key backend classes:
- **`Hub`** — Manages multiple `RwSite` instances with LRU eviction. In `projectDir` mode, serves a single pre-configured site. In `s3` mode, creates sites on demand.

**Read authorization.** Every site-scoped route authorizes `catalogEntityReadPermission` on the
**site entity** — enforced once, in the site middleware, so a route added later cannot forget it,
and `/config` is covered too. A DENY returns the same 404 as an unknown site, so it is not an
existence oracle. Like every Backstage permission check, it only bites when `permission.enabled`
is true (the framework returns ALLOW for everything otherwise, and always for service principals).
See `authorizeSite.ts`.

Decisions are cached per `(principal, site)` for 5s — a page view is a burst of requests, and
without it every one of them is a permission-backend round trip (the same trade TechDocs makes in
`CachedEntityLoader`). A denial is reported to the **auditor** service (`eventId: "site-read"`),
never to the caller and never to the logger: the 404 must stay indistinguishable, but an operator
debugging "my docs 404" needs to tell a refusal from a missing site. Only a *fresh* denial is
audited, so a retrying client cannot flood the audit log.

The site is the unit of access because the site is the repo: everything it serves comes from one
source tree published under one entity's prefix. A section claim (`rwdocs.org/ref: <site>#<section>`)
scopes an entity's Docs *view* and drives attribution for search, comments and the changes feed —
it is **not** an access boundary. Docs needing a narrower audience get their own repo, hence their
own site and entity to gate on. This is the rule the comments router already applies when it gates
comment reads on the host site entity, and the one TechDocs applies to its own docs.

`router.ts` exposes entity-scoped endpoints under `/site/:namespace/:kind/:name/`:
- `GET /health` — unauthenticated health check (not entity-scoped)
- `GET /site/:namespace/:kind/:name/config` — returns `{ liveReloadEnabled: false }`
- `GET /site/:namespace/:kind/:name/navigation?sectionRef=` — navigation tree from `RwSite`
- `GET /site/:namespace/:kind/:name/pages/:path(*)` — rendered page content (with path traversal protection)
- `GET /site/:namespace/:kind/:name/markdown?sectionRef=&subpath=` — a page's Markdown source, addressed by its `(sectionRef, subpath)` identity rather than a site path, so a search hit can be read back directly. An omitted `subpath` is the section root.

Middleware resolves the entity path from URL params to look up the corresponding `RwSite` from the Hub.

### Search Collator Module (`plugins/search-backend-module-rw/`)

Backstage backend module (`pluginId: "search"`, `moduleId: "rw-collator"`) that indexes RW documentation for search.

Key classes:
- **`RwDocsCollatorFactory`** — Implements `DocumentCollatorFactory`. Discovers entities annotated with `rwdocs.org/ref` via `catalogServiceRef` (paginated with `queryEntities`), creates `RwSite` instances to render pages, and emits `RwIndexableDocument` entries. Supports configurable result type (`search.collators.rw.type`, default `"rw"`), location URL template, and schedule.

  Pages come from `listPages()`, which carries each page's `path`, `hasContent` and `anchors` (every enclosing section paired with the page's path relative to it). `getNavigation()` is not a substitute: it stops at a section boundary and never yields the pages below one. Ownership per page is `attribution` (see rw-common); each site is loaded once, not once per annotated entity.

  Each document carries the page's identity — `siteRef` + `(sectionRef, subpath)` — so a consumer can read it back via rw-backend's `/markdown`. `location` can't serve that (configurable route, relative to the owning entity), and `authorization` can't either (the search backend strips it before results reach callers).

  A hit is filtered by `catalogEntityReadPermission` on the **site** entity (`authorization.resourceRef = siteRef`) — the same rule rw-backend's read routes apply, so search can never hide a page the read route still serves. That is deliberately *not* the entity the page is attributed to: `entityRef` answers "which entity documents this page" (for `location` and ownership), while access is a property of the site, because a site is one repo.

`module.ts` registers the collator with the search index via `searchIndexRegistryExtensionPoint` from `@backstage/plugin-search-backend-node/alpha`.

Configuration schema defined in `config.d.ts`. Schedule defaults: every 10 minutes, 15-minute timeout, 3-second initial delay.

### Plugin Communication

Frontend `RwClient` discovers the backend URL via `discoveryApi.getBaseUrl("rw")` and constructs entity-scoped URLs (e.g., `/site/default/component/my-docs/`). It passes `fetchApi.fetch` to the RW viewer library, which makes HTTP calls to the backend endpoints.

### Configuration Schema

Defined in `plugins/rw-common/config.d.ts`. Two modes: local filesystem (`rw.projectDir` + `rw.entity`) for development, S3 storage (`rw.s3`) for production.
