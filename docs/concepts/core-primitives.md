---
id: core-primitives
title: Core Primitives
sidebar_label: Core Primitives
slug: /concepts/core-primitives
---

Core building blocks you will use most of the time.

- CNS: central orchestrator instance
- Neuron: unit of work (`createNeuron`)
- Signal: input to a neuron
- Response: output from a neuron
- Stimulation: process that runs neurons with context
- Queues: control execution order and fan-out

Example neuron:

```ts
import { createNeuron } from '@cnstra/core';

type Input = { userId: string };
type Output = { userName: string };

export const fetchUser = createNeuron<Input, Output>(async ({ signal, context }) => {
  const user = await context.services.userRepository.get(signal.userId);
  return { userName: user.name };
});
```
