# RW Backstage Plugins

Backstage plugins for embedding [RW](https://github.com/rwdocs/rw) documentation sites.

| Plugin | Package | Description |
|--------|---------|-------------|
| Frontend | [`@rwdocs/backstage-plugin-rw`](plugins/rw) | Renders RW documentation in the Backstage UI |
| Backend | [`@rwdocs/backstage-plugin-rw-backend`](plugins/rw-backend) | Serves documentation pages via the Backstage backend |

## Installation

```bash
# Frontend
yarn --cwd packages/app add @rwdocs/backstage-plugin-rw

# Backend
yarn --cwd packages/backend add @rwdocs/backstage-plugin-rw-backend
```

## Backend Setup

Add the plugin to your backend in `packages/backend/src/index.ts`:

```ts
backend.add(import('@rwdocs/backstage-plugin-rw-backend'));
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
