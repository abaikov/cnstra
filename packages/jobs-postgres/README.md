# @cnstra/jobs-postgres

> **⚠️ Experimental**: API may change.

A Postgres repository for [`@cnstra/jobs`](../jobs): live jobs, history, the journal, schedules and
handler liveness in one database. It implements `ICNSJobRepository` and passes the same contract
suite as the in-memory repository, plus tests with several processes on one database.

## Install

```bash
npm install @cnstra/jobs @cnstra/jobs-postgres pg
```

## Use

```ts setup
import { CNSJobQueue, CNSJobWorker } from '@cnstra/jobs';
import { CNSPgJobDatabase, CNSPostgresJobRepository, CNSPostgresJobSchema } from '@cnstra/jobs-postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const database = new CNSPgJobDatabase(pool);
await CNSPostgresJobSchema.migrate(database);

const repository = new CNSPostgresJobRepository({ database });
const queue = new CNSJobQueue({ repository });
const worker = new CNSJobWorker({ repository, handlers: [/* … */] });
await worker.start();

await queue.enqueue({ jobType: 'mail', payload: { to: 'a@example.com' } });
```

On shutdown:

```ts
await worker.stop();
await repository.close();
```

Options: `database`, `tablePrefix` (default `cns_`), `history` (keep finished jobs, default `true`),
`now` (clock in ms, default `Date.now`), `generateJobId`, `onError`.

`close()` releases the connections the repository holds for `LISTEN` and for handler liveness.

### The queue's own connection

| driver | database |
|---|---|
| `pg` (node-postgres) | `new CNSPgJobDatabase(pool)` |
| `postgres` (postgres.js) | `new CNSPostgresJsJobDatabase(sql)` |

Behind PgBouncer in transaction mode, pass a second pool that connects to Postgres directly:
`new CNSPgJobDatabase(pool, directPool)`. `LISTEN` and the handler liveness locks need a session and use
that pool; everything else goes through `pool`. With `CNSPgJobDatabase`, if a liveness connection
drops, the repository takes the lock again on a new one; `CNSPostgresJsJobDatabase` does not see the
drop, so the type shows one handler fewer until the process restarts.

### Enqueue in the transaction of your ORM

A job enqueued in your transaction is committed or rolled back together with your data. Wrap the ORM
transaction in a connection and pass it as `transaction`. With these in scope:

```ts setup
import { CNSPrismaJobConnection } from '@cnstra/jobs-postgres';

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

```ts
await prisma.$transaction(async tx => {
    await tx.order.create({ data: order });
    await queue.enqueue({ jobType: 'mail', payload: { orderId: order.id } }, { transaction: CNSPrismaJobConnection.from(tx) });
});
```

A job with a key or its own id enqueued this way stays `unchecked` until a promote checks it. `cancel()` first applies
the same checks, so it ends as it would after a direct enqueue: a request those checks deduplicate is not cancelled and
leaves the job it merged into as it is; any other is cancelled like a waiting job, and a job its key mode supersedes on
the way is reported in `transitions`.

| ORM or driver | connection |
|---|---|
| node-postgres `PoolClient` inside `BEGIN … COMMIT` | `CNSPgJobConnection.from(client)` |
| postgres.js `sql.begin(tx => …)` | `CNSPostgresJsJobConnection.from(tx)` |
| Prisma `$transaction(tx => …)` | `CNSPrismaJobConnection.from(tx)` |
| TypeORM `dataSource.transaction(manager => …)` or a query runner | `CNSTypeOrmJobConnection.from(manager)` |
| Knex `knex.transaction(trx => …)` | `CNSKnexJobConnection.from(trx)` |
| Kysely `db.transaction().execute(trx => …)` | `CNSKyselyJobConnection.from(trx)` |
| Drizzle `db.transaction(tx => …)` | `CNSDrizzleJobConnection.from(tx, sql)` with `sql` from `drizzle-orm` |
| Sequelize `sequelize.transaction(t => …)` | `CNSSequelizeJobConnection.from(sequelize, t)` |
| MikroORM `em.transactional(em => …)` | `CNSMikroOrmJobConnection.from(em)` |

Inside your transaction the queue takes none of its locks. A job without a key and without its own id
is ready at once. A job with a key or its own id comes back with status `unchecked`. After your commit
the workers of that type get a signal and run a promote pass, which applies the key mode and
idempotency the way a direct enqueue does; a direct enqueue on the same key first does the same for the
committed jobs of that key and the committed jobs with its own ids. Committed jobs of one key that wait together are applied in the order they
were enqueued; a transaction still open while another enqueue of its key is applied comes after it, as
if it had been enqueued at its commit. Differences from a direct enqueue:

- debounce counts from the moment the job is applied, not from your enqueue;
- the id you got back can end up merged into the pending job of its key (`latest`, `switch`) or dropped
  as a duplicate; `CNSJobQueue` emits no enqueue event for any job enqueued in your transaction;
- a direct enqueue with the same own id as a job in your open transaction waits for your commit and is
  then reported as `deduplicated` (that is Postgres's unique index, not a queue lock), even if your job is
  later merged into a pending job of its key or dropped as a duplicate. While it waits it
  holds the queue's lock on its own key, so finishing or cancelling another job of that key waits too;
  in the other direction your transaction waits if it inserts an id a direct enqueue has just reserved;
- a job superseded while a committed job is applied is reported as a transition of the promote pass, or
  in `transitions` of the direct enqueue that applied it; `CNSJobQueue` emits it with the type of the
  superseded job.

`transaction` is typed: the repository is `ICNSJobRepository<ICNSPostgresJobTransaction>`, and only the
wrappers above produce that type, so a raw ORM transaction or a pool does not compile; at run time the
repository refuses them too.

The ORM wrappers report `rowCount` as the number of returned rows, so it is exact only for statements
with `RETURNING`; the queue uses only those inside your transaction.

## Schema

`CNSPostgresJobSchema.migrate(database, tablePrefix)` applies the missing schema steps in one transaction under an
advisory lock, so every process can run it at startup, with either driver, and records them in `cns_job_migration`.
A step that removes something (`contract`) is applied only with `{ contract: true }`. `verify(connection, tablePrefix)`
writes nothing and fails when a step this release needs is missing; `migrationSql(tablePrefix, appliedSteps)` hands the
SQL to your own migration tool. The prefix is at most 33 characters. Requires PostgreSQL 12 or later (partitions attached without locking writes).

```
cns_job            live jobs: wait, lease, attempts, state
cns_job_history    finished jobs, partitioned by day of finished_at
cns_job_type       type meta and the type rate-limit state
cns_job_group_throttle
cns_job_log        the journal, one row per entry, removed with its job
cns_job_schedule   schedules by cluster-wide id
```

Time columns hold milliseconds from the repository clock (`now`).

With the worker's `historyHorizonMs`, maintenance keeps the history by day, the way pg_partman and Oban Pro do: it
attaches the next seven days (named after the table and the UTC day, as cns_job_history_p20261104) and drops the days
that ended before the horizon, at most once a day per process and under an advisory lock, so a drop leaves nothing for
vacuum. It reads the job ids of every expired day before the first drop, returns them, and deletes their journal
entries, which live and go with their job as in the in-memory repository. Rows outside the attached days stay in the
DEFAULT partition and are deleted row by row. Without `historyHorizonMs` no partition is made and the per-type
retention deletes rows. A failed rotation is reported after the row deletes are done.

## How it works

- Every repository call is one transaction in `READ COMMITTED`. Locks are taken in one order:
  job id, then job key (advisory), then the job rows (`FOR UPDATE`), then type rows, then group
  throttle rows. Claim starts at type rows and takes job rows with `SKIP LOCKED`; it waits on job rows
  only when it moves a job over its `maxStarted` budget to history. Reads that depend on a lock run as
  separate statements after it. Lease renewals are one statement per lease, each touching a single row.
- Claim takes ready rows with `FOR UPDATE SKIP LOCKED`; a unique index keeps one running job per key.
- Fencing is by `(job_id, seq, attempt number)`.
- Wakeups go through `LISTEN` / `NOTIFY` (`<prefix>job_ready`, `<prefix>job_unchecked`, `<prefix>job_done`, `<prefix>job_cancel`).
- Each `registerTypes` holds a shared advisory lock on its own connection; `listTypes` counts them.
  Releasing a registration or closing the repository closes that connection, and a crashed process
  stops counting as soon as its connection drops.

## Not yet

- one-round-trip `plpgsql` functions for claim and finish;
- a claim that leaves a job over its `maxStarted` budget skips it while another call holds its key.

## Tests

The suites run against a live database when `DATABASE_URL` is set and are skipped otherwise:

```bash
DATABASE_URL=postgresql://localhost:5432/cnstra_jobs_test npm test --workspace @cnstra/jobs-postgres -- --maxWorkers=2
```
