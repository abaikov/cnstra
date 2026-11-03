# @cnstra/devtools-server-repository-redis

> **⚠️ Experimental**: API may change.

Redis persistence for the [CNStra](https://cnstra.org) DevTools server. A drop-in, resumable
replacement for `@cnstra/devtools-server-repository-in-memory`: same
`ICNSDevToolsServerRepository` contract, backed by Redis so apps and topology snapshots outlive a
restart.

## Install

```bash
npm install @cnstra/devtools-server-repository-redis ioredis
```

## Usage

```ts
import Redis from 'ioredis';
import { CNSDevToolsServer } from '@cnstra/devtools-server';
import { CNSDevToolsServerRepositoryRedis } from '@cnstra/devtools-server-repository-redis';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const repo = new CNSDevToolsServerRepositoryRedis(redis);

const server = new CNSDevToolsServer(repo);
```

The constructor accepts any [ioredis](https://github.com/redis/ioredis)-style client. `ioredis`
is an optional peer dependency (the client is typed structurally). `node-redis` v4 uses
camel-cased command names instead of the lowercase ioredis ones and is **not** directly compatible.

## Options

```ts
import Redis from 'ioredis';
import { CNSDevToolsServerRepositoryRedis } from '@cnstra/devtools-server-repository-redis';

new CNSDevToolsServerRepositoryRedis(new Redis(), { keyPrefix: 'cns:' });
```

## Data layout

With the default `cns:` prefix: `cns:apps` (hash, appId → app JSON), `cns:topology` (hash,
cnsId → snapshot JSON; the app of a CNS is read from its snapshot). Run history (Stimulation → Attempt → Task) is not kept here: it lives in the
`ICNSStimulationRepository` you pass as the second argument of `CNSDevToolsServer`.

## License

MIT
