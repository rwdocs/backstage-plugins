# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Backstage plugin pair for embedding RW documentation sites. Yarn 4.12.0 workspace monorepo with two plugins:

- **`@rwdocs/backstage-plugin-rw`** (frontend) — Renders RW docs in Backstage UI via `@rwdocs/viewer`
- **`@rwdocs/backstage-plugin-rw-backend`** (backend) — Express-based API serving docs via `@rwdocs/core`

## Commands

```bash
# Full build + typecheck + lint + format
make all

# Build all plugins (install deps, backstage-cli build)
make build

# Type-check (tsc --noEmit across all plugins)
make typecheck

# Lint (ESLint via backstage-cli package lint)
make lint

# Format (Prettier, printWidth: 100)
make format

# Build a single plugin
yarn workspace @rwdocs/backstage-plugin-rw run build
yarn workspace @rwdocs/backstage-plugin-rw-backend run build

# Lint a single plugin
yarn workspace @rwdocs/backstage-plugin-rw run lint
yarn workspace @rwdocs/backstage-plugin-rw-backend run lint
```

Tests use `backstage-cli package test` (Jest). Note: `backstage-cli` forces `--watch` mode by default, ignoring jest config. Always pass `--watchAll=false` when running tests:

```bash
yarn workspace @rwdocs/backstage-plugin-rw run test --watchAll=false
yarn workspace @rwdocs/backstage-plugin-rw-backend run test --watchAll=false
```

## Architecture

### Frontend Plugin (`plugins/rw/`)

Defines three Backstage extensions in `plugin.tsx`:
1. **rwApi** — `ApiBlueprint` providing `RwClient` (wraps `discoveryApi` + `fetchApi`)
2. **rwPage** — Standalone page mounted at `/docs` via `PageBlueprint`, renders `RwStandaloneViewer`
3. **rwEntityContent** — Catalog entity tab ("Documentation") via `EntityContentBlueprint`, renders `RwEntityDocsViewer` (filtered by `rwdocs.org/ref` annotation)

Three viewer components:
- **`RwDocsViewer`** — Core component that mounts `@rwdocs/viewer` into a DOM ref, maintains two-way navigation sync between React Router and the RW viewer instance, and resolves cross-entity section refs. A `rwNavigatingRef` flag prevents infinite nav loops.
- **`RwEntityDocsViewer`** — Wrapper for catalog entity pages. Reads the entity's `rwdocs.org/ref` annotation via `parseAnnotation` and passes the resolved API base URL and section ref to `RwDocsViewer`.
- **`RwStandaloneViewer`** — Wrapper for the standalone `/docs` page. Reads `rw.rootEntity` from config to determine which entity to render.

### Backend Plugin (`plugins/rw-backend/`)

`plugin.ts` reads config (`rw.projectDir` or `rw.s3`, mutually exclusive) and creates a `Hub` for managing `RwSite` instances.

Key backend classes:
- **`Hub`** — Manages multiple `RwSite` instances with LRU eviction. In `projectDir` mode, serves a single pre-configured site. In `s3` mode, creates sites on demand.

`router.ts` exposes entity-scoped endpoints under `/site/:namespace/:kind/:name/`:
- `GET /health` — unauthenticated health check (not entity-scoped)
- `GET /site/:namespace/:kind/:name/config` — returns `{ liveReloadEnabled: false }`
- `GET /site/:namespace/:kind/:name/navigation?sectionRef=` — navigation tree from `RwSite`
- `GET /site/:namespace/:kind/:name/pages/:path(*)` — rendered page content (with path traversal protection)

Middleware resolves the entity path from URL params to look up the corresponding `RwSite` from the Hub.

### Plugin Communication

Frontend `RwClient` discovers the backend URL via `discoveryApi.getBaseUrl("rw")` and constructs entity-scoped URLs (e.g., `/site/default/component/my-docs/`). It passes `fetchApi.fetch` to the RW viewer library, which makes HTTP calls to the backend endpoints.

### Configuration Schema

Defined in `plugins/rw-backend/config.d.ts` and `plugins/rw/config.d.ts`. Two modes: local filesystem (`rw.projectDir` + `rw.entity`) for development, S3 storage (`rw.s3`) for production. Optional `rw.rootEntity` (frontend-visible) sets the entity for the standalone `/docs` page.
