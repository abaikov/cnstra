---
id: bullmq
title: BullMQ Integration
sidebar_label: BullMQ
slug: /integrations/bullmq
---

Use BullMQ to schedule work and feed signals into CNStra.

```ts
import { Queue, Worker } from 'bullmq';
import { CNS } from '@cnstra/core';

const queue = new Queue('jobs');
const cns = new CNS();

new Worker('jobs', async job => {
  // Convert job data into a CNStra signal
  await cns.stimulate(myCollateral.createSignal(job.data));
});

// Enqueue work somewhere else
await queue.add('importUser', { userId: '42' });
```

Tips:
- Use BullMQ rate limits and concurrency to protect resources
- Store intermediate or aggregated state in OIMDB or a real DB
- For retries, prefer BullMQ retry/backoff plus idempotent neurons
