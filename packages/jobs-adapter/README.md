# @cnstra/jobs-adapter

> **⚠️ Experimental**: API may change.

Runs [`@cnstra/jobs`](../jobs) job types as CNStra stimulations. A job type is an entry collateral, a job
is one stimulation, and a retried job resumes from where its failed attempt stopped. Works with any
`@cnstra/jobs` repository: in memory, or Postgres through [`@cnstra/jobs-postgres`](../jobs-postgres).

## Use

The examples below assume these collaterals, neurons and values:

```ts setup
import { cnsCollateral, cnsNeuron } from '@cnstra/core';
import { startCNSDevTools } from '@cnstra/devtools-server';
import type { TCNSJobsCompletionState, TCNSJobsFailureState } from '@cnstra/jobs-adapter';
import { CNSPrismaJobConnection } from '@cnstra/jobs-postgres';
import type { TCNSHandlerContext } from '@cnstra/types';

type TOrder = { orderId: number };
const orderPlaced = cnsCollateral<TOrder>();
const orderDone = cnsCollateral<TCNSJobsCompletionState<TOrder>>();
const orderFailed = cnsCollateral<TCNSJobsFailureState<TOrder>>();
const checkoutSubmitted = cnsCollateral<TOrder>();
const orderAccepted = cnsCollateral<TOrder>();
const charge = cnsNeuron({}).dendrite({ collateral: orderPlaced, response: () => undefined });
const notify = cnsNeuron({}).dendrite({ collateral: orderDone, response: () => undefined });

declare const jobId: string;
declare const ctx: TCNSHandlerContext;
declare const order: { id: number };
declare const prisma: {
    $transaction<T>(
        work: (tx: {
            $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
            order: { create(args: { data: { id: number } }): Promise<unknown> };
        }) => Promise<T>
    ): Promise<T>;
};
```

```ts setup
import { CNS } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
import { CNSJobs } from '@cnstra/jobs-adapter';
import { CNSPgJobDatabase, CNSPostgresJobRepository, CNSPostgresJobSchema } from '@cnstra/jobs-postgres';
import { Pool } from 'pg';

const database = new CNSPgJobDatabase(new Pool({ connectionString: process.env.DATABASE_URL }));
await CNSPostgresJobSchema.migrate(database);
const repository = new CNSPostgresJobRepository({ database });

const registry = new CNSPersistOptionsRegistry();
registry.register('charge', charge);
registry.register('notify', notify);
registry.registerCollateral('orderPlaced', orderPlaced);

const cns = new CNS([charge, notify]);
const jobs = new CNSJobs({ cns, registry, repository })
    .type(orderPlaced, {
        jobKey: payload => `order:${payload.orderId}`,
        keyMode: 'serial',
        retry: { maxFailed: 5, backoff: { type: 'exponential', delayMs: 1000 }, nonRetryable: ['ValidationError'] },
        onCompleted: orderDone,
        onFailed: orderFailed,
    });

const worker = jobs.worker();
await worker.start();

await jobs.enqueue(orderPlaced, { orderId: 1 });
```

- **The job type is the collateral.** Its name in the registry is the `jobType`, and `enqueue` takes the
  collateral's payload type, so a wrong payload does not compile. The type options are the
  `@cnstra/jobs` type definition (`jobKey`, `keyMode`, `jobGroup`, `retry`, `timeoutMs`, `schedules`, …),
  plus `maxNeuronHops`, `onCompleted` and `onFailed`.
- **One job, one stimulation.** The stimulation id is the job id; each attempt of the job is an attempt of
  the stimulation. Every neuron and collateral a run can stop at must be in the registry.
- **Resume.** The outstanding frontier is saved through the repository's `stateRepository` as the run
  goes, fenced by attempt, and read back from it.
  A retried, stale or restarted job continues from it through `cns.activate`; cancelling the job or
  losing its lease aborts the stimulation.
- **Errors carry their place in the graph.** The attempt's `errorName` is the class of the error the
  neuron threw, so `retry.nonRetryable` works by class, and the attempt's meta gets `failedNeuron` and
  `failedCollateral`.
- **Continuations are new stimulations.** When a job completes, `onCompleted` is stimulated with
  `{ jobId, payload }`; when it ends `failed`, `onFailed` with `{ jobId, payload, errorName,
  failedNeuron, failedCollateral }` (an expired, cancelled or superseded job has no continuation). Their
  `stimulationContext` carries `parentStimulationId`. They are read from the job's history, so a type
  with a continuation needs a repository that keeps history. They are started by the worker that saved
  the outcome, at most once: if that process dies right after the save, the continuation does not run.
  A stimulation has no single result value, so the continuation gets the job's payload, not a result.
- **Errors** of the queue, of checkpoint writes and of continuations go to `onError` (default
  `console.error`).
- **Payload schema.** `payloadSchema` and `description` of a type are published to the type's `meta`
  in the repository when a worker starts (`job_type.meta` on Postgres), for an admin form. Pass a JSON
  Schema; the adapter does not convert zod or other validators.

## Types without `type()`

```ts
const defaultTypeJobs = new CNSJobs({ cns, registry, repository, defaultTypeOptions: { retry: { maxFailed: 3 } } });
```

With `defaultTypeOptions`, every collateral that a neuron in the registry listens to is a job type with
these options, unless `type()` declares it. Options that belong to one type — `schedules`,
`payloadSchema`, `description`, `onCompleted`, `onFailed` — are not accepted there. The registry is read when `CNSJobs` is created and on each
`type()` call, so register neurons before that.

## Wait for a job

```ts
const finished = await jobs.waitFor(jobId, ctx.abortSignal);
```

Resolves with the job's history (`finalStatus`, `attempts`, `state`) once it finishes with any status,
and rejects when the repository does not hold the job or the signal aborts. A job enqueued in a
transaction that has not committed yet is not in the repository, so wait after the commit. It needs a repository that
keeps history. It wakes on the repository's `done` notification and also checks every 5 s; each call polls on its
own, so many concurrent waits cost one `get` per wait per 5 s (per 1 s on a repository without push
notifications). Inside a
neuron it holds the neuron for the whole job: use it for short jobs and `onCompleted` for long ones.

## DevTools actions

```ts
await startCNSDevTools(cns, registry, { actions: [jobs.actions()] });
```

`jobs.actions()` carries out the panel's actions the way `createCNSBullActions` does for BullMQ,
forwarding `maxHops` of the action and ignoring `timeoutMs` and `allowedNeuronNames`, as BullMQ does:

- **Retry** (`resume`) of a run that is a job of this repository retries the job under the same id,
  if it has finished. It continues from the saved frontier. If the job is still waiting or running,
  the action is taken and does nothing.
- **Clone** and **Replay** (`launch`) of a collateral that is a job type enqueue a new job under the
  new stimulation id.
- Any other run is passed to the next link. With a repository that keeps no history, a finished job is
  not found, so its Retry also goes to the next link.
- **Commands** (`command`) on a job of this repository: `runNow` moves a delayed job to now (one
  behind its key stays behind it), `prioritize` sets its priority, and `cancel` cancels it. A finished
  job refuses them with an error the panel shows. `runNow` and `prioritize` also refuse a running job or
  one not yet checked after a transactional enqueue.
- The BullMQ and pg-boss links pass commands on untouched.

## DevTools: what is scheduled

```ts
await startCNSDevTools(cns, registry, { actions: [jobs.actions()], scheduledStimulationReader: jobs.scheduledStimulationReader() });
```

The panel gets a **Scheduled** tab and a **Scheduled** section on every collateral and neuron:

- The tab lists the jobs that are not running yet: ready, delayed (`scheduled`), behind their key
  (`key`), or not yet checked after a transactional enqueue (`unchecked`). Each row shows when it is
  due, its `jobKey` and `jobGroup`, how many attempts ran (snoozes do not count) and where it will run.
- The panel also shows the type's cron and interval schedules.
- A job with no saved frontier goes **into** the neurons that listen to its collateral. A job whose
  last attempt saved a frontier **resumes at** it: the neurons and collaterals there. The frontier is
  read from the job's own `state`, so a state repository that keeps it elsewhere shows the entry
  neurons instead.
- The section on a collateral or a neuron lists the jobs that will run there, including retries that
  resume in the middle of the graph.
- Filtering by neuron or collateral scans the waiting jobs page by page. One request reads at most
  20 pages and returns a cursor for the rest. When the scan stops before it finds a match, the section
  says so and offers **Scan further**; with more matches it offers **Show more**.
- The open list and the open section refresh every 2 s until you load more; a page that did not change
  is not redrawn.
- Each row has **▶** run now, **▲ ▼** priority and **✕** cancel. They are sent as `command` actions
  through `actions`, so pass `jobs.actions()` there as well.
- **Enqueue** on the tab builds a form from the type's `payloadSchema`: one field per `string`,
  `number`, `integer` or `boolean` property (an `enum` becomes a select, `required` is checked). Any
  other schema, or none, gets a JSON field. The form sends a `launch` action under a new stimulation id,
  which `jobs.actions()` enqueues as a job of that type. The schema comes from the type's definition in
  this process, so no worker has to run for the form to appear.
- The standalone `cnstra-devtools` server has no reader, so the panel says that no job queue is
  connected.

## Enqueue from a neuron

```ts
cnsNeuron({ orderAccepted }).dendrite({
    collateral: checkoutSubmitted,
    response: async (payload, axon, context) => {
        await jobs.from(context).enqueue(orderPlaced, { orderId: payload.orderId });
        return axon.orderAccepted.createSignal(payload);
    },
});
```

`from(context)` puts `parentStimulationId`, `parentAttemptId` and `traceparent` of the running
stimulation into the job's `meta`, and the job's stimulation gets them back in its `stimulationContext`.
The neuron that enqueued is not recorded: the handler context does not carry it.

## Enqueue in a business transaction

With `@cnstra/jobs-postgres`, pass the wrapped transaction of your ORM:

```ts
await prisma.$transaction(async tx => {
    await tx.order.create({ data: order });
    await jobs.enqueue(orderPlaced, { orderId: order.id }, { transaction: CNSPrismaJobConnection.from(tx) });
});
```

