---
id: aws-sqs
title: AWS SQS Integration
sidebar_label: AWS SQS
slug: /integrations/aws-sqs
---

Use SQS to decouple producers from CNStra workers.

```ts
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { CNS } from '@cnstra/core';

const sqs = new SQSClient({});
const cns = new CNS();
const queueUrl = process.env.QUEUE_URL!;

async function poll() {
  const { Messages } = await sqs.send(new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 20,
  }));

  for (const m of Messages ?? []) {
    const payload = JSON.parse(m.Body ?? 'null');
    await cns.stimulate(myCollateral.createSignal(payload));
    await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! }));
  }

  setImmediate(poll);
}

poll();
```

- Prefer long polling with `WaitTimeSeconds`
- Control concurrency with a worker pool or CNStra queues
