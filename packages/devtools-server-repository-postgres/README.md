# @cnstra/devtools-server-repository-postgres

> **⚠️ Experimental**: API may change.

PostgreSQL persistence for the [CNStra](https://cnstra.org) DevTools server. A drop-in,
durable replacement for `@cnstra/devtools-server-repository-in-memory`: same
`ICNSDevToolsServerRepository` contract, but apps, topology, **stimulations and per-hop
history survive restarts** — the foundation for an admin/history panel.

## Install

```bash
npm install @cnstra/devtools-server-repository-postgres pg
```

## Usage

```ts
import { Pool } from 'pg';
import { CNSDevToolsServer } from '@cnstra/devtools-server';
import { CNSDevToolsServerRepositoryPostgres } from '@cnstra/devtools-server-repository-postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const repo = new CNSDevToolsServerRepositoryPostgres(pool);
await repo.init(); // create tables/indexes (idempotent)

const server = new CNSDevToolsServer(repo);
```

The constructor accepts anything with a `pg`-style `query(text, params)` — a `Pool`, a `Client`,
or a wrapper. `pg` is an optional peer dependency (typed structurally, so this package builds
without it).

## Options

```ts
new CNSDevToolsServerRepositoryPostgres(pool, { tablePrefix: 'cns_' });
```

## Schema

`init()` creates (with the default `cns_` prefix): `cns_app`, `cns_topology`, `cns_stimulation`
(indexed by `(app_id, started_at desc)`), `cns_hop` (indexed by `(stimulation_id, index)`,
upserts are idempotent via `on conflict (id) do nothing`), and `cns_cns_app`. Topology snapshots
and payloads are stored as `jsonb`.

## License

MIT
