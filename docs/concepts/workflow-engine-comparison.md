---
id: workflow-engine-comparison
title: CNStra vs Temporal / Conductor / Zeebe
sidebar_label: Comparison (Temporal/Zeebe)
slug: /concepts/comparison
description: Compare CNStra with Temporal, Netflix Conductor, and Camunda Zeebe. Learn where an embeddable in-memory workflow engine fits, and how to combine CNStra with queues/persistence for backend jobs, retries, ETL, and sagas.
keywords:
  [
    workflow engine,
    orchestrator,
    orchestration engine,
    Temporal,
    Netflix Conductor,
    Conductor,
    Zeebe,
    Camunda,
    saga,
    retries,
    ETL,
    backend jobs,
    BullMQ,
    Node.js workflow,
    TypeScript workflow,
  ]
---

If you’re searching for a “workflow engine / orchestrator”, you’ve probably looked at **Temporal**, **Netflix Conductor**, or **Camunda Zeebe**.

**CNStra is different by default**: it’s an **embeddable, in-memory workflow/orchestration engine** for TypeScript that runs deterministic flows over a typed graph (neurons + collaterals). There’s no separate cluster to operate — you embed it into your app/worker.

## Where CNStra fits best

- **Backend jobs**: workers, fan-out/fan-in, concurrency gates
- **Sync / integrations**: webhooks, external APIs, multi-step validation + side-effects
- **ETL / pipelines**: step-by-step transforms with retries/backoff
- **Sagas**: explicit compensation steps for partial failures

## CNStra vs “distributed workflow engines”

Temporal / Conductor / Zeebe are typically **resumable, distributed systems** with their own operational surface area (clusters, persistence, scaling model).

With CNStra, you start from:
- **Embeddability** (library, not a platform)
- **Determinism & explicit routing** (no hidden listeners / no global event bus)
- **Type safety** (flow boundaries are typed)

And you *add durability* when you need it:
- Trigger runs from a **queue** (e.g. BullMQ) or message broker
- Persist correlation/state externally between runs (database/object storage)
- Re-stimulate on retries/timeouts/webhooks with correlation data

## Quick comparison (high level)

| Capability | CNStra | Temporal / Conductor / Zeebe |
|---|---|---|
| Default model | **Embeddable library** | **Distributed platform** |
| Durability out of the box | In-memory (bring your own persistence) | Built-in persistence |
| Operations overhead | Low | Medium–high |
| TypeScript-first | **Yes** | Varies (SDKs / DSLs) |
| Great for | Jobs/sync/ETL/sagas inside your services | Cross-service resumable workflows |

## Not either/or — CNStra is an adapter over the engine underneath

The comparison above is framed as "vs", but that's not the whole story. CNStra deliberately
**decouples the flow from how it's executed and persisted**. Your neurons + collaterals describe
*what* happens; *how* it runs durably is a set of pluggable seams:

- **entry** — `cns.stimulate(signal)` (from an HTTP call, a cron, a queue job)
- **resume** — `cns.activate(tasks, { ctx })` from a serialized frontier (`ICNSProgressRepository`)
- **history / observability** — `observe` → `ICNSStimulationRepository`

Because those seams are interfaces, the **execution backend is swappable without rewriting the
flow**. The same graph runs:

- **in-memory** (embedded, zero infra) for dev, sync request handling, or ETL inside a service;
- on **pg-boss** (Postgres) or **BullMQ** (Redis) for resumable jobs + retry/backoff + frontier
  resume — you change the worker wiring, not the neurons;
- and, in principle, on a **distributed engine like Temporal/Zeebe** via an adapter that maps
  those same seams onto its resumable execution — so CNStra becomes the **typed orchestration
  layer on top**, and the heavy resumable engine is an implementation detail you can adopt (or
  drop) later.

So the practical move is often **CNStra + X**, not **CNStra or X**: start embedded, grow into a
queue when you need durability, and keep the option of putting a distributed engine underneath —
all without touching your flow definitions. (A first-party Temporal/Zeebe adapter isn't shipped
yet; the seams are what make it a wrapper rather than a rewrite.)

## A practical mental model

- If you need **resumable, distributed workflows spanning many services** with “always-on” history and replay semantics: start with Temporal/Zeebe/Conductor — or drive them through CNStra as the typed layer on top.
- If you need **clean orchestration inside a Node.js service/worker** (and you want it **explicit, deterministic, type-safe**) and you’re happy to compose with queues/persistence: CNStra is a strong fit, and you can move the backend under it later without a rewrite.

Next:
- Backend overview: [/docs/backend/overview](/docs/backend/overview)
- Recipes: retries, saga: [/docs/recipes/retry](/docs/recipes/retry), [/docs/recipes/saga](/docs/recipes/saga)
