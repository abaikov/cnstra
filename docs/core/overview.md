---
id: core-overview
title: Core Overview
sidebar_label: Overview
slug: /core/overview
---

Graph-routed, type-safe orchestration for reactive apps — no global event bus.

CNStra models your app as a typed neuron graph. You explicitly start a run with `cns.stimulate(...)`; CNStra then performs a deterministic, hop-bounded traversal from collateral → dendrite → returned signal.

- Deterministic routing
- Readable flows with explicit branches
- Backpressure & concurrency gates
- Saga-like orchestration via explicit branches and abort

See also: [Quick Start](/core/quick-start), [API](/core/api), [Stimulation Options](/core/stimulation-options).
