---
id: multiple-signals
title: Returning Multiple Signals
sidebar_label: Multiple Signals
slug: /recipes/multiple-signals
---

Sometimes a neuron needs to emit multiple signals in response to a single input. CNStra supports returning arrays of signals from neuron responses.

## Basic Array Return

A neuron can return an array of signals instead of a single signal:

```ts
import { CNS, collateral, neuron } from '@cnstra/core';

const input = collateral<{ value: number }>('input');
const output1 = collateral<{ result: string }>('output1');
const output2 = collateral<{ result: string }>('output2');

const splitter = neuron('splitter', { output1, output2 }).dendrite({
  collateral: input,
  response: (payload, axon) => {
    // Return an array of signals
    return [
      axon.output1.createSignal({ result: `First: ${payload.value}` }),
      axon.output2.createSignal({ result: `Second: ${payload.value}` }),
    ];
  },
});
```

## Use Cases

### Fan-out Pattern

Split a single input into multiple parallel processing paths:

```ts
const processPayment = collateral<{ orderId: string }>('processPayment');
const updateInventory = collateral<{ orderId: string }>('updateInventory');
const notifyUser = collateral<{ orderId: string }>('notifyUser');
const logTransaction = collateral<{ orderId: string }>('logTransaction');

const orderProcessor = neuron('orderProcessor', {
  updateInventory,
  notifyUser,
  logTransaction,
}).dendrite({
  collateral: processPayment,
  response: (payload, axon) => {
    // Process payment and trigger multiple downstream actions
    return [
      axon.updateInventory.createSignal({ orderId: payload.orderId }),
      axon.notifyUser.createSignal({ orderId: payload.orderId }),
      axon.logTransaction.createSignal({ orderId: payload.orderId }),
    ];
  },
});
```

### Dynamic Signal Generation

Generate a variable number of signals based on input:

```ts
const batchInput = collateral<{ items: string[] }>('batchInput');
const itemOutput = collateral<{ item: string; index: number }>('itemOutput');

const batchProcessor = neuron('batchProcessor', { itemOutput }).dendrite({
  collateral: batchInput,
  response: (payload, axon) => {
    // Create a signal for each item
    return payload.items.map((item, index) =>
      axon.itemOutput.createSignal({ item, index })
    );
  },
});
```

### Conditional Multiple Signals

Return different numbers of signals based on conditions:

```ts
const validation = collateral<{ data: any }>('validation');
const success = collateral<{ validated: any }>('success');
const error = collateral<{ error: string }>('error');
const audit = collateral<{ action: string }>('audit');

const validator = neuron('validator', { success, error, audit }).dendrite({
  collateral: validation,
  response: (payload, axon) => {
    const signals = [];
    
    if (isValid(payload.data)) {
      signals.push(axon.success.createSignal({ validated: payload.data }));
    } else {
      signals.push(axon.error.createSignal({ error: 'Validation failed' }));
    }
    
    // Always log to audit
    signals.push(axon.audit.createSignal({ action: 'validation_attempt' }));
    
    return signals;
  },
});
```

## Async Array Return

Arrays of signals work seamlessly with async functions:

```ts
const dataFetch = collateral<{ ids: string[] }>('dataFetch');
const dataReady = collateral<{ id: string; data: any }>('dataReady');

const fetcher = neuron('fetcher', { dataReady }).dendrite({
  collateral: dataFetch,
  response: async (payload, axon) => {
    // Fetch all data asynchronously
    const results = await Promise.all(
      payload.ids.map(id => fetchData(id))
    );
    
    // Return array of signals
    return results.map((data, i) =>
      axon.dataReady.createSignal({ id: payload.ids[i], data })
    );
  },
});
```

## Empty Arrays

Returning an empty array is valid and will not propagate any signals:

```ts
const filter = neuron('filter', { output }).dendrite({
  collateral: input,
  response: (payload, axon) => {
    if (!shouldProcess(payload)) {
      return []; // No signals emitted
    }
    return [axon.output.createSignal(payload)];
  },
});
```

## Multiple Initial Signals

You can also start a stimulation with multiple signals:

```ts
const cns = new CNS([/* neurons */]);

// Stimulate with an array of signals
cns.stimulate([
  input.createSignal({ value: 1 }),
  input.createSignal({ value: 2 }),
  input.createSignal({ value: 3 }),
]);
```

## Best Practices

1. **Use for genuine fan-out**: Return arrays when you truly need parallel processing, not just for convenience
2. **Consider ordering**: Signals in the array are processed in order, but may execute concurrently based on queue settings
3. **Empty arrays are fine**: Don't hesitate to return an empty array when appropriate
4. **Mix with single signals**: You can mix neurons that return single signals with those that return arrays
5. **Type safety**: TypeScript will enforce correct signal types in arrays

## Performance Considerations

- Each signal in the array triggers its own set of subscribers
- If you have many signals, consider using concurrency limits
- Arrays are processed immediately; signals are not batched

