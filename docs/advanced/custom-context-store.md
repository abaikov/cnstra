---
id: custom-context-store
title: Custom Context Store
sidebar_label: Custom Context Store
slug: /advanced/custom-context-store
---

Implement a custom context store for persistence, distributed systems, or specialized storage backends.

## Interface

Context stores implement `ICNSStimulationContextStore`:

```ts
interface ICNSStimulationContextStore {
  get<T>(): T | undefined;
  set<T>(value: T): void;
}
```

The default implementation is an in-memory store. For long-lived sagas or distributed systems, you can provide a persistent or shared store.

## Redis-backed context store

```ts
import { ICNSStimulationContextStore } from '@cnstra/core';
import { RedisClient } from 'redis';

class RedisContextStore implements ICNSStimulationContextStore {
  constructor(
    private client: RedisClient,
    private sessionId: string
  ) {}

  get<T>(): T | undefined {
    const raw = this.client.getSync(`cnstra:ctx:${this.sessionId}`);
    return raw ? JSON.parse(raw) : undefined;
  }

  set<T>(value: T): void {
    this.client.setSync(
      `cnstra:ctx:${this.sessionId}`,
      JSON.stringify(value),
      'EX',
      3600 // 1 hour TTL
    );
  }
}

// Use in stimulation
await cns.stimulate(signal, {
  createContextStore: () => new RedisContextStore(redisClient, 'session-123')
});
```

## Database-backed context store

```ts
class DBContextStore implements ICNSStimulationContextStore {
  constructor(
    private db: DatabaseClient,
    private runId: string
  ) {}

  get<T>(): T | undefined {
    const row = this.db.query(
      'SELECT data FROM context_store WHERE run_id = ?',
      [this.runId]
    );
    return row ? JSON.parse(row.data) : undefined;
  }

  set<T>(value: T): void {
    this.db.execute(
      'INSERT INTO context_store (run_id, data) VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET data = ?',
      [this.runId, JSON.stringify(value), JSON.stringify(value)]
    );
  }
}

await cns.stimulate(signal, {
  createContextStore: () => new DBContextStore(db, 'run-456')
});
```

## OIMDB-backed context store

For reactive frontend state:

```ts
import { db } from './oimdb-instance';

class OIMDBContextStore implements ICNSStimulationContextStore {
  constructor(private runId: string) {}

  get<T>(): T | undefined {
    const record = db.context.selectByPrimaryKey({ runId: this.runId });
    return record?.data as T | undefined;
  }

  set<T>(value: T): void {
    db.context.upsertOne({ runId: this.runId, data: value });
  }
}

await cns.stimulate(signal, {
  createContextStore: () => new OIMDBContextStore('run-789')
});
```

## Reusing context for recovery

When an error occurs, save the context store and retry:

```ts
let savedContext: ICNSStimulationContextStore | undefined;

await cns.stimulate(signal, {
  onResponse: (r) => {
    if (r.error) {
      savedContext = r.contextStore; // capture for retry
    }
  }
});

// Retry with same context
if (savedContext) {
  await cns.stimulate(retrySignal, { ctx: savedContext });
}
```

## Tips

- **Serialization**: Store only JSON-serializable data (no functions, Dates, etc.) unless using a custom serializer.
- **TTL**: For distributed stores (Redis, DB), set TTL or cleanup policies to avoid unbounded growth.
- **Performance**: Persistent stores add I/O overhead; use in-memory stores for high-throughput short-lived flows.
- **Consistency**: In distributed systems, ensure your store supports read-your-own-writes semantics if neurons might run on different nodes.

