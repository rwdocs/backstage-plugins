# RW Backstage Plugins

Backstage plugins for embedding [RW](https://github.com/rwdocs/rw) documentation sites.

| Plugin | Package | Description |
|--------|---------|-------------|
| Frontend | [`@rwdocs/backstage-plugin-rw`](plugins/rw) | Renders RW documentation in the Backstage UI |
| Backend | [`@rwdocs/backstage-plugin-rw-backend`](plugins/rw-backend) | Serves documentation pages via the Backstage backend |
| Search | [`@rwdocs/backstage-plugin-search-backend-module-rw`](plugins/search-backend-module-rw) | Indexes RW documentation for Backstage search |
| Common | [`@rwdocs/backstage-plugin-rw-common`](plugins/rw-common) | Shared utilities used by the other plugins |

## Installation

```bash
# Frontend
yarn --cwd packages/app add @rwdocs/backstage-plugin-rw

# Backend
yarn --cwd packages/backend add @rwdocs/backstage-plugin-rw-backend

# Search (optional)
yarn --cwd packages/backend add @rwdocs/backstage-plugin-search-backend-module-rw
```

## Compatibility and upgrades

Requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`. Upgrade the frontend, backend
and search collator together. For S3, deploy upgraded readers **before publishing
RW 0.2 bundles**. See the [RW 0.2 release notes](https://github.com/rwdocs/rw/releases/tag/v0.2.0)
for documentation syntax and content migrations.

Project images and downloads use Backstage's auth cookie. Cross-origin
installations must allow credentialed requests and cookies between frontend and
backend. Local sites need `rw.reloadInterval` to discover newly linked downloads.

Folder README URLs and corrected `#` filenames can change existing comment keys;
comments are not automatically migrated. Review the
[comment migration guidance](https://github.com/rwdocs/rw/blob/v0.2.0/docs/embedding.md#what-it-does-and-does-not-survive)
before upgrading documentation with existing comments.

## Backend Setup

Add the plugin to your backend in `packages/backend/src/index.ts`:

```ts
backend.add(import('@rwdocs/backstage-plugin-rw-backend'));
```

To enable search indexing, also add the search collator module:

```ts
backend.add(import('@rwdocs/backstage-plugin-search-backend-module-rw'));
```

### Configuration

Add to your `app-config.yaml`:

```yaml
# Local filesystem (development)
rw:
  projectDir: /path/to/your/docs

# S3 storage (production)
rw:
  s3:
    bucket: my-docs-bucket
    entity: my-component
    region: us-east-1
```

| Key | Required | Description |
|-----|----------|-------------|
| `rw.projectDir` | One of `projectDir` or `s3` | Local directory containing markdown files |
| `rw.linkPrefix` | No | URL prefix for generated links (e.g. `/rw-docs`) |
| `rw.s3.bucket` | Yes (if using S3) | S3 bucket name |
| `rw.s3.entity` | Yes (if using S3) | Entity identifier (prefix) within the bucket |
| `rw.s3.region` | No | AWS region |
| `rw.s3.endpoint` | No | Custom S3 endpoint URL |
| `rw.s3.bucketRootPath` | No | Root path within the bucket |

### Search Configuration

The search collator runs on a schedule and indexes all entities annotated with `rwdocs.org/ref`. You can customize the schedule in `app-config.yaml`:

```yaml
search:
  collators:
    rw:
      schedule:
        frequency: { minutes: 10 }
        timeout: { minutes: 15 }
        initialDelay: { seconds: 3 }
```

These are the default values — no configuration is needed unless you want to change them.

## Frontend Setup

The frontend plugin registers automatically via the [new Backstage frontend system](https://backstage.io/docs/frontend-system/). It provides:

- A standalone page at `/docs`
- An entity content tab ("Documentation") on catalog entity pages

No additional frontend configuration is required.

## Development

```bash
yarn install
yarn workspace @rwdocs/backstage-plugin-rw run build
yarn workspace @rwdocs/backstage-plugin-rw-backend run build
```

Run the dev harness (frontend + backend) with `yarn dev`.

The backend persists its SQLite database (catalog, search index, …) under a
`.data/` directory at the repo root, so state survives restarts instead of being
rebuilt from scratch each time. The directory is git-ignored. Delete it
(`rm -rf .data`) for a clean database.

## Duplicate section identities

Full section refs should be unique. For collisions, registry and search follow
RW's canonical section-root lookup and log a warning. Pages whose identity
resolves to another path are omitted from these indexes; independently named
child sections can remain indexed. Direct site-path reads are unchanged. Fix the
conflicting metadata to restore omitted pages to identity-based surfaces.
