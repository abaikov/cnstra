---
id: api
title: API
sidebar_label: API
slug: /core/api
---

### `collateral<T>(id: string)`
Create a typed output channel.

```ts
const userEvent = collateral<{ userId: string }>('user:event');
const simpleEvent = collateral('simple:event');
```

### `neuron(id: string, axon: Axon)`
Create a neuron with the given axon.

```ts
const myNeuron = neuron('my-neuron', { output: myCollateral });
```

### Signal ownership

:::warning Signal ownership
A neuron may emit only collaterals declared in its own axon. It must not emit another neuron's collaterals. Cross-neuron orchestration is done by having a controller own request collaterals and letting each domain neuron emit its own responses.
:::

Incorrect (emits someone else's collateral):

```ts
// DON'T: myNeuron emits otherAxon.some
return otherAxon.some.createSignal(result);
```

Correct (controller-owned request, domain emits its own):

```ts
const controller = neuron('controller', { requestA });
const serviceA = neuron('serviceA', { doneA })
  .dendrite({ collateral: requestA, response: (_, axon) => axon.doneA.createSignal(...) });
// controller emits requestA; serviceA emits doneA
```

### `neuron.dendrite({...})`
Add a dendrite bound to a collateral.

```ts
myNeuron.dendrite({
  collateral: inputCollateral,
  response: async (payload, axon, ctx) => {
    if (ctx.abortSignal?.aborted) return;
    return axon.output.createSignal(result);
  }
});
```

### `neuron.bind(axon, map)`
Exhaustive bind to every collateral of another neuron's axon (compile-time safety).

```ts
withCtx().neuron('order-mailer', {})
  .bind(order, {
    created: (payload) => { /* ... */ },
    updated: (payload) => { /* ... */ },
    cancelled: (payload) => { /* ... */ },
  });
```

### `CNS`
Main orchestrator. `new CNS(neurons, options?)`

```ts
const unsubscribe = cns.addResponseListener(r => { /* ... */ });
```

### `cns.stimulate(signal, options?)`
Run a stimulation.

```ts
await cns.stimulate(userCreated.createSignal({ id: '123', name: 'John' }));
```
