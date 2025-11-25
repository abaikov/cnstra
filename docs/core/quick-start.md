---
id: quick-start
title: Quick Start - Install and Use CNStra in 5 Minutes
sidebar_label: Quick Start
slug: /core/quick-start
description: Get started with CNStra in 5 minutes. Install the zero-dependency state machine library, create your first neuron, and build type-safe orchestration for React, Node.js, or backend systems.
keywords: [quick start, getting started, installation, npm install, first example, tutorial, beginner guide, state machine example, orchestration setup, React state management tutorial, Node.js orchestration, TypeScript state machine tutorial]
---

## Installation

Install CNStra using your preferred package manager:

```bash
# Core
npm i @cnstra/core

# Optional: React bindings
npm i @cnstra/react

# Optional: Devtools (for local debugging)
npm i -D @cnstra/devtools @cnstra/devtools-server @cnstra/devtools-transport-ws
```

**Requirements:**
- Node 18+
- TypeScript 5+ (recommended)

## Minimal Example

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
const stimulation = cns.stimulate(userCreated.createSignal({ id: '123', name: 'John Doe' }));
await stimulation.waitUntilComplete();
```

## Next Steps

- Understand the architecture: [CNStra Overview](/docs/concepts/cnstra)
- Explore API: [Core API](/docs/core/api)
- Use in React: [React Patterns](/docs/frontend/react-patterns)
 - Debugging: [DevTools](/docs/devtools/overview)
