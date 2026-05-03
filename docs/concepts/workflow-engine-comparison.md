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

Temporal / Conductor / Zeebe are typically **durable, distributed systems** with their own operational surface area (clusters, persistence, scaling model).

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
| Great for | Jobs/sync/ETL/sagas inside your services | Cross-service durable workflows |

## A practical mental model

- If you need **durable, distributed workflows spanning many services** with “always-on” history and replay semantics: start with Temporal/Zeebe/Conductor.
- If you need **clean orchestration inside a Node.js service/worker** (and you want it **explicit, deterministic, type-safe**) and you’re happy to compose with queues/persistence: CNStra is a strong fit.

Next:
- Backend overview: [/docs/backend/overview](/docs/backend/overview)
- Recipes: retries, saga: [/docs/recipes/retry](/docs/recipes/retry), [/docs/recipes/saga](/docs/recipes/saga)
