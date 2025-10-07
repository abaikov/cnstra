---
id: performance
title: Performance Optimization & Memory Management for State Machines
sidebar_label: Performance
slug: /advanced/performance
description: Optimize CNStra performance and memory usage. Learn zero-dependency design, sync-first execution, memory-efficient patterns, benchmarking, and best practices for high-throughput orchestration.
keywords: [performance optimization, memory management, zero dependencies, lightweight library, benchmark, profiling, scalability, high throughput, low latency, memory efficiency, performance best practices, optimization techniques, bundle size, tree shaking, code splitting]
---

CNStra is designed to be memory-efficient and fast for reactive orchestration.

## Memory-efficient design

- **Zero dependencies**: No third-party packages, minimal bundle size.
- **No error storage**: Errors are delivered via callbacks, not accumulated in memory.
- **Streaming responses**: Signal traces are delivered via `onResponse` callbacks, not buffered.
- **Context on-demand**: Context stores are created only when needed via `withCtx()`.
- **No global state**: Each stimulation starts with a clean slate; no ambient listeners.

## Performance characteristics

- **Sync-first**: Synchronous neuron chains execute in a single tick without extra Promise overhead.
- **Minimal async overhead**: Promises are created only when a neuron returns an async result.
- **Stack-safe**: Deep chains are handled via an internal queue, avoiding stack overflow.
- **Bounded execution**: `maxNeuronHops` prevents runaway processing in cyclic graphs.

## Best practices

### Keep context data minimal

Store only essential data (IDs, counters, flags) in context. Avoid large objects or full entities.

```ts
// ✅ Good: minimal context
ctx.set({ userId: '123', attempt: 2 });

// ❌ Bad: bloated context
ctx.set({ user: fullUserObject, history: lotsOfData });
```

### Use synchronous responses when possible

If a neuron doesn't perform I/O, return the next signal synchronously:

```ts
// ✅ Sync response (fast)
.dendrite({
  collateral: input,
  response: (p, axon) => axon.output.createSignal({ value: p.value * 2 })
});

// ⚠️ Async response (slower, only when necessary)
.dendrite({
  collateral: input,
  response: async (p, axon) => {
    const result = await fetch('/api');
    return axon.output.createSignal(result);
  }
});
```

### Set reasonable `maxNeuronHops`

Default is 1000. For bounded workflows, set a lower limit:

```ts
await cns.stimulate(signal, {
  maxNeuronHops: 50 // stop after 50 hops
});
```

### Implement proper error handling

Use `onResponse` to log errors without blocking the flow:

```ts
await cns.stimulate(signal, {
  onResponse: (r) => {
    if (r.error) logger.error(r.error);
    if (r.queueLength === 0) logger.info('done');
  }
});
```

### Avoid `autoCleanupContexts` in production

The CNS `autoCleanupContexts` option adds significant overhead:

- **O(V²) initialization cost**: building SCC (Strongly Connected Components) structures
- **O(1 + A) runtime cost** per cleanup check (where A = number of SCC ancestors)
- **Memory overhead** for storing SCC graphs and ancestor relationships

**Use only when:**
- Memory leaks are a critical issue
- You have a small to medium-sized neuron graph (< 1000 neurons)
- Performance is less critical than memory management

**For production systems**, prefer manual context cleanup or custom cleanup strategies.

## Measuring performance

Use `onResponse` to track signal flow timing:

```ts
const start = Date.now();
await cns.stimulate(signal, {
  onResponse: (r) => {
    if (r.queueLength === 0) {
      console.log(`Completed in ${Date.now() - start}ms, ${r.hops} hops`);
    }
  }
});
```

Or integrate with your APM/tracing tool (e.g., OpenTelemetry):

```ts
await cns.stimulate(signal, {
  onResponse: (r) => {
    span.addEvent('neuron', { collateral: r.outputSignal?.collateral.id });
    if (r.error) span.recordException(r.error);
  }
});
```

