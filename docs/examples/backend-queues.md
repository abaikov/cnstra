---
id: backend-queues
title: "Backend: Queues + CNStra"
sidebar_label: Backend Queues
slug: /examples/backend-queues
---

This tutorial shows how to consume a queue and orchestrate work with CNStra.

## 1) Define neurons

```ts
export const importUser = createNeuron(async ({ signal, axon }) => {
  const user = await externalApi.getUser(signal.userId);
  return axon.persist.createSignal(user);
});

export const persistUser = createNeuron(async ({ signal }) => {
  await db.users.collection.upsertOne(signal);
});
```

## 2) Connect BullMQ

```ts
const worker = new Worker('users', async job => {
  await cns.stimulate(importUserCollateral.createSignal({ userId: job.data.id }));
});
```

## 3) Retries and idempotency

- Prefer queue-level retries with backoff
- Make persistence idempotent (upsert by key)

## 4) Observability

- Log `onResponse` events or attach Devtools in development
- Optionally mirror derived counters into OIMDB for dashboards
