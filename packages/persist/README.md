# @cnstra/persist

> **⚠️ Experimental**: API and on-the-wire/stored shapes may change in future versions.

The **durable-execution engine** for CNStra — the write side and storage seams behind
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
- **`CNSPersistOptionsRegistry`** (+ `CNSPersistOptionsRegistryFactory`) — the name ⇄ object
  bridge every serialize/hydrate resolves through.

Postgres adapter: [`@cnstra/persist-postgres`](https://www.npmjs.com/package/@cnstra/persist-postgres).

## Docs

See the full guide: **[Durable execution](https://cnstra.org/docs/advanced/durable-execution)**
(the model, `resume` vs `observe`, stores & bounds) and
[Persistence & Resume](https://cnstra.org/docs/advanced/persistence).

## License

MIT
