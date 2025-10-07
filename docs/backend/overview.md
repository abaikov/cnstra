---
id: backend-overview
title: Backend Orchestration with CNStra - Sagas, ETL, Queue Systems
sidebar_label: Overview
slug: /backend/overview
description: Use CNStra for backend orchestration, saga patterns, ETL pipelines, and queue-based workflows. Integrates with BullMQ, RabbitMQ, SQS. Type-safe, deterministic, testable orchestration for Node.js, serverless, and microservices.
keywords: [backend orchestration, saga pattern, workflow engine, ETL pipeline, data pipeline, task queue, job queue, message queue, BullMQ, RabbitMQ, SQS, AWS Lambda, serverless orchestration, microservices, Node.js backend, API orchestration, business logic, process automation, distributed workflows, event sourcing, CQRS, long-running processes, background jobs]
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

Pair CNStra with a message queue (BullMQ, RabbitMQ, SQS) to trigger runs and fan-out work. See [Integrations](/docs/integrations/bullmq).
