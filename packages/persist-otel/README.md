# @cnstra/persist-otel

OpenTelemetry for CNStra. Both halves attach to a plain `new CNS(...)` and need
no persistence:

- **Traces** — `attachCNSOtelTracing(cns, { tracer })` builds the span tree from
  the engine's response listener and its subscriber map.
- **Metrics** — `attachCNSOtelMetrics(cns, { meter })` wires the engine's two global
  listeners to instruments.

`CNSOtelStimulationWriter` is the alternative: the same tree built out of
persisted records rather than live events — see [From records instead](#from-records-instead).

This package never creates a tracer or meter provider. You pass yours in.

```bash
npm install @cnstra/persist-otel @opentelemetry/api
```

```ts setup
import { CNS, collateral, neuron } from '@cnstra/core';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type { TCNSNeuron } from '@cnstra/types';

declare const cns: CNS<TCNSNeuron<any>>;
declare const registry: CNSPersistOptionsRegistry;
const orderPaid = collateral<{ orderId: string }>();
const charged = collateral<{ chargeId: string }>();
declare function chargeCard(order: { orderId: string }): Promise<void>;
```

## Traces

```typescript
import { trace } from '@opentelemetry/api';
import { attachCNSOtelTracing } from '@cnstra/persist-otel';

const tracing = attachCNSOtelTracing(cns, {
    tracer: trace.getTracer('my-service'),
    neuronName: n => registry.getNeuronName(n),
    collateralName: c => registry.getCollateralName(c),
});

// on shutdown
tracing.detach();
```

The tree is built **ahead of the work**:

| span | opens | parent |
| --- | --- | --- |
| root | on the entry injection, before any neuron runs | none |
| child | when its producer answers — the subscriber map already names every activation that signal will create | the activation that produced its input |

A span closes when its activation answers, stamped with the engine's own
measurement of the activation rather than the time the listener ran. A neuron
entered many times gets a span per entry: an activation is the pair `(neuron, the
signal object it consumes)`, and the engine hands the same signal object to every
subscriber of a collateral.

Names come from your registry — a neuron and a collateral carry no name of their
own, so without the resolvers every span is called `neuron`.

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

### What it holds while a run is alive

The root span, and a span for every activation still running. Not one per hop:
an activation's entry is dropped as soon as the engine lets go of the signal it
consumed, which is as soon as that activation can no longer answer.

The map keying `(neuron, signal) → span` is strong on the neuron and **weak on the
signal**, and a closed span is removed from the set `detach()` iterates. Measured on a
self-loop at the last hop, traced minus the same run untraced, with a forced
collection, that retains about 23 bytes per hop.

### One limit worth knowing

**A span created inside a neuron does not nest under its span by itself.** It
exists by then, but the engine does not make it the active context while the
dendrite response runs. It is handed to you in the activation's context store, so
making it active is one line:

```typescript
import { context, type Context } from '@opentelemetry/api';
import { CNS_OTEL_CONTEXT } from '@cnstra/persist-otel';
import type { TCNSOtelCompartment } from '@cnstra/persist-otel';

const charge = neuron({ charged }).dendrite({
    collateral: orderPaid,
    response: (p, axon, c) =>
        context.with(
            ((c.activationContext?.[CNS_OTEL_CONTEXT] as TCNSOtelCompartment | undefined)
                ?.context as Context | undefined) ?? context.active(),
            () => chargeCard(p)
        ),
});
```

### From records instead

```typescript
import { trace } from '@opentelemetry/api';
import { CNSOtelStimulationWriter } from '@cnstra/persist-otel';
import { CNSStimulationPersistor } from '@cnstra/persist';

const writer = new CNSOtelStimulationWriter({
    tracer: trace.getTracer('my-service'),
});
const persistor = new CNSStimulationPersistor({
    repository: writer,
    registry,
    stimulationId: 'order-42',
    stimulationAttemptId: 'order-42#1',
    attemptNumber: 1,
    entry: [{ collateralName: 'orderPaid', payload: { orderId: '42' } }],
    volume: 'full',
});
cns.stimulate(orderPaid.createSignal({ orderId: '42' }), { onResponse: persistor.onResponse });
```

`CNSOtelStimulationWriter` implements `ICNSStimulationWriter`, the write-only
interface the devtools transport and the Postgres store use, and emits spans from
the persisted record. Here the root is one **attempt**, so a retry or clone is its
own trace tied back by `cnstra.replay_of`, and children are tasks parented via
`inputIndex`.

Attributes: `cnstra.stimulation_id`, `cnstra.attempt_id`,
`cnstra.attempt_number`, `cnstra.hop_count`, `cnstra.entry_collateral`,
`cnstra.replay_of`, `cnstra.task_index`, `cnstra.dendrite_collateral`,
`cnstra.output_collateral`. Pass `attributePrefix` to rename the namespace.

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
    meter: metrics.getMeter('my-service'),
    neuronName: neuron => registry.getNeuronName(neuron),
});

// later
handle.detach();
```

| instrument | kind | source |
| --- | --- | --- |
| `cnstra.activations` | counter | one per response, tagged `cnstra.neuron` + `cnstra.outcome` |
| `cnstra.activation.duration` | histogram (ms) | how long each activation took, tagged like the counter |
| `cnstra.neuron.visits` | histogram | how many times a neuron had been entered when it responded — present only when `maxNeuronHops` is set |
| `cnstra.queue_depth` | observable gauge | outstanding activations, summed over live runs |
| `cnstra.pending_activations` | observable gauge | activations whose response has not been invoked |
| `cnstra.active_activations` | observable gauge | activations awaiting an unsettled promise |

Depth comes from the **drain**, not from responses: on a drain those counters are
measured after the scheduler loop exhausted, so they are a fact; on a response
`pendingActivations` is still a forecast.

The three gauges are summed per live stimulation, so concurrent runs add up
instead of overwriting each other. The last drained values are not a stale
approximation: a run cannot make progress without announcing a boundary, so
between drains its counters are frozen by definition.

A run leaves the sum when `waitUntilComplete()` settles — which covers completion,
failure and abort alike. Counting it out on a zero reading would not work: an
aborted run keeps its failed tasks outstanding and never reaches zero.

No `stimulation_id` attribute, deliberately: one time series per run would put
metric cardinality in the hands of traffic.

`neuronName` is optional. A neuron carries no name of its own — names live in the
persist registry — so without a resolver the counter goes untagged rather than
reporting a made-up name.

Latency is recorded only for real activations. The entry-signal injection and the
terminal signal an aborted run emits carry no duration, and folding a zero in for
them would drag every percentile down.

## License

MIT
