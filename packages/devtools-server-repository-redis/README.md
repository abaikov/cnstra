# @cnstra/devtools-server-repository-redis

> **⚠️ Experimental**: API may change.

Redis persistence for the [CNStra](https://cnstra.org) DevTools server. A drop-in, durable
replacement for `@cnstra/devtools-server-repository-in-memory`: same
`ICNSDevToolsServerRepository` contract, backed by Redis so apps, topology, stimulations and
per-hop history outlive a restart.

## Install

```bash
npm install @cnstra/devtools-server-repository-redis ioredis
```

## Usage

```ts
import Redis from 'ioredis';
import { CNSDevToolsServer } from '@cnstra/devtools-server';
import { CNSDevToolsServerRepositoryRedis } from '@cnstra/devtools-server-repository-redis';

const redis = new Redis(process.env.REDIS_URL);
const repo = new CNSDevToolsServerRepositoryRedis(redis);

const server = new CNSDevToolsServer(repo);
```

The constructor accepts any [ioredis](https://github.com/redis/ioredis)-style client. `ioredis`
is an optional peer dependency (the client is typed structurally). `node-redis` v4 uses
different method names (`hSet`, `hGetAll`, …) and is **not** directly compatible.

## Options

```ts
new CNSDevToolsServerRepositoryRedis(redis, { keyPrefix: 'cns:' });
```

## Data layout

With the default `cns:` prefix: `cns:apps` / `cns:topology` / `cns:cnsToApp` (hashes),
`cns:stim:{id}` (stimulation JSON), `cns:stims:{appId}` (zset scored by `startedAt` for
ordering/paging and time-range filters), `cns:hops:{stimId}` (list), `cns:appToCns:{appId}`
(set). `hasError` / `collateralId` / `neuronId` filters are applied in memory after the
time-range zset scan — fine at DevTools scale.

## License

MIT
