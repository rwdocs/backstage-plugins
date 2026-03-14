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
2. **rwPage** — Standalone page mounted at `/docs` via `PageBlueprint`
3. **rwEntityContent** — Catalog entity tab ("Documentation") via `EntityContentBlueprint`

`RwDocsViewer` is the main component. It mounts the `@rwdocs/viewer` into a DOM ref and maintains two-way navigation sync between React Router and the RW viewer instance. A `rwNavigatingRef` flag prevents infinite nav loops.

### Backend Plugin (`plugins/rw-backend/`)

`plugin.ts` reads config (`rw.projectDir` or `rw.s3`, mutually exclusive) and creates an Express router.

`router.ts` exposes four endpoints:
- `GET /health` — unauthenticated health check
- `GET /config` — returns `{ liveReloadEnabled: false }`
- `GET /navigation?scope=` — navigation tree from `RwSite`
- `GET /pages/:path(*)` — rendered page content (with path traversal protection)

### Plugin Communication

Frontend `RwClient` discovers the backend URL via `discoveryApi.getBaseUrl("rw")` and passes `fetchApi.fetch` to the RW viewer library, which makes HTTP calls to the backend endpoints.

### Configuration Schema

Defined in `plugins/rw-backend/config.d.ts`. Two modes: local filesystem (`rw.projectDir`) for development, S3 storage (`rw.s3`) for production. Optional `rw.linkPrefix` for URL prefixing.
