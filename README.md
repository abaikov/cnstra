# CNStra

**Workflow / orchestration engine for TypeScript** — embeddable, deterministic, in-memory.

Build explicit backend workflows (jobs, sync, ETL), retries/timeouts, and saga-style compensations using a **typed neuron graph** (no hidden listeners / no global event bus).

📚 **[Documentation](https://cnstra.org/)** — Quick Start, API Reference, Recipes, Examples

## What you can use it for

- **Backend jobs**: queue-triggered workers, fan-out/fan-in, concurrency gates
- **Sync / integrations**: webhooks → validation → persistence → side-effects
- **ETL / pipelines**: step-by-step transforms with checkpoints and retries
- **Retries / timeouts / cancellation**: deterministic runs with backoff patterns
- **Saga-style flows**: compensation steps when downstream work fails

## If you know Temporal / Conductor / Zeebe

**CNStra is an in-memory, embeddable workflow/orchestration engine** (Node.js + TypeScript). It’s not a distributed durable system by default, but it’s designed to compose cleanly with queues (e.g. BullMQ) and external persistence when you need it.

## Keywords / categories

workflow engine • orchestrator • orchestration • saga • retries • job orchestration • ETL

## Packages

- `@cnstra/core` — the workflow/orchestration engine (deterministic, hop‑bounded runs). See [packages/core/README.md](packages/core/README.md)
- `@cnstra/react` — React bindings (provider + hooks). See [packages/react/README.md](packages/react/README.md)
