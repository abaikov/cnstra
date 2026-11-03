# @cnstra/progress-redis

> **⚠️ Experimental**: API may change.

A **Redis-backed resume-progress store** (`ICNSProgressRepository`) for CNStra resumable
execution — **broker-agnostic**. Use it to keep the resume checkpoint (the outstanding
frontier) in Redis with **any** broker: [`@cnstra/pg-boss`](../pg-boss),
[`@cnstra/bullmq`](../bullmq), or a bespoke worker.

The progress store is a pluggable choice, independent of the queue. This package is the
Redis option; `@cnstra/pg-boss` ships an in-package Postgres option, and `@cnstra/bullmq`
defaults to the job's own native progress.

## Install

```bash
npm install @cnstra/progress-redis ioredis
```

## Use

```ts setup
import type { Redis } from 'ioredis';
import type { CNS } from '@cnstra/core';
import type { CNSPersistOptionsRegistry, ICNSProgressRepository } from '@cnstra/persist';
import type { ICNSPgBossLike } from '@cnstra/pg-boss';
import type { TCNSNeuron } from '@cnstra/types';

declare const cns: CNS<TCNSNeuron>;
declare const registry: CNSPersistOptionsRegistry;
declare const boss: ICNSPgBossLike;
declare const connection: { host: string; port: number };
declare const myIoRedis: Redis;
declare const progress: ICNSProgressRepository;
```

```ts
import { CNSRedisProgressRepository } from '@cnstra/progress-redis';

// Own a connection…
const ownedProgress = new CNSRedisProgressRepository({
  connection: { host: '127.0.0.1', port: 6379 },
  prefix: 'cns:progress', // final key = `<prefix>:<key>`
});

// …or inject an existing ioredis client (share the one the broker already uses):
const sharedProgress = new CNSRedisProgressRepository({ redis: myIoRedis });
```

### With pg-boss

```ts
import { createCNSWorker } from '@cnstra/pg-boss';
createCNSWorker({ boss, cns, registry, queue: 'cns', resume: { repository: progress } });
```

### With BullMQ (instead of the native job progress)

```ts
import { Worker } from 'bullmq';
import { createCNSWorker } from '@cnstra/bullmq';
createCNSWorker({ Worker, cns, registry, queue: 'cns', workerOptions: { connection }, resume: { repository: progress } });
```

## Contract

Implements `ICNSProgressRepository`: `save(key, progress)`, `load(key)`, `delete(key)`.
Stores one Redis string per key (`<prefix>:<key>` → serialized `TCNSProgress`). `close()`
quits an owned client (no-op for an injected one).

## License

MIT
