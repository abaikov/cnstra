---
id: bullmq
title: BullMQ Integration
sidebar_label: BullMQ
slug: /integrations/bullmq
---

Use BullMQ to schedule work and feed signals into CNStra. BullMQ provides process-wide concurrency control, rate limiting, and retry mechanisms that complement CNStra's instance-level concurrency.

For more information on why external queue systems are recommended for production, see [Performance: External Queue Systems](/docs/advanced/performance#use-external-queue-systems-to-control-memory-load).

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

// Define neurons with context
const ctxBuilder = withCtx<{ executed: string[] }>();
const input = collateral<{ id: number }>('input');
const step1Out = collateral<{ id: number }>('step1Out');
const step2Out = collateral<{ id: number }>('step2Out');
const output = collateral<{ result: string }>('output');

const step1 = ctxBuilder.neuron('step1', { step1Out }).dendrite({
  collateral: input,
  response: async (payload, axon, ctx) => {
    ctx.set({
      executed: [...(ctx.get()?.executed || []), `step1-${payload.id}`],
    });
    await processStep1(payload);
    return axon.step1Out.createSignal({ id: payload.id });
  },
});

const step2 = ctxBuilder.neuron('step2', { step2Out }).dendrite({
  collateral: step1Out,
  response: async (payload, axon, ctx) => {
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

## Real-time Progress Updates

You can update BullMQ job progress on every response using `onResponse`, but this requires storing the full context map in Redis for each update, which can be expensive:

```ts
const worker = new Worker('jobs', async (job: Job) => {
  const stimulation = cns.stimulate(signal, {
    onResponse: r => {
      // Update progress on every response
      // ⚠️ This stores full context map in Redis each time
      job.updateProgress({
        context: stimulation.getContext().getAll(),
        currentNeuron: r.neuronId,
        queueLength: r.queueLength,
        // Active tasks are coming soon
      });
    },
  });
  
  await stimulation.waitUntilComplete();
});
```

**Considerations:**
- Each `updateProgress()` call writes to Redis
- Context map can be large (especially with many neurons or complex data)
- For high-frequency responses, this can create significant Redis load
- **Recommendation**: Update progress only on errors or at checkpoints, not on every response

## Tips

- Use BullMQ rate limits and concurrency to protect resources
- Store intermediate or aggregated state in OIMDB or a real DB
- For retries, prefer BullMQ retry/backoff plus idempotent neurons
- Save progress only when needed (errors, checkpoints), not on every response
- Use `cns.activate()` to resume from specific failed tasks with preserved context
