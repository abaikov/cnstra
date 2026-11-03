# @cnstra/persist

> **⚠️ Experimental**: API and on-the-wire/stored shapes may change in future versions.

The **resumable-execution engine** for CNStra — the write side and storage seams behind
resume, queue integrations, and the DevTools run/attempt/task view. Core-free (depends only
on `@cnstra/types` + `@cnstra/persist-dto`); topology is referenced by **name** everywhere
and never persisted (code is its source of truth).

## What's in it

- **`CNSProgressSerializer`** — serialize a live stimulation's frontier + context to/from
  the name-based `TCNSProgress`.
- **`CNSStimulationPersistor`** — record the full **Stimulation → Attempt → Task** model
  (`onResponse` → an `ICNSStimulationRepository`). The recorder the queue workers and
  DevTools share.
- **`CNSProgressRecorder`** — the narrower, frontier-only sibling (writes a checkpoint blob
  to an `ICNSProgressRepository`).
- **Storage seams** — `ICNSStimulationWriter` / `ICNSStimulationReader` /
  `ICNSStimulationRepository` (run/attempt/task) and `ICNSProgressRepository` (frontier).
- **`CNSInMemoryStimulationRepository`** / **`CNSInMemoryProgressRepository`** — in-memory
  reference stores. Bound the stimulation store (`maxStimulations` / `ttlMs` /
  `deleteOnComplete`) so `observe`-style use does not leak.
- **`CNSFanOutStimulationWriter`** — one persistor, several sinks (a store, the DevTools
  transport, a tracing exporter). One persistor in front of it keeps a single task
  numbering and a single `inputIndex` space, which running one persistor per sink would
  not. A sink that throws is logged and skipped, never failing the write for the others;
  `getStimulation` asks each in turn and returns the first answer, so put the real store
  first.
- **`CNSPersistOptionsRegistry`** (+ `CNSPersistOptionsRegistryFactory`) — the name ⇄ object
  bridge every serialize/hydrate resolves through.

Postgres adapter: [`@cnstra/persist-postgres`](https://www.npmjs.com/package/@cnstra/persist-postgres).

## Docs

See the full guide: **[Resumable execution](https://cnstra.org/docs/advanced/resumable-execution)**
(the model, `resume` vs `observe`, stores & bounds) and
[Persistence & Resume](https://cnstra.org/docs/advanced/persistence).

## License

MIT
