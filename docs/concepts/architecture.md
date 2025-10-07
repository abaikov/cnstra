---
id: architecture
title: Architecture Overview
sidebar_label: Architecture
slug: /concepts/architecture
---

CNStra models data processing as a network of neurons connected via signals and queues.

- Neuron: a pure handler transforming input signal into output response.
- Signal: typed payload flowing through the network.
- Queue: orchestrates ordered, batched, or parallel processing.
- Stimulation: entry point that triggers neuron execution with context.
- Context Store: per-stimulation data store for cross-cutting concerns.

Benefits:
- Composability and testability
- Strong typing (TypeScript)
- Pluggable devtools and visualization
- Works in app or server environments
