# @cnstra/persist-dto

> **⚠️ Experimental**: API may change.

The **canonical, name-based, zero-runtime model** for CNStra durable execution — the shared
type contract behind `@cnstra/persist`, `@cnstra/persist-postgres`, the queue integrations, and
the devtools protocol. Topology is referenced by **name** everywhere and never persisted (code
is its source of truth).

## The model (naming — read this to avoid confusion)

| role | type | id |
|---|---|---|
| the **stable logical unit** a human retries | **Stimulation** — `TCNSStimulation{Dto,Persisted}` | `stimulationId` (+ optional `scopeName`) |
| **one attempt / execution** (a `cns.stimulate` / `cns.activate`) | **StimulationAttempt** — `TCNSStimulationAttempt{Dto,Persisted}` | `stimulationAttemptId` + `attemptNumber` |
| **one settled hop** | **StimulationTask** — `TCNSStimulationTask{Dto,Persisted}` | ordinal `index` (belongs to an attempt) |

`(stimulationId, attemptNumber)` is unique. Mnemonic ≈ Temporal: **Stimulation ≈ Workflow**
(stable), **StimulationAttempt ≈ Run** (a specific execution). A Stimulation groups its attempts;
`progress` (`{ tasks, context }`, by name) is the live resume state carried across attempts.

### `scopeName`

`TCNSStimulation` carries an optional **`scopeName?: string`** — the identity of a CNS/graph.
All attempts of a stimulation inherit it (a stimulation never spans scopes). **Unset → one default
scope** (everything in one bucket); **set → routing + isolation:** neuron/collateral names are
unique *within a scope*, and resume reads `stimulation.scopeName` to hydrate the frontier against
the right CNS/registry — so auto-resume lands in the right CNS even when two graphs reuse a neuron
name. Topology is stored/served under `scopeName` (a `scopeName` = one CNS's graph).

## Emit vs stored

Each entity has a `Dto` form (emitted, pre-id) and a `Persisted` form (stored, richer, defined
independently). Task input is **inline** on the Dto (`input: TCNSSignalRef`) but **deduped** to
an `inputIndex` slot on the Persisted form (input space = `[entry(0..k-1), tasks(k..)]`).

## License

MIT
