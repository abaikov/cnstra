---
id: backend-overview
title: Backend Overview
sidebar_label: Overview
slug: /backend/overview
---

CNStra fits backend workloads where you need deterministic, typed orchestration.

Examples:
- Worker pipelines and ETL steps
- Integrations reacting to queue messages or webhooks
- Sagas and long-running processes with cancellation

Why CNStra on the backend:
- Deterministic routing across neurons (no global pub/sub ambiguity)
- Backpressure via queue concurrency and per-neuron gates
- Type-safe boundaries and testable units

Pair CNStra with a message queue (BullMQ, RabbitMQ, SQS) to trigger runs and fan-out work. See [Integrations](/integrations/bullmq).
