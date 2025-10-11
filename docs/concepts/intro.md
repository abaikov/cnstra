---
id: concepts-intro
title: Introduction to CNStra - Type-Safe Orchestration Library
sidebar_label: Introduction
slug: /concepts/intro
description: CNStra is a zero-dependency state machine and orchestration library for JavaScript/TypeScript. Learn about IERG (Inverted Explicit Reactive Graph), deterministic workflows, and SOLID/SRP principles for React and backend applications.
keywords: [introduction, getting started, state machine basics, orchestration tutorial, IERG, reactive graph, deterministic state machine, neuron model, signal flow, type-safe orchestration, JavaScript state management, TypeScript orchestration]
---

Central Nervous System (CNS) for apps.

Think of your application as an organism. Instead of a global event bus, you have a central nervous system that runs deterministic, typed reactions across a graph of neurons. This makes flows explicit, testable, and fast.

CNStra (Central Nervous System Orchestrator) is an IERG (Inverted Explicit Reactive Graph): you explicitly start a run; each neuron explicitly returns the next step; nothing happens in the background unless you ask for it.

Name: CNS + "tra" (orchestrator) → CNStra.

Analogy: biology ↔ application
- CNS (central nervous system) ↔ `CNS` orchestrator instance running the graph
- Neuron ↔ a unit of logic that reacts to one input and produces one continuation
- Dendrite (input) ↔ neuron.dendrite bound to a specific collateral
- Axon (outputs) ↔ neuron’s `axon` with named output channels
- Collateral (channel) ↔ typed output channel that mints signals
- Signal (impulse) ↔ typed payload traveling the graph
- Stimulation (nerve firing) ↔ `cns.stimulate(signal, options)` run
- Context (local chemistry) ↔ per‑run context store passed to dendrites
- Queues (conduction control) ↔ ordered/batched/parallel execution with backpressure

Key properties
- Deterministic: same input → same path; hop‑bounded; no hidden listeners
- SRP by construction: actors are visible; responsibilities are local and explicit
- Ownership: a neuron emits only its axon’s collaterals; others bind via dendrites

Short vs long flows
- Short‑lived (one stimulation): complete a bounded flow in a single run (validate → fetch → render), cancel with `AbortSignal`
- Long‑lived (many stimulations): continue on external events (queue/webhook/cron) by re‑stimulating with correlation data

Where to go next
- Concepts: [IERG](/docs/concepts/ierg)
- Frontend: [CNStra & OIMDB](/docs/frontend/oimdb)
- Core: [Quick Start](/docs/core/quick-start), [API](/docs/core/api)
