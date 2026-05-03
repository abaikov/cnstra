---
id: drain-guard
title: Drain Guard
sidebar_label: Drain Guard
slug: /recipes/drain-guard
description: Use CNSDrainGuard to trigger batch processing from cron, webhooks, or manual calls without starting overlapping CNS stimulations.
keywords: [CNSDrainGuard, drain, batch processing, cron, NestJS, database jobs, background jobs, stimulation guard, no overlapping jobs]
---

`CNSDrainGuard` is a small utility for a common backend pattern:

- a cron, webhook, or manual trigger may fire many times;
- only one processing run should be active at a time;
- the run should process work in small batches instead of loading everything at once.

Create one guard per workflow/source and call `drain()` freely. If a run is already active, `drain()` returns the same promise and does not start a second stimulation. When the current run reaches idle, the next `drain()` call can start a new stimulation.

<figure className="text--center">
  <img
    src="/img/brain_drain.png"
    alt="A stylized brain drain illustration for CNSDrainGuard"
    style={{ maxWidth: '680px', width: '100%', borderRadius: '16px' }}
  />
  <figcaption>
    One drain guard keeps repeated triggers flowing through a single active processing run.
  </figcaption>
</figure>

## Basic Shape

```ts
import { CNSDrainGuard } from '@cnstra/core';

const guard = new CNSDrainGuard({
  cns,
  signal: jobsAxon.processPendingUsers.createSignal(),
  options: {
    concurrency: 4,
  },
});

// Safe to call from cron, webhook, or admin action.
await guard.drain();
```

`CNSDrainGuard` is usually a singleton per workflow. Do not create it inside the cron handler, because then each tick would get its own guard and could overlap with other ticks.

## NestJS Cron Example

This example processes pending users from a database in batches of 100. The cron can tick every few seconds, but a new run will not start while the previous run is still draining.

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CNS,
  CNSDrainGuard,
  collateral,
  neuron,
} from '@cnstra/core';

type PendingUser = {
  id: string;
  email: string;
};

const jobsAxon = {
  processPendingUsers: collateral<void>(),
};

@Injectable()
export class PendingUsersWorkflow {
  private readonly logger = new Logger(PendingUsersWorkflow.name);

  private readonly processPendingUsers = neuron(jobsAxon).dendrite({
    collateral: jobsAxon.processPendingUsers,
    response: async (_payload, axon, ctx) => {
      const users = await this.claimPendingUsers(100);

      if (users.length === 0) {
        return undefined;
      }

      await Promise.all(
        users.map(user => this.processUser(user, ctx.abortSignal))
      );

      // Continue the same stimulation with the next batch.
      return axon.processPendingUsers.createSignal();
    },
  });

  private readonly cns = new CNS([this.processPendingUsers]);

  private readonly pendingUsersDrain = new CNSDrainGuard({
    cns: this.cns,
    signal: jobsAxon.processPendingUsers.createSignal(),
    options: {
      concurrency: 1,
      maxNeuronHops: 10_000,
      onResponse: response => {
        if (response.error) {
          this.logger.error(response.error);
        }
      },
    },
  });

  @Cron(CronExpression.EVERY_10_SECONDS)
  async drainPendingUsers(): Promise<void> {
    if (this.pendingUsersDrain.isDraining()) {
      return;
    }

    try {
      await this.pendingUsersDrain.drain();
    } catch (error) {
      this.logger.error(error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.pendingUsersDrain.isDraining()) {
      return;
    }

    this.pendingUsersDrain.abort();

    try {
      await this.pendingUsersDrain.drain();
    } catch {
      // The current run may reject because it was aborted.
    }
  }

  private async claimPendingUsers(limit: number): Promise<PendingUser[]> {
    // Use your ORM here. In production, claim rows atomically so another worker
    // cannot process the same records.
    return [];
  }

  private async processUser(
    user: PendingUser,
    abortSignal?: AbortSignal
  ): Promise<void> {
    if (abortSignal?.aborted) return;

    // Do the actual work: call APIs, update rows, publish events, etc.
    void user;
  }
}
```

## Why The Neuron Returns Its Own Signal

The first signal starts the workflow. Each successful batch returns the same signal again:

```ts
return axon.processPendingUsers.createSignal();
```

That keeps the stimulation alive while there may be more rows to process. Once the database returns an empty batch, the neuron returns `undefined`, no new tasks are enqueued, and `drain()` resolves.

## Abort Behavior

If you do not pass `options.abortSignal`, `CNSDrainGuard` creates an internal `AbortController`. Calling `guard.abort()` aborts the current stimulation and returns `true` when it actually sent an abort.

If you pass your own `abortSignal`, `guard.abort()` returns `false`; in that case, abort from the owner of that signal.

## When To Use It

Use `CNSDrainGuard` when:

- cron or external triggers can arrive while previous work is still active;
- work should be pulled in batches;
- processing can be represented as a CNS flow;
- overlapping runs would duplicate work or waste resources.

If each trigger should always create an independent run, use `cns.stimulate(...)` directly.
