/**
 * BullMQ + OpenTelemetry: one job = one stimulation, traced and measured.
 *
 *   cd packages/examples
 *   npm run redis:up          # starts Redis via docker compose
 *   npm run demo:bull:otel
 *   npm run redis:down        # tears it down
 *
 * Spans and metrics go to the CONSOLE — no collector, no OTLP endpoint. Swap the
 * two exporters below for OTLP ones and the rest of the wiring is unchanged.
 *
 * The flow fails on its first pass, BullMQ retries the SAME job id, and the
 * worker resumes the outstanding frontier. So you get two attempts of one
 * stimulation, and you can watch both in the span output.
 *
 * ── Where `stimulationId` comes from ───────────────────────────────────────────
 * The stimulation id is the resume key, the id the DevTools retry UI shows, and
 * the `cnstra.stimulation_id` attribute on every span. Three ways to set it:
 *
 *   1. YOUR OWN, via the queue (what this demo does):
 *        enqueueCNSStimulation(queue, job, { jobId: 'order-42' })
 *      `stimulationId` becomes exactly `order-42`. Use a business key — an order
 *      id, an entity id — and the run is greppable across logs, traces and the
 *      panel. BullMQ also dedupes in-flight jobs sharing an id, so the same
 *      order cannot be processed twice concurrently.
 *
 *   2. LET THE BROKER MINT IT: omit `jobId` and BullMQ assigns an incrementing
 *      number; the worker takes `String(job.id ?? job.name)` (bullmq/src/worker.ts).
 *      Fine, but the id means nothing outside the queue.
 *
 *   3. NO BROKER AT ALL: construct the persistor yourself and pass any string —
 *      see `resume-inprocess.ts`. The attempt id is always derived from it with
 *      `buildCNSAttemptId(stimulationId, attemptNumber)` → `<id>#<n>`.
 */
import { Queue, Worker } from 'bullmq';
import { metrics, trace } from '@opentelemetry/api';
import {
    ConsoleSpanExporter,
    NodeTracerProvider,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import {
    ConsoleMetricExporter,
    MeterProvider,
    PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import {
    CNSFanOutStimulationWriter,
    CNSInMemoryStimulationRepository,
    CNSPersistOptionsRegistry,
} from '@cnstra/persist';
import { buildCNSAttemptId } from '@cnstra/persist-dto';
import {
    CNSOtelStimulationWriter,
    attachCNSOtelMetrics,
} from '@cnstra/persist-otel';
import {
    createCNSWorker,
    enqueueCNSStimulation,
    cnsStimulationJob,
} from '@cnstra/bullmq';

// ── OpenTelemetry, console-only ───────────────────────────────────────────────
const tracerProvider = new NodeTracerProvider();
tracerProvider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
tracerProvider.register();

const meterProvider = new MeterProvider({
    readers: [
        new PeriodicExportingMetricReader({
            exporter: new ConsoleMetricExporter(),
            exportIntervalMillis: 60_000, // we flush by hand at the end instead
        }),
    ],
});
metrics.setGlobalMeterProvider(meterProvider);

// ── The flow ──────────────────────────────────────────────────────────────────
const connection = {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
};
const QUEUE = 'cns-otel';

// Your own stimulation id. Everything downstream — resume key, panel row, span
// attribute — is this string.
const STIMULATION_ID = 'order-42';

const input = cnsCollateral<{ orderId: string }>();
const validated = cnsCollateral<{ orderId: string }>();
const charged = cnsCollateral<{ orderId: string; ok: true }>();

// Fails once, then succeeds on the resumed attempt.
let chargeCalls = 0;

const validateOrder = cnsNeuron({ validated }).dendrite({
    collateral: input,
    response: (p, axon) => {
        console.log(`    ▸ validateOrder(${p!.orderId})`);
        return axon.validated.createSignal({ orderId: p!.orderId });
    },
});

const chargeOrder = cnsNeuron({ charged }).dendrite({
    collateral: validated,
    response: (p, axon) => {
        chargeCalls += 1;
        if (chargeCalls === 1) {
            console.log('    ▸ chargeOrder → THROWS (payment gateway down)');
            throw new Error('payment gateway down');
        }
        console.log('    ▸ chargeOrder → ok (resumed attempt)');
        return axon.charged.createSignal({ orderId: p!.orderId, ok: true });
    },
});

const cns = new CNS([validateOrder, chargeOrder]);

const registry = new CNSPersistOptionsRegistry();
registry.register('validateOrder', validateOrder);
registry.register('chargeOrder', chargeOrder);
registry.registerCollateral('input', input);

async function main(): Promise<void> {
    // History goes to two sinks at once from ONE persistor: an in-memory store
    // you can read back, and the tracer. Put the real store first — `getStimulation`
    // asks each in turn and a tracer has nothing to read back.
    const history = new CNSInMemoryStimulationRepository();
    const observe = new CNSFanOutStimulationWriter([
        history,
        new CNSOtelStimulationWriter({
            tracer: trace.getTracer('orders-worker'),
        }),
    ]);

    // Metrics are independent of all that: they read the live engine, so they
    // work with no persistence configured at all.
    const meters = attachCNSOtelMetrics(cns, {
        meter: metrics.getMeter('orders-worker'),
        neuronName: neuron => registry.getNeuronName(neuron),
    });

    const queue = new Queue(QUEUE, { connection });
    // A fixed job id is the point of this demo — but it also means BullMQ would
    // treat a second run as the same job and skip it (that dedup is a feature:
    // the same order cannot be processed twice concurrently). Clear the queue so
    // the demo is re-runnable.
    await queue.obliterate({ force: true });

    const { shutdown } = createCNSWorker({
        Worker,
        workerOptions: { connection },
        cns,
        registry,
        queue: QUEUE,
        observe,
        // Resume checkpoint lives in BullMQ's own per-job progress, in Redis.
        resume: {},
    });

    const job = cnsStimulationJob(registry, input, { orderId: STIMULATION_ID });
    await enqueueCNSStimulation(queue, job, {
        // ← THIS is what pins the stimulation id. Drop it and BullMQ mints a number.
        jobId: STIMULATION_ID,
        attempts: 3,
        backoff: { type: 'fixed', delay: 500 },
    });

    console.log(`\n  enqueued with jobId="${STIMULATION_ID}"`);
    console.log(`  → stimulationId  = ${STIMULATION_ID}`);
    console.log(`  → attempt #1 id  = ${buildCNSAttemptId(STIMULATION_ID, 1)}`);
    console.log(`  → attempt #2 id  = ${buildCNSAttemptId(STIMULATION_ID, 2)}`);
    console.log('\n  watch: attempt #1 throws → BullMQ retries → resume completes it.\n');

    await new Promise(r => setTimeout(r, 8000));
    await shutdown();
    await queue.close();
    meters.detach();

    const stimulation = await history.getStimulation(STIMULATION_ID);
    console.log(`\n  stored stimulation: ${stimulation?.stimulationId} — ${stimulation?.status}`);
    console.log(`  chargeOrder invocations: ${chargeCalls} (1 fail + 1 resumed success)`);
    console.log('\n  ── metrics ──');

    await meterProvider.forceFlush();
    await tracerProvider.forceFlush();
    await meterProvider.shutdown();
    await tracerProvider.shutdown();
    process.exit(0);
}

void main().catch(e => {
    console.error(e);
    process.exit(1);
});
