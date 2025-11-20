---
id: retry-stimulation
title: Retry Stimulation
sidebar_label: Retry Stimulation
slug: /recipes/retry-stimulation
---

When a stimulation fails or is interrupted, you can wait for active tasks to complete and then retry from the same point using `cns.activate()` with failed tasks.

This pattern ensures that:
- Active tasks finish executing before saving state
- Only failed tasks are retried
- State can be passed through signal payloads if needed

## Basic Pattern

```ts
import { CNS, collateral, neuron } from '@cnstra/core';

const input = collateral<{ id: number }>('input');
const step1Out = collateral<{ id: number }>('step1Out');
const step2Out = collateral<{ id: number }>('step2Out');
const output = collateral<{ result: string }>('output');

const step1 = neuron('step1', { step1Out }).dendrite({
  collateral: input,
  response: async (payload, axon) => {
    await processStep1(payload);
    return axon.step1Out.createSignal({ id: payload.id });
  },
});

const step2 = neuron('step2', { step2Out }).dendrite({
  collateral: step1Out,
  response: async (payload, axon) => {
    await processStep2(payload);
    return axon.step2Out.createSignal({ id: payload.id });
  },
});

const step3 = neuron('step3', { output }).dendrite({
  collateral: step2Out,
  response: async (payload, axon) => {
    return axon.output.createSignal({ result: `Final: ${payload.id}` });
  },
});

const cns = new CNS([step1, step2, step3]);

// First attempt
let savedFailedTasks: Array<{
  stimulationId: string;
  neuronId: string;
  dendriteCollateralName: string;
}> | undefined;

const stimulation = cns.stimulate(input.createSignal({ id: 100 }));

try {
  // waitUntilComplete() waits for all active tasks to finish
  // even if there's an error, active tasks will complete first
  await stimulation.waitUntilComplete();
} catch (error) {
  // After active tasks complete, save failed tasks for retry
  savedFailedTasks = stimulation.getFailedTasks().map(ft => ft.task);
}

// Retry attempt: resume from failed tasks
if (savedFailedTasks) {
  const retryStimulation = cns.activate(savedFailedTasks);
  
  await retryStimulation.waitUntilComplete();
}
```

## Passing State Through Payloads

If you need to preserve state across retries, pass it through signal payloads:

```ts
// Include state in payload
const input = collateral<{ id: number; executed?: string[] }>('input');

const step1 = neuron('step1', { step1Out }).dendrite({
  collateral: input,
  response: async (payload, axon) => {
    const executed = payload.executed || [];
    await processStep1(payload);
    // Pass state forward in signal
    return axon.step1Out.createSignal({ 
      id: payload.id,
      executed: [...executed, 'step1']
    });
  },
});
```

## Key Points

- `stimulation.waitUntilComplete()` waits for all active tasks to finish before resolving or rejecting
- `stimulation.getFailedTasks()` returns tasks that failed or were aborted
- `cns.activate()` resumes execution from specific tasks
- State can be passed through signal payloads if needed

## Notes

- This pattern works with any retry mechanism: queue systems (BullMQ, SQS, RabbitMQ), custom retry endpoints, scheduled jobs, or manual retry triggers
- You can persist the failed tasks to a database, Redis, or any storage system, then restore them when retrying
- If you need to preserve state, include it in signal payloads and pass it through the chain
- Active tasks are allowed to complete before saving state, ensuring consistency

