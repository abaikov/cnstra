---
id: quick-start
title: Quick Start
sidebar_label: Quick Start
slug: /core/quick-start
---

```bash
npm install @cnstra/core
```

```ts
import { CNS, collateral, neuron } from '@cnstra/core';

const userCreated = collateral<{ id: string; name: string }>('user:created');
const userRegistered = collateral<{ userId: string; status: string }>('user:registered');

const userService = neuron('user-service', { userRegistered }).dendrite({
  collateral: userCreated,
  response: (payload, axon) => {
    console.log(`Processing user: ${payload.name}`);
    return axon.userRegistered.createSignal({ userId: payload.id, status: 'completed' });
  }
});

const cns = new CNS([userService]);
await cns.stimulate(userCreated.createSignal({ id: '123', name: 'John Doe' }));
```
