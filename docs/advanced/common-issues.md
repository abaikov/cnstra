---
id: common-issues
title: Common Issues & Troubleshooting
sidebar_label: Common Issues
slug: /advanced/common-issues
description: Common problems and solutions when working with CNStra. Learn about concurrency behavior, instance isolation, and how to avoid common pitfalls.
keywords: [troubleshooting, common issues, problems, concurrency, multiple instances, NestJS, instance isolation, debugging, FAQ]
---

This guide covers common issues you might encounter when using CNStra and how to resolve them.

## Concurrency Scope: Per-CNS Instance

**Important**: Concurrency limits in CNStra work at the level of **one CNS instance in one process**. Each CNS instance maintains its own independent concurrency gates.

### Understanding Instance-Level Concurrency

When you set a concurrency limit on a neuron using `neuron.setConcurrency(n)`, that limit applies **only within a single CNS instance**. If you create multiple CNS instances, each will have its own separate concurrency control.

```ts
// First CNS instance
const cns1 = new CNS([workerNeuron.setConcurrency(2)]);
// This instance allows max 2 concurrent executions of workerNeuron

// Second CNS instance (separate process or module)
const cns2 = new CNS([workerNeuron.setConcurrency(2)]);
// This instance ALSO allows max 2 concurrent executions
// But these limits are INDEPENDENT - total could be 4 concurrent executions
```

### Multiple Instances in NestJS

If you create multiple CNS instances in a NestJS application (e.g., in different modules), each instance will have its own independent concurrency gates:

```ts
// Module A
@Module({})
export class ModuleA {
  private cnsA = new CNS([
    apiWorker.setConcurrency(5)
  ]);
}

// Module B
@Module({})
export class ModuleB {
  private cnsB = new CNS([
    apiWorker.setConcurrency(5)  // Same neuron, but different instance
  ]);
}
```

**Result**: You could have up to **10 concurrent executions** of `apiWorker` (5 per instance), not 5 total.

### Why This Matters

This behavior is important when:

1. **Rate limiting external APIs**: If you set `concurrency: 5` to limit API calls, but create 3 CNS instances, you could end up with 15 concurrent calls instead of 5.

2. **Resource management**: Database connection pools, file handles, or other limited resources might be exhausted if multiple instances each allow their own concurrency.

3. **Shared resource contention**: If multiple instances access the same external service, the effective concurrency is the sum of all instance limits.

### Solutions

#### Option 1: Single CNS Instance (Recommended)

Create one shared CNS instance and inject it where needed:

```ts
// cns.module.ts
@Module({
  providers: [
    {
      provide: 'CNS',
      useFactory: () => new CNS([
        workerNeuron.setConcurrency(5)
      ])
    }
  ],
  exports: ['CNS']
})
export class CNSModule {}

// other.module.ts
@Module({
  imports: [CNSModule]
})
export class OtherModule {
  constructor(@Inject('CNS') private cns: CNS) {}
}
```

#### Option 2: Coordinate Concurrency Across Instances

If you must use multiple instances, coordinate concurrency limits externally:

```ts
// Use a shared semaphore or rate limiter
import { RateLimiter } from 'limiter';

const sharedLimiter = new RateLimiter({
  tokensPerInterval: 5,
  interval: 'second'
});

const workerNeuron = neuron('worker', {})
  .dendrite({
    collateral: task,
    response: async (payload, axon) => {
      await sharedLimiter.removeTokens(1);
      // Now process with shared limit
      return axon.output.createSignal(await processTask(payload));
    }
  });
```

#### Option 3: Use External Queue Systems

For production systems, use external queue systems (BullMQ, RabbitMQ, AWS SQS) that provide process-wide or distributed concurrency control:

```ts
import { Queue, Worker } from 'bullmq';

// Single queue with process-wide concurrency control
const queue = new Queue('jobs');
const worker = new Worker('jobs', async (job) => {
  const stimulation = cns.stimulate(task.createSignal(job.data));
  await stimulation.waitUntilComplete();
}, {
  concurrency: 5  // This applies across all workers in the process
});
```

See [Integrations](/docs/integrations/message-brokers) for more details. For best practices on context usage, see [Best Practices](/docs/advanced/best-practices).

## Memory Issues

### Large Payloads in Queue

If your signal payloads are large and queues grow, memory usage can spike. See [Performance](/docs/advanced/performance) for detailed guidance on managing memory.

**Quick fix**: Keep payloads small, use references (IDs) instead of full objects.

### Context Not Cleaning Up

Context data persists for the entire duration of a stimulation. If stimulations run for a long time or context grows large, memory usage increases.

**Solution**: Context is automatically cleaned up when stimulation completes. **Store only metadata in context**, not business data. Business data should flow through signal payloads:

```ts
.dendrite({
  collateral: process,
  response: async (payload, axon, ctx) => {
    // Context stores per-neuron per-stimulation metadata (not business data)
    const metadata = ctx.get();
    // Use metadata...
    
    // Business data flows through payloads
    return axon.next.createSignal({ result: payload.data });
  }
});
```

## Stimulation Not Completing

### Infinite Loops

If your neuron graph has cycles and no termination condition, stimulations can run indefinitely.

**Solution**: Set `maxNeuronHops` to prevent runaway processing:

```ts
const stimulation = cns.stimulate(signal, {
  maxNeuronHops: 100  // Stop after 100 hops
});
```

### Errors Not Being Handled

If a dendrite throws an error and you don't handle it, the stimulation might appear stuck.

**Solution**: Always handle errors in `onResponse`:

```ts
const stimulation = cns.stimulate(signal, {
  onResponse: (r) => {
    if (r.error) {
      console.error('Error:', r.error);
      // Handle or recover
    }
  }
});
```

## Type Safety Issues

### Missing Collateral Bindings

If you forget to bind a collateral, TypeScript will catch it at compile time (with exhaustive binding).

**Solution**: Use exhaustive binding to ensure all collaterals are handled:

```ts
neuron.bind(otherNeuron, {
  signal1: (p) => { /* ... */ },
  signal2: (p) => { /* ... */ },
  // TypeScript will error if signal3 is missing
});
```

## Performance Issues

### Too Many Concurrent Stimulations

Creating thousands of stimulations simultaneously can overwhelm the system.

**Solution**: Use external queue systems or batch processing. See [Performance](/docs/advanced/performance) for optimization strategies.

### Slow External APIs

If external APIs are slow and you have high concurrency, you might exhaust connection pools or hit rate limits.

**Solution**: Set appropriate per-neuron concurrency limits:

```ts
const apiNeuron = neuron('api', {})
  .setConcurrency(10)  // Limit concurrent API calls
  .dendrite({
    collateral: request,
    response: async (payload, axon) => {
      const result = await callExternalAPI(payload);
      return axon.output.createSignal(result);
    }
  });
```

## Getting Help

If you encounter issues not covered here:

1. Check the [API documentation](/docs/core/api) for correct usage
2. Review [Performance guide](/docs/advanced/performance) for optimization tips
3. See [Recipes](/docs/recipes/cancel) for common patterns
4. Open an issue on [GitHub](https://github.com/abaikov/cnstra/issues)

