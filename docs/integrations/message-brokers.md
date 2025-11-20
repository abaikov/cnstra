---
id: message-brokers
title: Message Brokers Integration
sidebar_label: Message Brokers
slug: /integrations/message-brokers
---

CNStra can be integrated with message brokers (MQ systems) to schedule work and feed signals into the system. Message brokers provide process-wide concurrency control, rate limiting, and retry mechanisms that complement CNStra's instance-level concurrency.

This guide demonstrates integration patterns using BullMQ as an example, but the same principles apply to other message brokers (RabbitMQ, AWS SQS, etc.).

For more information on why external queue systems are recommended for production, see [Performance: External Queue Systems](/docs/advanced/performance).

## Basic Integration

```ts
import { Queue, Worker } from 'bullmq';
import { CNS } from '@cnstra/core';

const queue = new Queue('jobs');
const cns = new CNS();

new Worker('jobs', async job => {
  // Convert job data into a CNStra signal
  const stimulation = cns.stimulate(myCollateral.createSignal(job.data));
  await stimulation.waitUntilComplete();
});

// Enqueue work somewhere else
await queue.add('importUser', { userId: '42' });
```

## Retry with Context Preservation

For long-running workflows that may be interrupted (e.g., process crashes, timeouts), you can save stimulation progress to BullMQ job progress and resume from failed tasks on retry using `cns.activate()`.

This pattern ensures that:
- Completed steps are not re-executed on retry
- Context is preserved across retries
- Only failed tasks are retried

```ts
import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { CNS } from '@cnstra/core';
import { withCtx, collateral } from '@cnstra/core';

// Context stores per-neuron per-stimulation metadata (execution tracking), not business data
const ctxBuilder = withCtx<{ executed: string[] }>();
const input = collateral<{ id: number }>('input');
const step1Out = collateral<{ id: number }>('step1Out');
const step2Out = collateral<{ id: number }>('step2Out');
const output = collateral<{ result: string }>('output');

const step1 = ctxBuilder.neuron('step1', { step1Out }).dendrite({
  collateral: input,
  response: async (payload, axon, ctx) => {
    // Context stores stimulation metadata (execution tracking)
    ctx.set({
      executed: [...(ctx.get()?.executed || []), `step1-${payload.id}`],
    });
    // Business data (id) flows through payloads
    await processStep1(payload);
    return axon.step1Out.createSignal({ id: payload.id });
  },
});

const step2 = ctxBuilder.neuron('step2', { step2Out }).dendrite({
  collateral: step1Out,
  response: async (payload, axon, ctx) => {
    // Context stores stimulation metadata
    ctx.set({
      executed: [...(ctx.get()?.executed || []), `step2-${payload.id}`],
    });
    await processStep2(payload);
    return axon.step2Out.createSignal({ id: payload.id });
  },
});

const step3 = ctxBuilder.neuron('step3', { output }).dendrite({
  collateral: step2Out,
  response: async (payload, axon, ctx) => {
    // Context stores stimulation metadata
    ctx.set({
      executed: [...(ctx.get()?.executed || []), `step3-${payload.id}`],
    });
    return axon.output.createSignal({ result: `Final: ${payload.id}` });
  },
});

const cns = new CNS([step1, step2, step3]);

// BullMQ setup
const queue = new Queue('workflows', { connection: redis });
const queueEvents = new QueueEvents('workflows', { connection: redis });

type SavedProgress = {
  context: Record<string, unknown>;
  failedTasks: Array<{
    task: {
      stimulationId: string;
      neuronId: string;
      dendriteCollateralName: string;
    };
    error: {
      message: string;
      name: string;
      stack?: string;
    };
    aborted: boolean;
  }>;
};

const worker = new Worker(
  'workflows',
  async (job: Job<{ signal: any }, { results: string[] }>) => {
    const { signal } = job.data;
    const results: string[] = [];

    const savedProgress = job.progress as SavedProgress | number | undefined;

    // Retry attempt: resume from saved progress
    if (
      savedProgress &&
      typeof savedProgress === 'object' &&
      job.attemptsMade > 0
    ) {
      const contextValues = savedProgress.context;
      const failedTasksToRetry = savedProgress.failedTasks.map(ft => ft.task);

      // Resume from failed tasks with preserved context
      const stimulation = cns.activate(failedTasksToRetry, {
        contextValues: contextValues as Record<string, unknown>,
        onResponse: r => {
          if (r.outputSignal?.collateralName === 'output') {
            results.push(
              (r.outputSignal.payload as { result: string }).result
            );
          }
        },
      });

      await stimulation.waitUntilComplete();
      return { results };
    }

    // First attempt: start fresh stimulation
    const abortController = new AbortController();
    const stimulation = cns.stimulate(signal, {
      abortSignal: abortController.signal,
    });

    // Simulate interruption (e.g., timeout, crash)
    await new Promise(resolve => setTimeout(resolve, 10));
    abortController.abort();

    try {
      await stimulation.waitUntilComplete();
      return { results };
    } catch (error: any) {
      // Save progress for retry
      const progress: SavedProgress = {
        context: stimulation.getContext().getAll(),
        failedTasks: stimulation.getFailedTasks().map(ft => ({
          task: ft.task,
          error: {
            message: ft.error.message,
            name: ft.error.name,
            stack: ft.error.stack,
          },
          aborted: ft.aborted,
        })),
      };

      // Save to BullMQ job progress (stored in Redis)
      await job.updateProgress(progress);

      // Throw to trigger BullMQ retry
      throw error;
    }
  },
  { connection: redis, concurrency: 1 }
);

// Enqueue job with retry configuration
const job = await queue.add(
  'workflow-job',
  { signal: input.createSignal({ id: 100 }) },
  {
    attempts: 2,
    removeOnComplete: true,
    removeOnFail: true,
  }
);

// Wait for completion
const result = await job.waitUntilFinished(queueEvents);
```

**Key points:**
- `stimulation.getContext().getAll()` captures all context values
- `stimulation.getFailedTasks()` returns tasks that failed or were aborted
- `cns.activate()` resumes execution from specific tasks with restored context
- Progress is saved to Redis via `job.updateProgress()`, so it persists across retries

## Handling Non-Serializable Data in Signals

When working with message brokers, signals must be serializable (JSON), but sometimes you need to work with non-serializable data (e.g., blobs, file handles, database connections).

Solution: use a controller/transaction neuron that creates an inner stimulation and stores it in context. The inner stimulation runs in the same process and can work with non-serializable data. On error, either the entire transaction completes or it doesn't, but non-serializable data won't be included in results sent back to the queue.

```ts
import { Queue, Worker, Job } from 'bullmq';
import { CNS, neuron, withCtx, collateral } from '@cnstra/core';

// Serializable data for the queue
const processRequest = collateral<{ userId: string; blobId: string }>('processRequest');
const processResult = collateral<{ userId: string; success: boolean }>('processResult');

// Non-serializable data (only within the process)
const blobData = collateral<{ userId: string; blob: Blob }>('blobData');
const blobProcessed = collateral<{ userId: string; success: boolean }>('blobProcessed');

// Transaction neuron: creates inner stimulation with blob
const ctxBuilder = withCtx<{ innerStimulation?: Promise<void> }>();

const transactionNeuron = ctxBuilder.neuron('transaction', { processResult }).dendrite({
  collateral: processRequest,
  response: async (payload, axon, ctx) => {
    // Get blob from storage (non-serializable)
    const blob = await blobStorage.get(payload.blobId);
    
    // Create inner stimulation with blob
    // Use ctx.cns to access CNS from context
    const innerStimulation = ctx.cns.stimulate(
      blobData.createSignal({ userId: payload.userId, blob })
    );
    
    // Store stimulation promise in context
    ctx.set({ innerStimulation: innerStimulation.waitUntilComplete() });
    
    try {
      // Wait for inner stimulation to complete
      await innerStimulation.waitUntilComplete();
      
      // If inner stimulation succeeds, return serializable result
      return axon.processResult.createSignal({ 
        userId: payload.userId, 
        success: true 
      });
    } catch (error) {
      // On error, return failure result
      // Blob won't be in results since it's non-serializable
      return axon.processResult.createSignal({ 
        userId: payload.userId, 
        success: false 
      });
    }
  },
});

// Neuron for processing blob (runs only within the process)
const blobProcessor = neuron('blobProcessor', { blobProcessed }).dendrite({
  collateral: blobData,
  response: async (payload, axon) => {
    // Process blob (non-serializable object)
    await processBlob(payload.blob);
    
    return axon.blobProcessed.createSignal({ 
      userId: payload.userId, 
      success: true 
    });
  },
});

const cns = new CNS([transactionNeuron, blobProcessor]);

// BullMQ worker
const worker = new Worker('jobs', async (job: Job<{ signal: any }>) => {
  const { signal } = job.data;
  
  // Stimulation runs in this process
  // If an error occurs, blob won't be in results
  const stimulation = cns.stimulate(signal);
  await stimulation.waitUntilComplete();
  
  // Return only serializable results
  return { success: true };
});

// Enqueue job (only serializable data)
await queue.add('process', {
  signal: processRequest.createSignal({ 
    userId: '42', 
    blobId: 'blob-123' // only ID, not the blob itself
  })
});
```

**Key points:**
- Controller/transaction neuron creates inner stimulation with non-serializable data
- Inner stimulation runs in the same process as the worker
- On error, either the entire transaction completes or it doesn't, but non-serializable data won't be in results
- Only serializable data (IDs, metadata) is sent to the queue
- Blobs and other non-serializable objects remain in process memory and are not serialized

## Tips

- Use BullMQ rate limits and concurrency to protect resources
- Store intermediate or aggregated state in OIMDB or a real DB
- For retries, prefer BullMQ retry/backoff plus idempotent neurons
- Save progress only when needed (errors, checkpoints), not on every response
- For non-serializable data (blobs, file handles), use transaction neurons with inner stimulations
- Use `cns.activate()` to resume from specific failed tasks with preserved context
