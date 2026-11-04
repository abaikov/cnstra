---
id: opentelemetry
title: OpenTelemetry
sidebar_label: OpenTelemetry
slug: /integrations/opentelemetry
description: Export CNStra runs as OpenTelemetry traces and metrics with @cnstra/persist-otel — attempts and hops as spans, activation counts and latency as instruments, and no provider of its own.
keywords: [opentelemetry, otel, tracing, metrics, spans, observability, latency, histogram]
---

`@cnstra/persist-otel` turns runs into OpenTelemetry data. Both halves attach to a
plain `new CNS(...)` and need no persistence at all:

- **Traces** — `attachCNSOtelTracing(cns, { tracer })` reads the engine's response
  listener and its subscriber map.
- **Metrics** — `attachCNSOtelMetrics(cns, { meter })` reads the engine's two global
  listeners.

There is also `CNSOtelStimulationWriter`, which builds the same span tree out of
persisted records instead of live events — for tracing runs whose records you
already have. See [From records instead](#from-records-instead).

The package never creates a tracer or meter provider. You pass yours in, so
sampling, resource attributes and exporters stay yours.

## Install

```bash
npm install @cnstra/persist-otel @opentelemetry/api
```

## Traces

```ts setup
import { collateral, neuron } from '@cnstra/core';
import type { CNS } from '@cnstra/core';
import type { CNSPersistOptionsRegistry, ICNSStimulationWriter } from '@cnstra/persist';
import type { TCNSSignalJSON } from '@cnstra/persist-dto';
import type { ICNSBullQueueLike, TCNSStimulationJobData } from '@cnstra/bullmq';

declare const cns: CNS<any>;
declare const registry: CNSPersistOptionsRegistry;
declare const repository: ICNSStimulationWriter;
declare const Worker: typeof import('bullmq').Worker;
declare const queue: ICNSBullQueueLike;
declare const job: TCNSStimulationJobData;
declare const entry: TCNSSignalJSON[];
declare const stimulationId: string;
declare const batchId: string;
declare function chargeCard(order: { orderId: string }): Promise<void>;

const connection = { host: '127.0.0.1', port: 6379 };
const orderPaid = collateral<{ orderId: string }>();
const charged = collateral<{ orderId: string }>();
const input = orderPaid;
const order = { id: '42' };
const payload = { orderId: order.id };
```

```typescript
import { trace } from '@opentelemetry/api';
import { attachCNSOtelTracing } from '@cnstra/persist-otel';

const tracing = attachCNSOtelTracing(cns, {
    tracer: trace.getTracer('orders-worker'),
    neuronName: n => registry.getNeuronName(n),
    collateralName: c => registry.getCollateralName(c),
});

// on shutdown
tracing.detach();
```

The tree is built **ahead of the work**, not reconstructed from it afterwards, and
that is what makes it come out right:

| span | opens | parent |
| --- | --- | --- |
| root | on the entry injection, before any neuron runs | none |
| child | the moment its producer answers — the subscriber map already names every activation that signal is about to create | the activation that produced its input |

An activation closes its span when it answers, stamped with the engine's own
measurement of how long it took rather than with the time the listener happened to
run. A neuron entered many times in one run gets a span per entry: an activation is
identified by the pair `(neuron, the signal object it consumes)`, and the engine
hands the same signal object to every subscriber of a collateral.

Names come from your registry — a neuron and a collateral carry no name of their
own. Without the two resolvers every span is called `neuron`.

### Retry and clone

The two panel actions differ in what they are, and the traces follow that rather
than a policy of their own:

- **Retry** is the same stimulation — same id, one more attempt — so it is the
  **same trace**. The run leaves its trace identity in its own context store, that
  store travels with the serialized frontier, and the resumed attempt rejoins the
  trace it belongs to, in whichever process picks the job up.
- **Clone** is a different stimulation — new id, attempt 1 — so it gets its **own
  trace**, tied back through the record's `replayOf` rather than through the trace.

A resumed run has no entry signal to open on: `activate` puts the frontier straight
into the queue. The first activation to answer opens the run's root instead, and
gets a span of its own, stamped with the engine's measurement and marked
`cnstra.resumed`.

Rejoining needs somewhere to have kept the identity, which means the run was
started with a context store. Anything that is recorded has one — a persistor is
wired through `onResponse`, so the options exist — but a bare `cns.stimulate(sig)`
with no options at all cannot be resumed anyway.

### One limit worth knowing

A span created **inside** a neuron — your own HTTP or SQL call — does not nest
under that neuron's span *by itself*: the span exists by then, but the engine does
not make it the active context while the dendrite response runs. It is handed to
you instead, in the activation's context store, so making it active is one line:

```typescript
import { context } from '@opentelemetry/api';
import type { Context } from '@opentelemetry/api';
import { CNS_OTEL_CONTEXT } from '@cnstra/persist-otel';
import type { TCNSOtelCompartment } from '@cnstra/persist-otel';

const charge = neuron({ charged }).dendrite({
    collateral: orderPaid,
    response: (p, axon, c) =>
        context.with(
            ((c.activationContext?.[CNS_OTEL_CONTEXT] as TCNSOtelCompartment)
                ?.context as Context | undefined) ?? context.active(),
            () => chargeCard(p)
        ),
});
```

### From records instead

`CNSOtelStimulationWriter` implements `ICNSStimulationWriter`, the write-only
interface the DevTools transport and the Postgres store use, and emits spans from
the persisted record:

```typescript
import { trace } from '@opentelemetry/api';
import { CNSOtelStimulationWriter } from '@cnstra/persist-otel';
import { CNSStimulationPersistor } from '@cnstra/persist';
import { buildCNSAttemptId } from '@cnstra/persist-dto';

const writer = new CNSOtelStimulationWriter({
    tracer: trace.getTracer('orders-worker'),
});
new CNSStimulationPersistor({
    repository: writer,
    registry,
    volume: 'full',
    stimulationId,
    stimulationAttemptId: buildCNSAttemptId(stimulationId, 1),
    attemptNumber: 1,
    entry,
});
```

Here the root is one **attempt**, so a retry or clone is its own trace, tied back
by `cnstra.replay_of`; children are tasks, parented via `inputIndex`. Every span
carries `cnstra.stimulation_id`, so all attempts of a run are one query away.

Attributes:

```text
cnstra.stimulation_id
cnstra.attempt_id
cnstra.attempt_number
cnstra.hop_count
cnstra.entry_collateral
cnstra.replay_of
cnstra.task_index
cnstra.dendrite_collateral
cnstra.output_collateral
```

Pass `attributePrefix` to rename the namespace.

Two things to know before choosing it: only `volume: 'full'` produces task spans
(under `'progress'` the model keeps just the resume frontier), and the root stays
open until the terminal record arrives, so a long run holds one span in memory for
its whole length. Prefer `attachCNSOtelTracing` unless you specifically need spans
from records rather than from the live engine.

## Metrics

```typescript
import { metrics } from '@opentelemetry/api';
import { attachCNSOtelMetrics } from '@cnstra/persist-otel';

const handle = attachCNSOtelMetrics(cns, {
    meter: metrics.getMeter('orders-worker'),
    neuronName: neuron => registry.getNeuronName(neuron),
});

// on shutdown
handle.detach();
```

| instrument | kind | what it measures |
| --- | --- | --- |
| `cnstra.activations` | counter | one per response, tagged `cnstra.neuron` + `cnstra.outcome` |
| `cnstra.activation.duration` | histogram (ms) | how long each activation took |
| `cnstra.neuron.visits` | histogram | how many times a neuron had been entered when it responded — present only when `maxNeuronHops` is set |
| `cnstra.queue_depth` | observable gauge | outstanding activations, summed over live runs |
| `cnstra.pending_activations` | observable gauge | activations whose response has not been invoked |
| `cnstra.active_activations` | observable gauge | activations awaiting an unsettled promise |

Depth comes from the **drain**, not from responses: on a drain those counters are
measured after the scheduler loop exhausted, so they are a fact; on a response
`pendingActivations` is still a forecast. The gauges are summed per live run, so
concurrent runs add up instead of overwriting each other, and a run leaves the sum
when `waitUntilComplete()` settles — completion, failure and abort alike.

There is no `stimulation_id` attribute, deliberately: one time series per run puts
metric cardinality in the hands of traffic.

`neuronName` is optional. A neuron carries no name of its own — names live in the
persist registry — so without a resolver the counter goes untagged rather than
reporting a made-up name.

## Choosing the stimulation id

The stimulation id is the resume key, the id the Retry UI shows, and the
`cnstra.stimulation_id` attribute on every span. Picking it well is what lets you
jump from a log line to a trace to the panel. Three ways:

**Your own, through the queue.** The broker's job id becomes the stimulation id:

```typescript
import { enqueueCNSStimulation } from '@cnstra/bullmq';

await enqueueCNSStimulation(queue, job, { jobId: `order-${order.id}` });
// stimulationId = "order-42"
// attempt ids   = "order-42#1", "order-42#2", …
```

Use a business key. The run becomes greppable across logs, traces and the panel,
and BullMQ additionally refuses to run two jobs with the same id at once — the
same order cannot be processed twice concurrently.

**Let the broker mint it.** Omit `jobId` and BullMQ assigns a number; the worker
takes `String(job.id ?? job.name)`. Fine, but the id means nothing outside the
queue.

**No broker at all.** Construct the persistor yourself and pass any string:

```typescript
import { CNSStimulationPersistor } from '@cnstra/persist';
import { buildCNSAttemptId } from '@cnstra/persist-dto';

new CNSStimulationPersistor({
    stimulationId: `import-${batchId}`,
    stimulationAttemptId: buildCNSAttemptId(`import-${batchId}`, 1),
    attemptNumber: 1,
    entry,
    repository,
    registry,
});
```

The attempt id is always derived from the stimulation id with
`buildCNSAttemptId(stimulationId, attemptNumber)` → `<id>#<n>`, exported from
`@cnstra/persist-dto`. Deriving it by hand elsewhere is how the format drifts.

## End to end on BullMQ

```typescript
import { metrics, trace } from '@opentelemetry/api';
import {
    CNSFanOutStimulationWriter,
    CNSInMemoryStimulationRepository,
} from '@cnstra/persist';
import { CNSOtelStimulationWriter, attachCNSOtelMetrics } from '@cnstra/persist-otel';
import { createCNSWorker, enqueueCNSStimulation, stimulationJob } from '@cnstra/bullmq';

// One persistor, several sinks: a store you can read back, and the tracer.
// Put the real store first — `getStimulation` asks each in turn.
const observe = new CNSFanOutStimulationWriter([
    new CNSInMemoryStimulationRepository(),
    new CNSOtelStimulationWriter({ tracer: trace.getTracer('orders-worker') }),
]);

const handle = attachCNSOtelMetrics(cns, {
    meter: metrics.getMeter('orders-worker'),
    neuronName: neuron => registry.getNeuronName(neuron),
});

const worker = createCNSWorker({
    Worker, cns, registry, queue: 'orders', workerOptions: { connection },
    observe,
    resume: {},
});

await enqueueCNSStimulation(queue, stimulationJob(registry, input, payload), {
    jobId: `order-${order.id}`,
    attempts: 3,
    backoff: { type: 'fixed', delay: 500 },
});
```

A runnable version of this — with console exporters, so it needs no collector —
is `packages/examples/src/bull-otel.ts`:

```bash
cd packages/examples
npm run redis:up
npm run demo:bull:otel
```

It fails once on purpose, BullMQ retries the same job id, and the worker resumes
the frontier — so the span output shows attempt #1 with two hops and attempt #2
with **one**, which is the difference between resuming and restarting.

## See also

- [BullMQ](./bullmq.md) — the queue side of the same setup
- [pg-boss](./pg-boss.md) — the Postgres-backed alternative
