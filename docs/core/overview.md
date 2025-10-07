---
id: core-overview
title: Core Overview
sidebar_label: Overview
slug: /core/overview
---

Graph-routed, type-safe orchestration for reactive apps — no global event bus.

CNStra models your app as a typed neuron graph. You explicitly start a run with `cns.stimulate(...)`; CNStra then performs a deterministic, hop-bounded traversal from collateral → dendrite → returned signal.

## Why CNStra

- **Zero dependencies**: No third-party packages. Works in browsers, Node.js, serverless, edge, React Native, embedded systems.
- **Simple implementation**: The core is a set of TypeScript types, factory methods that enforce type safety, and a straightforward queue-based graph traversal. No magic, no complex runtime.
- **Deterministic routing**: Signals follow an explicit neuron graph, not broadcast to whoever "happens to listen".
- **Readable flows**: Each step is local and typed; branches are explicit, so debugging feels like reading a storyboard.
- **Backpressure & concurrency gates**: Built-in per-stimulation and per-neuron concurrency limits.
- **Saga-like orchestration**: Multi-step reactions with retries/cancellation (AbortSignal) via explicit branches.

## Key Features

- Deterministic routing
- Readable flows with explicit branches
- Backpressure & concurrency gates
- Saga-like orchestration via explicit branches and abort

See also: [Quick Start](/docs/core/quick-start), [API](/docs/core/api), [Stimulation Options](/docs/core/stimulation-options).
