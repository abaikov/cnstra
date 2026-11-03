# @cnstra/devtools-server-repository-postgres

> **⚠️ Experimental**: API may change.

PostgreSQL persistence for the [CNStra](https://cnstra.org) DevTools server. A drop-in,
resumable replacement for `@cnstra/devtools-server-repository-in-memory`: same
`ICNSDevToolsServerRepository` contract, but **apps and topology survive restarts** — the
foundation for an admin/history panel.

## Install

```bash
npm install @cnstra/devtools-server-repository-postgres pg
```

## Usage

```ts setup
import { Pool } from 'pg';
import { CNSDevToolsServer } from '@cnstra/devtools-server';
import { CNSDevToolsServerRepositoryPostgres } from '@cnstra/devtools-server-repository-postgres';
```

```ts
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const repo = new CNSDevToolsServerRepositoryPostgres(pool);
await repo.init(); // create tables/indexes (idempotent)

const server = new CNSDevToolsServer(repo);
```

The constructor accepts a `pg`-style pool: `query(text, params)` plus `connect()` returning a releasable
client, which `init()` uses for the migration transaction. `pg` is an optional peer dependency (typed structurally, so this package builds
without it).

## Options

```ts
declare const pool: Pool;

new CNSDevToolsServerRepositoryPostgres(pool, { tablePrefix: 'cns_' });
```

## Schema

`init()` creates or upgrades (with the default `cns_` prefix) `cns_topology`, and records
the applied steps in `cns_devtools_migration`; `verify()` writes nothing and fails when a step is missing.
Writes are upserts, so repeating them is idempotent. Topology snapshots are stored as `jsonb`; the app of a
CNS is read from its topology row.

## License

MIT
