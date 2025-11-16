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

## Memory overhead per stimulation

Each active `CNSStimulation` instance has a fixed overhead for internal data structures:

### Base overhead (minimal context, ~2-3 keys)

- **CNSStimulation object**: ~1.2-1.5 KB
  - Context store (Map): ~200 bytes
  - Task queue (array + Set): ~500 bytes
  - Pending/failed tasks tracking: ~200 bytes
  - Promise and metadata: ~300 bytes

- **Active tasks in queue**: ~100-150 bytes per task (metadata only)
  - **⚠️ Important**: Each task stores the full input signal with payload
  - Task structure: `{ stimulationId, neuronId, dendriteCollateralName, input: { collateralName, payload } }`
  - Typical stimulation has 5-10 tasks simultaneously: ~500-1500 bytes (metadata) + **payload size**

- **Context data**: ~100-200 bytes (for minimal context with 2-3 simple values)

**Total per stimulation (minimal context, small payloads)**: ~1.8-3.2 KB

### Queue size and payload impact

**Critical**: The activation queue stores complete signal payloads in memory. Queue size directly multiplies payload memory usage.

**Per-task memory breakdown:**
- Task metadata (IDs, names): ~100-150 bytes
- **Signal payload**: variable, can be **any size** (from 0 bytes to MBs)

**Queue memory = (task metadata × queue length) + (payload size × queue length)**

**Examples:**

| Queue Length | Small Payloads (100 bytes) | Medium Payloads (1 KB) | Large Payloads (10 KB) | Very Large Payloads (100 KB) |
|-------------|----------------------------|------------------------|------------------------|------------------------------|
| **10 tasks** | ~2.5 KB | ~11.5 KB | ~101.5 KB | ~1 MB |
| **100 tasks** | ~25 KB | ~115 KB | ~1 MB | ~10 MB |
| **1,000 tasks** | ~250 KB | ~1.15 MB | ~10 MB | ~100 MB |
| **10,000 tasks** | ~2.5 MB | ~11.5 MB | ~100 MB | ~1 GB |

**At scale (1,000 concurrent stimulations):**

| Queue Length per Stimulation | Small Payloads | Medium Payloads | Large Payloads | Very Large Payloads |
|------------------------------|----------------|-----------------|----------------|---------------------|
| **10 tasks** | ~2.5 MB | ~11.5 MB | ~100 MB | ~1 GB |
| **100 tasks** | ~25 MB | ~115 MB | ~1 GB | ~10 GB |
| **1,000 tasks** | ~250 MB | ~1.15 GB | ~10 GB | ~100 GB |

**⚠️ Memory warning**: If your payloads are large (e.g., full documents, images, large JSON objects) and queues grow (e.g., due to slow processing or high concurrency), memory usage can explode quickly.

### Memory usage at scale

| Concurrent Stimulations | Minimal Context (2-3 keys) | Growing Context (10 keys, objects) |
|------------------------|----------------------------|-----------------------------------|
| **1,000** | ~1.8-3.2 MB | ~2.2-5 MB |
| **10,000** | ~18-32 MB | ~22-50 MB |
| **1,000,000** | ~1.8-3.2 GB | ~2.2-5 GB |

### Context size impact

Context growth significantly impacts memory usage:

- **Minimal context** (2-3 keys, primitives): +100-200 bytes per stimulation
- **Small context** (5-10 keys, primitives): +300-500 bytes per stimulation
- **Medium context** (10-20 keys, small objects): +500-1500 bytes per stimulation
- **Large context** (20+ keys, complex objects): +1.5-5 KB per stimulation

**Example**: If you store full user objects (5-10 KB each) in context instead of just IDs:
- 1,000 stimulations: +5-10 MB → **~7-15 MB total**
- 10,000 stimulations: +50-100 MB → **~70-130 MB total**
- 1,000,000 stimulations: +5-10 GB → **~7-15 GB total**

### Best practices for memory efficiency

1. **Keep payloads small** - this is the most critical factor:
   ```ts
   // ✅ Good: small payload (~50 bytes)
   return axon.output.createSignal({ userId: '123', action: 'created' });
   
   // ❌ Bad: large payload (~50 KB+)
   return axon.output.createSignal({ 
     user: fullUserObject, 
     history: largeArray, 
     metadata: hugeObject 
   });
   ```

2. **Use references instead of full data** in signals:
   ```ts
   // ✅ Good: pass only ID, fetch data when needed
   return axon.process.createSignal({ documentId: 'doc-123' });
   
   // ❌ Bad: pass entire document
   return axon.process.createSignal({ document: fullDocumentObject });
   ```

3. **Store only IDs and counters in context**, not full objects:
   ```ts
   // ✅ Good: ~50 bytes
   ctx.set({ userId: '123', attempt: 2 });
   
   // ❌ Bad: ~5-10 KB per stimulation
   ctx.set({ user: fullUserObject, history: lotsOfData });
   ```

4. **Monitor and limit queue size** to prevent memory bloat:
   ```ts
   onResponse: (r) => {
     if (r.queueLength > 1000) {
       // Queue is growing - consider:
       // - Reducing concurrency
       // - Adding backpressure
       // - Investigating slow processing
       console.warn(`Queue length: ${r.queueLength}`);
     }
   }
   ```

5. **Set reasonable concurrency limits** to prevent queue buildup:
   ```ts
   // Limit concurrent operations to match your processing capacity
   const stimulation = cns.stimulate(signal, {
     concurrency: 10 // Prevents queue from growing unbounded
   });
   ```

6. **Avoid storing large arrays or nested objects** in context. Use external storage (DB, cache) and reference by ID.

7. **Clean up completed stimulations** promptly if you're tracking them externally. The stimulation object is garbage-collected when no longer referenced.

8. **For large payloads, consider streaming or chunking**:
   ```ts
   // Instead of one large signal, split into smaller chunks
   const chunks = splitIntoChunks(largeData, 1000);
   return chunks.map(chunk => axon.process.createSignal({ chunk, index }));
   ```

9. **Use external queue systems to control memory load**:
   
   **⚠️ Critical**: For production systems processing high volumes, use external queue systems (BullMQ, RabbitMQ, AWS SQS) to control memory usage instead of creating thousands of stimulations in memory.
   
   ```ts
   // ✅ Good: Use external queue to control load
   import { Queue, Worker } from 'bullmq';
   
   const queue = new Queue('jobs', {
     limiter: { max: 100, duration: 1000 } // Rate limit
   });
   
   new Worker('jobs', async (job) => {
     // Process one job at a time, controlling memory
     const stimulation = cns.stimulate(
       myCollateral.createSignal(job.data),
       { concurrency: 10 }
     );
     await stimulation.waitUntilComplete();
   });
   
   // Enqueue work externally - doesn't consume memory until processed
   await queue.add('process', { userId: '123' });
   ```
   
   **Benefits:**
   - Work is persisted externally, not in memory
   - Rate limiting and backpressure handled by queue system
   - Survives process restarts
   - Better observability and retry mechanisms
   
   See [Integrations](/docs/integrations/bullmq) for examples.

10. **Clean up contexts as quickly as possible**:
    
    Contexts hold memory for the entire duration of a stimulation. Clean them up immediately after use:
    
    ```ts
    const processor = withCtx<{ processed: string[] }>()
      .neuron('processor', { next })
      .dendrite({
        collateral: input,
        response: async (payload, axon, ctx) => {
          const state = ctx.get() ?? { processed: [] };
          
          // Process batch
          const batch = await fetchBatch(payload.batchId);
          const results = await processBatch(batch);
          
          // Update context
          ctx.set({ processed: [...state.processed, ...results] });
          
          // ✅ Clean up immediately after processing
          // If this is the last batch, clear context
          if (payload.isLastBatch) {
            ctx.delete('processed'); // Explicit cleanup
          }
          
          return axon.next.createSignal({ batchId: payload.nextBatchId });
        }
      });
    ```
    
    **Best practice**: Delete context keys as soon as they're no longer needed, don't wait for stimulation completion.

11. **Use batch processing with recursive self-calls** (instead of fan-out):
    
    **❌ Bad**: Creating 10,000 signals with large payloads floods memory:
    ```ts
    // This creates 10,000 tasks in queue, each with full payload
    const items = await db.fetchAll(10000);
    return items.map(item => 
      axon.process.createSignal({ fullItem: item }) // 10KB each = 100MB in queue!
    );
    ```
    
    **✅ Good**: Process in batches with recursive self-calls:
    ```ts
    const BATCH_SIZE = 20;
    
    const batchProcessor = withCtx<{ offset: number }>()
      .neuron('batch-processor', { processBatch, nextBatch })
      .dendrite({
        collateral: processBatch,
        response: async (payload, axon, ctx) => {
          const offset = ctx.get()?.offset ?? 0;
          
          // Fetch only one batch from DB
          const batch = await db.fetchBatch(offset, BATCH_SIZE);
          
          // Process this batch (small memory footprint)
          await processItems(batch);
          
          // If more items exist, recursively call self with next offset
          if (batch.length === BATCH_SIZE) {
            ctx.set({ offset: offset + BATCH_SIZE });
            // Recursive self-call - only one task in queue at a time
            return axon.nextBatch.createSignal({ 
              offset: offset + BATCH_SIZE 
            });
          }
          
          // Done - cleanup context
          ctx.delete('offset');
          return undefined;
        }
      });
    
    // Start processing
    cns.stimulate(processBatch.createSignal({ offset: 0 }));
    ```
    
    **Benefits:**
    - Only one batch (20 items) in memory at a time
    - Queue length stays at 1-2 tasks instead of 10,000
    - Memory usage: ~200KB instead of ~100MB
    - Natural backpressure: next batch only starts after current completes
    - Works perfectly with per-neuron concurrency limits
    
    **Pattern**: Fetch → Process → Recurse (if more) → Cleanup

## Performance characteristics

- **Sync-first**: Synchronous neuron chains execute in a single tick without extra Promise overhead.
- **Minimal async overhead**: Async responses only schedule a microtask; not inherently slower. Promises are created only when a neuron returns an async result.
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

// ⚠️ Async response (schedules a microtask; use when doing I/O)
.dendrite({
  collateral: input,
  response: async (p, axon) => {
    const result = await fetch('/api');
    return axon.output.createSignal(result);
  }
});
```

### Set reasonable `maxNeuronHops`

Default: undefined (disabled). If you need a safety cap for cyclic graphs, set a lower limit:

```ts
const stimulation = cns.stimulate(signal, {
  maxNeuronHops: 10 // stop after 10 hops (optional, disabled by default)
});
await stimulation.waitUntilComplete();
```

### Implement proper error handling

Use `onResponse` to log errors without blocking the flow:

```ts
const stimulation = cns.stimulate(signal, {
  onResponse: (r) => {
    if (r.error) logger.error(r.error);
    if (r.queueLength === 0) logger.info('done');
  }
});
await stimulation.waitUntilComplete();
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
const stimulation = cns.stimulate(signal, {
  onResponse: (r) => {
    if (r.queueLength === 0) {
      console.log(`Completed in ${Date.now() - start}ms, ${r.hops} hops`);
    }
  }
});
await stimulation.waitUntilComplete();
```

Or integrate with your APM/tracing tool (e.g., OpenTelemetry):

```ts
const stimulation = cns.stimulate(signal, {
  onResponse: (r) => {
    span.addEvent('neuron', { collateral: r.outputSignal?.collateralName });
    if (r.error) span.recordException(r.error);
  }
});
await stimulation.waitUntilComplete();
```

