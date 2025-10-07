---
id: rabbitmq
title: RabbitMQ Integration
sidebar_label: RabbitMQ
slug: /integrations/rabbitmq
---

Use RabbitMQ queues to trigger CNStra runs.

```ts
import amqplib from 'amqplib';
import { CNS } from '@cnstra/core';

const conn = await amqplib.connect(process.env.AMQP_URL!);
const ch = await conn.createChannel();
await ch.assertQueue('events');

const cns = new CNS();
ch.consume('events', async msg => {
  if (!msg) return;
  const payload = JSON.parse(msg.content.toString());
  await cns.stimulate(myCollateral.createSignal(payload));
  ch.ack(msg);
});
```

- Use prefetch and consumer concurrency to apply backpressure
- Consider dead-letter exchanges for poison messages
