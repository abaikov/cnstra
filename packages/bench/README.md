# @cnstra/bench

Performance benchmarks for CNStra, plus the mechanism by which a slowdown
becomes visible.

Benchmarks that nobody compares are decoration, so this package is built around
that second half: four metric kinds, three of which mean the same thing on every
machine, and a comparator that refuses to call a change a regression unless the
change is larger than the noise it measured.

**Private on purpose.** `"private": true`, no `files`, no `"publishConfig"`.
Nothing here belongs in an application's dependency tree: it exists to measure
this repository, its fixtures are deliberately artificial, and publishing it
would create a public API surface — and a compatibility obligation — around a
measuring tool. The CNS naming convention is still followed throughout, because
the repository's conventions are about readability, not about npm.

---

## Running it

From the repository root:

```bash
npm run bench                          # measure and print
npm run bench:baseline                 # measure and keep the result for this machine
npm run bench:compare                  # measure and read against that baseline
```

Options go after `--`, from the root like anything else:

```bash
npm run bench -- --filter roster
npm run bench:compare -- --check
```

Running under a collector needs the flag on the node process itself, so that
one is from the package directory:

```bash
cd packages/bench
node --expose-gc --import tsx src/main.ts run --gc
```

`--gc` collects between cases so one case's garbage is not swept during the
next case's samples. It is a small improvement, not a requirement; without the
flag it is skipped and the report records that it was.

`tsx src/main.ts --help` lists every option.

No build step. The benchmarks import the packages' `src` directly rather than
their `dist`, because a `dist` is only as current as the last build and a
benchmark that silently measures a stale bundle is worse than no benchmark —
it reports "no regression" about code that is not running. The repository's own
tests bind the same way (`packages/persist/jest.config.js` maps `@cnstra/core`
to `../core/src/index.ts`). All of that coupling lives in one file,
`src/cnstra.ts`; switching to measure the published bundles instead is a
one-file edit, documented there.

### No new dependencies

`tinybench`, `mitata` and `benchmark.js` are all absent from this repository's
lockfile. Adding one would mean a new install and a new supply-chain surface in
exchange for: calibrate a batch, warm up, take samples, compute percentiles.
`node:perf_hooks` covers that in about seventy lines
(`src/CNSBenchRunner.ts`), and `process.hrtime.bigint()` is the same clock
those libraries use. The two declared devDependencies — `tsx` and
`@opentelemetry/api` — are both already in the lockfile at the versions
requested, so nothing new is fetched.

---

## What is measured, and in what unit

Every case reports **per one operation**, and every case states in words what
one operation is; the reporter prints that sentence under the numbers. Figures
are a **median** of the samples with the **inter-quartile range** and a
**relative median absolute deviation** next to them, plus the sample count and
batch size, so the spread is never hidden behind a single number.

### `engine` — the per-signal path, nothing attached

These run `cns.stimulate()` with no listener at all. That matters: with no local
`onResponse` and no global response listener, `CNS.wrapOnResponse` returns
`undefined` and the stimulation takes a genuinely different route — it never
builds a response object per signal. This is the path an application without
devtools actually runs.

| case | one operation is | unit |
| --- | --- | --- |
| `engine/linear-chain-{8,16,32,64}` | one `stimulate()` through an N-neuron synchronous chain: N dendrite bodies, N signals | ns/op, ops/s, bytes/op |
| `engine/fan-out-{8,16,32,64}` | one `stimulate()` of a signal with N subscriber neurons: N dendrite bodies from one signal | ns/op, ops/s, bytes/op |
| `engine/linear-chain-async-8` | the same 8-hop chain with handlers returning an already-resolved promise, awaited to completion | ns/op, plus a ratio against the synchronous case |

The synchronous cases do not await anything, because a synchronous chain drains
inside `stimulate()` before the call returns; awaiting would add a promise and a
microtask per operation to a path that has neither. The async case exists to
price the engine's asynchronous route — parking, one microtask per hop,
resuming the pump — with handlers that do no work, so nothing hides it.

### `observe` — what turning telemetry on costs

The same eight-hop flow five times over, each awaited to completion so the only
difference between them is the observation. Each reports a **ratio against
`observe/none`** as well as an absolute figure.

| case | one operation is |
| --- | --- |
| `observe/none` | the 8-hop run with nothing observing it (the fast path above) |
| `observe/response-listener` | the same, with one global no-op response listener |
| `observe/persistor-progress` | the same, plus `CNSStimulationPersistor` at volume `progress` writing to an in-memory store, awaited through its write chain |
| `observe/persistor-full` | the same at volume `full` — one task row per hop |
| `observe/persistor-full-barrier` | volume `full` with `barrier: true` — every hop parked until its checkpoint has landed |
| `observe/otel-tracing` | the same, with `attachCNSOtelTracing` attached |

Two things to know when reading these.

The listener case does not measure the listener. The listener increments a
counter. What it measures is the cost of **leaving the no-listener fast path** —
a response object per signal, the wrapper, the promise check. That is the floor
under every integration, and it is paid the moment the first listener attaches.

The tracing case does not measure OpenTelemetry. Its tracer records and drops.
It measures what **CNStra** spends producing a trace: the global listener on
every hop, a span opened per scheduled activation, traceparent formatting, the
context compartment written into each activation's store, the registry lookups
behind the span names. Sampling, attribute processing, batching and export
belong to whoever configures the exporter, move with their sampling ratio, and
would swamp the part this repository can regress.

The persistor cases construct a persistor inside the measured body, because a
persistor belongs to one attempt of one run — "turning persistence on" really
does mean paying for one per run. They also `await dispose()`, which hands back
the outstanding write chain; without it the measurement would stop where the
writes were queued rather than where they landed.

### `frontier` — the resume checkpoint round trip

`CNSProgressSerializer.serialize` runs at every checkpoint of every persisted
run — on the debounced cadence normally, on every hop under `barrier: true`.

| case | one operation is |
| --- | --- |
| `frontier/serialize-{8,16,32,64}` | one `serialize()` of an N-task outstanding frontier into a name-keyed progress record |
| `frontier/hydrate-32` | one `hydrate()` of a **stored** 32-task record back into activation tasks |
| `frontier/round-trip-32` | serialize → `JSON.stringify` → `JSON.parse` → hydrate |

The frontier is real, not mocked: a fan-out of N throwing neurons, which the
engine records as N failed tasks, and failed tasks are part of the outstanding
frontier. That is how the persist package's own tests capture one.

Hydration is fed the record **after** a JSON round trip, not the live object the
serializer just produced — what comes out of a store is a fresh plain object
with no shared references, and hydrating the live one would measure a case that
never happens.

One caveat stated plainly: in these cases `n` is both the frontier size and the
graph size, because each of those neurons brings its own collateral into the
registry, and the two grow together in a real application too. The growth
exponent therefore covers both the per-task serialization work and however
`CNSPersistOptionsRegistry.getCollateralName` scales with the number of
registered collaterals. It is the cost of a real checkpoint, not an isolation of
one variable.

### `roster` — the derivation the devtools panel re-runs on a timer

`loadCNSRosterEntries` is the reference implementation every store that cannot
push the query into SQL falls back on — the in-memory store and the devtools
server both run it, and the panel re-runs it every couple of seconds.

| case | one operation is |
| --- | --- |
| `roster/load-entries-{50,100,200,400}` | one `loadCNSRosterEntries()` over a store of N runs, one attempt and 3 task rows each |
| `roster/query-page-200` | one `repository.queryRoster()` returning the first 50-row keyset page from 200 runs |
| `roster/facets-200` | one `computeCNSRosterFacets()` over 200 already-loaded entries |

For this suite the **growth exponent matters more than the speed**. A derivation
that is comfortable at fifty runs and unusable at a thousand is the failure
mode, and it is invisible to a benchmark that measures one size. The store is
seeded directly rather than by running the engine, so the number is about the
query and not about the engine.

These cases are milliseconds per operation rather than nanoseconds, so they take
fewer samples (15) and a shorter warmup. That widens their spread; the
comparator accounts for spread when it decides what counts as a regression.

---

## Determinism

- No `Math.random` anywhere in a measured path. Fixtures are functions of their
  index: statuses, collateral names, neuron names and timestamps all cycle.
- One frozen payload object, shared by every signal of every iteration, so no
  case is quietly measuring allocation of test data.
- Roster timestamps come from a fixed epoch constant, never the wall clock.
- Every case has a `verify` step that runs once before warmup and throws if the
  fixture is not doing the work the case claims — a benchmark whose fixture
  silently stopped firing reports a spectacular improvement, which is the most
  expensive way for a performance suite to be wrong.

---

## Recording a baseline, and comparing against it

```bash
npm run bench:baseline                      # writes packages/bench/baselines/<machine>.json
# ...change something...
npm run bench:compare                       # prints what moved

# with options (see "Running it" on why these address the workspace directly)
npm run bench:compare -- --check
npm run bench:compare -- --baseline ./somewhere/else.json
```

Baselines are filed under the machine that produced them —
`darwin-arm64-<cpu>-node22.json` — and the directory is git-ignored. A single
shared `baseline.json` would guarantee that whoever ran it last made everyone
else's comparison a lie.

### The four metric kinds and their tolerances

| metric | judged when | default tolerance |
| --- | --- | --- |
| `alloc:<case>` — bytes allocated per operation | always, when both probes got a collection-free window | 10% |
| `case:<case>` — median ns/op | only when the baseline came from the same machine and Node major | 25% |
| `ratio:<case>` — the price of an option, as a multiple | always | 20% |
| `scaling:<family>` — fitted growth exponent `k` in `time ~ n^k` | always | 0.25 exponent units |

On top of the fixed number, every threshold is widened to at least **twice the
run-to-run spread the baseline recorded for that metric**. `bench:baseline` runs
the whole suite several times (`--repeat`, default 3) and stores how far each
metric moved between those runs; the comparator looks the metric up and widens
its gate to clear it, naming the reason in the entry's note. Where a baseline
carries no spread for a metric — a single-run recording — the gate falls back to
twice the within-run sample spread, and says that too.

The distinction is the whole point. The spread of the samples inside one run is
not the spread between runs and is not even correlated with it:

| case | within-run (`rmadPercent`) | between three runs |
| --- | --- | --- |
| `observe/response-listener` | 1.0% | 86.7% |
| `frontier/hydrate-32` | 0.3% | 42.2% |
| `roster/load-entries-400` | 0.3% | 8.0% |

A case that lands in a different compilation tier or heap layout per process is
stable inside a run by construction, so the run is the wrong place to ask. It was
asked there, and two compares of unchanged code against the same baseline
reported three regressions and then eight, a different set each time.

Between the floor and the threshold sits `suspect`: moved further than this
metric usually does, not far enough to fail anything over. That band is where a
slow drift shows up before it becomes a regression.

### Every run discards a warmup pass

`run`, `baseline` and `compare` all execute the suite one extra time and throw
the first pass away. Each case has its own warmup, which settles its timings, but
not the tier V8 compiles it to across a whole suite: `engine/linear-chain-64`
allocates 19420 bytes an operation on the first pass and 23005 on the second and
third, from the same probe window, both exact.

It has to be all three commands and not just `baseline`. A baseline recorded
from later passes and compared against a single-pass run puts two different
compilation states side by side, and every engine allocation then reads 25–32%
"faster" forever.

### Why 25% and not 5%

A JavaScript microbenchmark on a laptop does not repeat to within 5%. Thermal
throttling, another process waking up, the allocator landing objects in a
different cache line, a Node patch release changing an inline-cache heuristic —
any one of those moves a median by several percent with nothing whatsoever
having changed in the code. A gate set at 5% fires on noise, and a gate that
fires on noise gets muted within a week, at which point the whole apparatus is
decoration.

So the timing gate is set where a fired gate is worth reading, and the tight
gate is put on the metric that deserves one.

That reasoning was an argument until it was measured. Three baseline recordings
of unchanged code on one machine spread like this:

| what | spread between three runs of the same code |
| --- | --- |
| wall-clock, worst case (`observe/response-listener`) | 86.7% |
| wall-clock, second worst (`frontier/hydrate-32`) | 42.2% |
| wall-clock, the other twenty-two cases | under 9% |
| allocation, twenty-one of twenty-two cases | 0.0–1.1% |
| allocation, `engine/linear-chain-8` | 44.0% — the probe, not the metric |
| growth exponent | 0.95–1.01 |

Read that as three separate verdicts. The growth exponent is the steadiest thing
here and deserves the tightest gate. And a single flat timing threshold cannot be
right for both a case that repeats within 2% and one that swings by 87% — which
is why the threshold now comes from repeated recordings of each metric.

The allocation row was the one to act on, and acting on it found that the probe
had been reporting `exact` for windows it had no business calling clean. After
the estimator and the collection check were fixed, the same measurement reads:

| what | spread between three runs of the same code |
| --- | --- |
| allocation, all twenty-seven cases | worst 0.18%, median 0.01% |

Twenty-seven, not twenty-two: five cases used to come back inexact and be
skipped by the gate altogether.

### The allocation metric is the one to watch

`alloc:<case>` is bytes allocated on the JS heap per operation, and it is not a
timing. The regression this codebase is actually exposed to is "someone added an
allocation to every hop": a closure, an options object, a spread, an array that
used to be shared. On a wall clock that is a few percent and drowns. In bytes it
is a step — the same step on every machine, on every Node version, under any
load.

It is made exact rather than estimated, and two things are needed for that.

**A window that is really clean.** `heapUsed` only reports what is currently
live, so a window's delta equals total bytes allocated only if no collection ran
inside it. A `PerformanceObserver` watches for collections; a window that saw one
is thrown away and retried with half as many operations. The catch is how long
that check has to wait: collector entries arrive only after a macrotask turn, so
a single `setImmediate` sees **zero collections in every window** — and a window
big enough to collect then reports what survived it. On `engine/linear-chain-64`
that read 19420 bytes an operation at one budget and 3054 at twice the budget,
six times apart, both marked exact. A `setTimeout(0)` plus a microtask drain is
what it takes; with it, every budget from 64 to 4096 operations answers within
0.05% of the same figure.

**An estimator with no per-window constant in it.** A window of `n` operations
moves the heap by `n * bytesPerOperation + C`, where `C` is the two `memoryUsage()` calls,
the loop and whatever unrelated allocation landed inside. Dividing one window by
`n` charges all of `C` to the operations. Two windows at `n` and `2n` subtract it
away exactly — `d(2n) - d(n) = n * bytesPerOperation` — and the probe takes nine such pairs
and reports the median slope, plus how uncertain that median is. Beyond a few
percent of uncertainty it declines to call the result exact, and the comparator
then declines to judge it rather than gating on a number it cannot trust.

---

## What this catches, and what it misses

The honest part. Read it before wiring `--check` into anything.

### It catches

- **An allocation added to a hot path.** The clearest signal in the package:
  exact, machine-independent, and gated at 10%. A new object per response or per
  activation shows up unmistakably in `alloc:observe/*` and `alloc:engine/*`.
- **A complexity change.** A derivation going from linear to quadratic moves its
  fitted exponent by about a whole unit against a 0.25 tolerance. This is the
  specific thing `roster/load-entries` exists for.
- **Telemetry getting more expensive.** The `observe/*` ratios price each
  listener against the same flow without it, so a change in the persistor or in
  tracing shows up as its ratio moving even on a different machine.
- **Leaving a fast path.** `observe/none` against `observe/response-listener`
  measures the engine's no-listener route directly; if the fast path stops being
  taken, that ratio collapses toward 1.0 and the absolute baseline case slows.
- **A structural slowdown on the same machine** — roughly 25% or worse on a
  median, which is what an extra `await` per response, a lookup turned into a
  scan, or a lost inline cache tends to look like.

### It misses

- **Small regressions.** Anything under ~10% on a timing is inside the tolerance
  by design. Five separate 5% regressions land as five `unchanged` verdicts. The
  `suspect` band is the only warning of that, and it is advisory.
- **Absolute timings across machines.** A comparison against a baseline from
  another machine skips every `case:` entry outright. There is no honest
  conversion between two CPUs, so none is attempted. Ratios, exponents and
  allocations still work.
- **Anything concurrent.** Every case is a single run at a time on one thread.
  Contention, the global per-neuron queue under load, backpressure, event-loop
  starvation, and the shape of a real worker running many stimulations at once
  are all outside what is measured here.
- **Real I/O.** Stores are in-memory, handlers do no work, the tracer exports
  nothing. Postgres and Redis are deliberately excluded: they need live
  infrastructure and their numbers would be about the database.
- **Cross-case interference.** All cases share one process, so a case can
  inherit the heap and the inline-cache shapes the previous one left. Running
  `--filter` on a single case gives a cleaner number than the full sweep does.
- **Memory retention and leaks.** The allocation probe measures allocation rate,
  not retention. A listener that never unsubscribes, a map that grows forever, a
  span that is never ended — none of that is detected. Those are real risks in
  this codebase and they need their own check.
- **Startup and graph construction.** Everything is built in `prepare` and never
  measured. `new CNS(neurons)` builds a subscriber index and computes strongly
  connected components; that cost is invisible here.
- **Anything the fixtures do not resemble.** Eight-hop chains and 64-wide
  fan-outs of no-op handlers are not an application. A regression that only
  appears with large payloads, deep async trees, aborts, hop limits, or
  per-neuron concurrency limits will not show up.

### On using `--check` in CI

It is deliberately not wired into any shared CI job. A cloud runner's timing
variance is far wider than a quiet laptop's — noisy neighbours, no frequency
guarantees, a different machine class between two runs — and against a stored
absolute baseline it would produce false failures until somebody deleted the
job.

If it is wanted in CI, the defensible shape is: a dedicated, quiet, pinned
machine; a baseline recorded on that same machine; and — if only one gate is
wanted — `alloc:` alone, which is the one class of metric a noisy runner cannot
lie about.

---

## Files

```
src/main.ts                        CLI: run | baseline | compare
src/index.ts                       the harness as a library
src/cnstra.ts                      the single seam to the code under test
src/CNSBenchRunner.ts              calibrate, warm up, sample, assemble the report
src/CNSBenchAllocationProbe.ts     exact bytes-per-operation, with a collection guard
src/CNSBenchStatistics.ts          percentiles and relative MAD
src/CNSBenchScalingAnalyzer.ts     log-log fit of time ~ n^k
src/CNSBenchMachine.ts             machine identity, and whether two reports are comparable
src/CNSBenchBaselineStore.ts       read/write baselines/<machine>.json
src/CNSBenchComparator.ts          the four gates and their verdicts
src/CNSBenchReporter.ts            console output
src/fixtures/                      graphs, frontiers, seeded roster stores, a recording tracer
src/suites/                        the cases
src/types/                         the shapes above
```
