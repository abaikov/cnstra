# @cnstra/core

**Graph-routed, type-safe orchestration for reactive apps — no global event bus.**

📚 **[Full Documentation](https://cnstra.org/)** | [Quick Start](https://cnstra.org/docs/core/quick-start) | [API Reference](https://cnstra.org/docs/core/api) | [Recipes](https://cnstra.org/docs/recipes/cancel)

## 🧠 What is CNStra?

**CNStra (Central Nervous System Orchestrator)** models your app as a **typed neuron graph**.  
You explicitly start a run with `cns.stimulate(...)`; CNStra then performs a **deterministic, hop-bounded traversal** from **collateral → dendrite → returned signal**, step by step.

> **Zero dependencies:** CNS has no third-party dependencies, making it suitable for any JavaScript/TypeScript environment - browsers, Node.js, serverless, edge functions, React Native, or embedded systems.

**No pub/sub:** there are no ambient listeners or global `emit`. Only the **signal you return** from a dendrite continues the traversal; returning `null`/`undefined` ends that branch. Hop limits guard against cycles.

We follow the **IERG approach — Inverted Explicit Reactive Graph**. You explicitly stimulate the graph; reactions are local and deterministic; no background listeners or buses exist.

## 💡 Why CNStra

IERG is our inverted control flow: you start the run, we walk the reaction graph explicitly. This is not Flux and not an event bus.

- **Deterministic routing**: signals are delivered along an explicit neuron graph, not broadcast to whoever “happens to listen”.
- **Readable, reliable flows**: each step is local and typed; branches are explicit, so debugging feels like reading a storyboard, not a log stream.
- **Backpressure & concurrency**: built‑in per‑stimulation and per‑neuron concurrency limits keep workloads controlled without custom plumbing.
- **Saga‑grade orchestration**: IERG already models long‑running, multi‑step reactions with retries/cancellation hooks (abort), so you rarely need to hand‑roll “sagas”.
- **Safer than ad‑hoc events**: no hidden global listeners, no accidental fan‑out; every continuation must be returned explicitly.

## 🏗️ Core Model

### Neurons
Units of logic with clear DI and sharp boundaries:
- **ID** — unique name
- **Axon** — the neuron's **output channels** (its collaterals)  
- **Dendrites** — **input receptors** (typed reactions bound to specific collaterals)

### Collaterals
Typed **output channels** that mint signals:
- **ID** — string identifier (e.g., `'user:created'`)
- **Payload** — the shape carried by the signal
- `createSignal(payload)` → `{ collateral, payload }`

### Signals
The data structures that flow through the system:
- **collateral** — reference to the collateral that created this signal
- **payload** — the typed data being transmitted

## 🚀 Quick Start

```bash
npm install @cnstra/core
```

```typescript
import { CNS, collateral, neuron } from '@cnstra/core';

// Define collaterals (communication channels)
const userCreated = collateral<{ id: string; name: string }>('user:created');
const userRegistered = collateral<{ userId: string; status: string }>('user:registered');

// Create a neuron
const userService = neuron('user-service', {
  userRegistered
})
.dendrite({
  collateral: userCreated,
  response: (payload, axon) => {
    const userData = payload;
    
    // Process the user creation
    console.log(`Processing user: ${userData.name}`);
    
    // Return the signal that will be processed by CNS
    return axon.userRegistered.createSignal({
      userId: userData.id,
      status: 'completed'
    });
  }
});

// Create the CNS system
const cns = new CNS([userService]);

// Stimulate the system
const stimulation = cns.stimulate(userCreated.createSignal({
  id: '123',
  name: 'John Doe'
}));
await stimulation.waitUntilComplete();
```

## 📚 API Reference

### `collateral<T>(id: string)`

Creates a new collateral (communication channel).

```typescript
const userEvent = collateral<{ userId: string }>('user:event');
const simpleEvent = collateral('simple:event'); // No payload type
```

### `neuron(id: string, axon: Axon)`

Creates a new neuron with the specified axon (output channels).

```typescript
const myNeuron = neuron('my-neuron', {
  output: myCollateral
});
```

### `neuron.dendrite(dendrite: Dendrite)`

Adds a dendrite (input receptor) to a neuron. Returns the neuron for chaining.

The `response` function can return:
- A single signal: `axon.output.createSignal(data)`
- An array of signals: `[axon.output1.createSignal(data1), axon.output2.createSignal(data2)]`
- A Promise of either
- `undefined`/`void` to end processing

```typescript
myNeuron
  .dendrite({
    collateral: inputCollateral,
    response: async (payload, axon, ctx) => {
      // ctx: { get, set, abortSignal?, cns? }
      if (ctx.abortSignal?.aborted) return; // graceful cancel
      const prev = ctx.get();
      ctx.set({ ...prev, handled: true });
      
      // Return single signal or array of signals
      return axon.output.createSignal(result);
    }
  });
```

### `neuron.bind(axon, map)` — exhaustive subscriptions (with shorthand)

Bind this neuron to every collateral of another neuron's axon in one place. The `map` must be exhaustive: you must provide a handler for each collateral key of `axon`. This gives you compile-time safety: if someone adds a new collateral later, TypeScript will immediately flag missing handlers.

- You can pass either a full dendrite object per key or just a response function shorthand.
- Payload types are inferred from the followed axon.

This pattern is especially useful for domain-oriented neurons that must react to every way a record can be created/changed. For example, an email-notifier neuron can safely ensure emails are sent for every creation path; if a new creation collateral is introduced, the build will fail until the notifier adds a corresponding handler.

```typescript
import { withCtx, collateral } from '@cnstra/core';

// Order domain model (axon)
const order = {
  created: collateral<{ id: string; amount: number }>('order:created'),
  updated: collateral<{ id: string; changes: Record<string, unknown> }>('order:updated'),
  cancelled: collateral<{ id: string; reason?: string }>('order:cancelled'),
};

// Mailer neuron must react to ALL order events
withCtx()
  .neuron('order-mailer', { /* your axon if you emit follow-up signals */ })
  .bind(order, {
    created: (payload) => {
      sendEmail(`Order created #${payload.id} for $${payload.amount}`);
      return undefined;
    },
    updated: (payload) => {
      sendEmail(`Order updated #${payload.id} (changes: ${Object.keys(payload.changes).join(', ')})`);
      return undefined;
    },
    cancelled: (payload) => {
      sendEmail(`Order cancelled #${payload.id}${payload.reason ? `: ${payload.reason}` : ''}`);
      return undefined;
    },
  });

// If later someone adds a new event variant, e.g. refunds:
// const order = { ...order, refunded: collateral<{ id: string; amount: number }>('order:refunded') };
// TypeScript will now error until you also add a `refunded` handler in the .bind(...) map.
```

### `CNS` Class

The main orchestrator that manages signal flow between neurons.

#### Constructor
```typescript
new CNS(neurons, options?)
```

**Parameters:**
- `neurons`: Array of neurons that process signals
- `options`: Optional CNS configuration

#### Global listeners
```typescript
const unsubscribe = cns.addResponseListener(r => {
  // fires for every stimulation (input + outputs)
});
// unsubscribe();
```

#### `stimulate()` Method
```typescript
cns.stimulate(signal | signal[], options?)
```

**Parameters:**
- `signal`: A signal or array of signals created by `collateral.createSignal(payload)`
- `options`: Optional stimulation configuration

**Returns:** `CNSStimulation` instance. Use `stimulation.waitUntilComplete()` to await completion.

**Example:**
```typescript
// Single signal
const stimulation = cns.stimulate(
  userCreated.createSignal({ id: '123', name: 'John' })
);
await stimulation.waitUntilComplete();

// Multiple signals at once
const stimulation = cns.stimulate([
  userCreated.createSignal({ id: '123', name: 'John' }),
  userCreated.createSignal({ id: '456', name: 'Jane' })
]);
await stimulation.waitUntilComplete();
```

## ⚙️ Stimulation Options

### `maxNeuronHops?: number` (default: 1000)
Prevents infinite loops by limiting signal traversal depth.

```typescript
const stimulation = cns.stimulate(signal, {
  maxNeuronHops: 50 // Stop after 50 neuron hops
});
await stimulation.waitUntilComplete();
```

### `onResponse?: (response) => void`
Real-time callback for monitoring signal flow and completion.

```typescript
const stimulation = cns.stimulate(signal, {
  onResponse: (response) => {
    console.log(`Signal: ${response.outputSignal?.collateral.id}`);
    console.log(`Hops: ${response.hops}`);
    
    if (response.error) {
      console.error('Processing failed:', response.error);
    }
    
    if (response.queueLength === 0) {
      console.log('Stimulation completed');
    }
  }
});
await stimulation.waitUntilComplete();
```

**Response Object:**
- `inputSignal` — The input signal being ingested (if any)
- `outputSignal` — The output signal being processed (if any)
- `contextValue` — The context value for this stimulation
- `queueLength` — Remaining signals in processing queue (0 = complete)
- `stimulation` — Reference to the CNSStimulation instance
- `error` — Any error that occurred during processing
- `hops` — Number of neuron hops taken so far (only present if maxNeuronHops is set)
- `stimulationId` — Unique identifier for this stimulation

### `abortSignal?: AbortSignal`
Gracefully stop stimulation using AbortController.

```typescript
const controller = new AbortController();

const stimulation = cns.stimulate(signal, {
  abortSignal: controller.signal
});

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);
await stimulation.waitUntilComplete();
```
Inside dendrites, read it via `ctx.abortSignal`.

### `stimulationId?: string`
Custom identifier for this stimulation cascade. Auto-generated if not provided.

```typescript
const stimulation = cns.stimulate(signal, {
  stimulationId: 'user-action-' + Date.now()
});
await stimulation.waitUntilComplete();
```

### `allowName?: (collateralName: string) => boolean`
Filter which collateral names can be processed.

```typescript
const stimulation = cns.stimulate(signal, {
  allowName: (name) => name.startsWith('user:') // Only process user-related signals
});
await stimulation.waitUntilComplete();
```

### `concurrency?: number` (default: unlimited)
Limit concurrent operations to prevent resource exhaustion.

```typescript
const stimulation = cns.stimulate(signal, {
  concurrency: 10 // Max 10 operations at once
});
await stimulation.waitUntilComplete();
```

#### Per‑neuron global concurrency
Set a limit per neuron; parallel stimulations share the same gate.
```typescript
const worker = neuron('worker', { out })
  .setConcurrency(2)
  .dendrite({ /* ... */ });
```

### `ctx?: ICNSStimulationContextStore`
Provide existing context store for recovery/retry scenarios.

```typescript
const stimulation = cns.stimulate(signal, {
  ctx: savedContextStore // Restore previous state
});
await stimulation.waitUntilComplete();
```

### `createContextStore?: () => ICNSStimulationContextStore`
Factory for custom context store implementations.

```typescript
const stimulation = cns.stimulate(signal, {
  createContextStore: () => new CustomContextStore()
});
await stimulation.waitUntilComplete();
```

## 🔄 Signal Flow Patterns

### Basic Chain Processing

```typescript
const input = collateral<{ value: number }>('input');
const middle = collateral<{ doubled: number }>('middle');
const output = collateral<{ result: string }>('output');

const step1 = neuron('step1', { middle }).dendrite({
  collateral: input,
  response: (payload, axon) => {
    return axon.middle.createSignal({ doubled: payload.value * 2 });
  }
});

const step2 = neuron('step2', { output }).dendrite({
  collateral: middle,
  response: (payload, axon) => {
    return axon.output.createSignal({ result: `Final: ${payload.doubled}` });
  }
});

const cns = new CNS([step1, step2]);

const stimulation = cns.stimulate(input.createSignal({ value: 5 }));
await stimulation.waitUntilComplete();
// Flows: input(5) → middle(10) → output("Final: 10")
```

### Context-Aware Processing

```typescript
import { withCtx } from '@cnstra/core';

const input = collateral<{ increment: number }>('input');
const output = collateral<{ count: number }>('output');

const counter = withCtx<{ total: number }>()
  .neuron('counter', { output })
  .dendrite({
    collateral: input,
    response: async (payload, axon, ctx) => {
      const current = ctx.get()?.total || 0;
      const newTotal = current + payload.increment;
      
      ctx.set({ total: newTotal });
      
      return axon.output.createSignal({ count: newTotal });
    }
  });

const cns = new CNS([counter]);

const stimulation1 = cns.stimulate(input.createSignal({ increment: 5 }));
await stimulation1.waitUntilComplete(); // count: 5
const stimulation2 = cns.stimulate(input.createSignal({ increment: 3 }));
await stimulation2.waitUntilComplete(); // count: 8 (separate context)
```

### Multiple Signals (Fan-out Pattern)

Neurons can return arrays of signals for parallel processing:

```typescript
const orderPlaced = collateral<{ orderId: string; items: string[] }>('order:placed');
const updateInventory = collateral<{ orderId: string; item: string }>('update:inventory');
const sendEmail = collateral<{ orderId: string }>('send:email');
const logAudit = collateral<{ orderId: string }>('log:audit');

const orderProcessor = neuron('order-processor', { 
  updateInventory, 
  sendEmail, 
  logAudit 
}).dendrite({
  collateral: orderPlaced,
  response: (payload, axon) => {
    // Return array of signals - each will be processed independently
    return [
      // Create signal for each item
      ...payload.items.map(item => 
        axon.updateInventory.createSignal({ orderId: payload.orderId, item })
      ),
      // Also send confirmation email
      axon.sendEmail.createSignal({ orderId: payload.orderId }),
      // And log the action
      axon.logAudit.createSignal({ orderId: payload.orderId })
    ];
  }
});

// Downstream neurons process each signal independently
const inventoryService = neuron('inventory-service', {}).dendrite({
  collateral: updateInventory,
  response: (payload) => {
    console.log(`Updating inventory for ${payload.item}`);
    // Each item gets its own execution
  }
});

const cns = new CNS([orderProcessor, inventoryService /* ... */]);

// Single order triggers multiple parallel operations
const stimulation = cns.stimulate(
  orderPlaced.createSignal({ orderId: 'ORD-001', items: ['A', 'B', 'C'] })
);
await stimulation.waitUntilComplete();
// Flows: orderPlaced → [inventory(A), inventory(B), inventory(C), email, audit]
```

**Conditional Arrays:**
```typescript
const validator = neuron('validator', { success, error, audit }).dendrite({
  collateral: input,
  response: (payload, axon) => {
    const signals = [];
    
    // Conditionally add signals
    if (isValid(payload.data)) {
      signals.push(axon.success.createSignal({ validated: payload.data }));
    } else {
      signals.push(axon.error.createSignal({ error: 'Invalid' }));
    }
    
    // Always audit
    signals.push(axon.audit.createSignal({ attempted: true }));
    
    return signals; // Return empty array to emit nothing
  }
});
```

**Starting with Multiple Signals:**
```typescript
// Process multiple orders in parallel
const stimulation = cns.stimulate([
  orderPlaced.createSignal({ orderId: 'ORD-001', items: ['X'] }),
  orderPlaced.createSignal({ orderId: 'ORD-002', items: ['Y', 'Z'] })
]);
await stimulation.waitUntilComplete();
```

See [Multiple Signals Recipe](https://cnstra.org/docs/recipes/multiple-signals) for more patterns and best practices.

## 🧠 Memory & Performance

### Memory-Efficient Design
- **Zero dependencies**: No third-party packages
- **No error storage**: Errors delivered via callbacks, not stored
- **Streaming responses**: Signal traces delivered via callbacks
- **Context on-demand**: Context stores created only when needed
- **No global state**: Clean slate between stimulations

### Performance Characteristics
- **Sync-first**: Synchronous chains execute in single tick
- **Minimal async overhead**: Promises created only when needed
- **Stack-safe**: Handles deep chains without stack overflow
- **Bounded execution**: `maxNeuronHops` prevents runaway processing

### Best Practices
- Keep context data minimal (IDs, counters, flags)
- Use synchronous responses when possible
- Set reasonable `maxNeuronHops` limits
- Implement proper error handling in `onResponse`
- Use array returns for genuine fan-out patterns, not just convenience
- Consider concurrency limits when returning many signals

## 🎯 Common Use Cases

### HTTP Request Processing
```typescript
const httpRequest = collateral<{ method: string; url: string }>('http:request');
const requestValidated = collateral<{ method: string; url: string }>('request:validated');
const responseReady = collateral<{ status: number; body: any }>('response:ready');

const validator = neuron('validator', { requestValidated }).dendrite({
  collateral: httpRequest,
  response: (payload, axon) => {
    if (!payload.url.startsWith('https://')) {
      throw new Error('Only HTTPS URLs allowed');
    }
    return axon.requestValidated.createSignal(payload);
  }
});

const handler = neuron('handler', { responseReady }).dendrite({
  collateral: requestValidated,
  response: async (payload, axon) => {
    const response = await fetch(payload.url, { method: payload.method });
    const body = await response.json();
    return axon.responseReady.createSignal({ status: response.status, body });
  }
});

const cns = new CNS([validator, handler]);
```

### Event Sourcing
```typescript
const eventReceived = collateral<{ name: string; data: any }>('event:received');
const eventStored = collateral<{ eventId: string }>('event:stored');
const stateUpdated = collateral<{ aggregateId: string }>('state:updated');

const eventStore = neuron('event-store', { eventStored }).dendrite({
  collateral: eventReceived,
  response: async (payload, axon) => {
    const eventId = await saveEvent(payload);
    return axon.eventStored.createSignal({ eventId });
  }
});

const stateManager = neuron('state-manager', { stateUpdated }).dendrite({
  collateral: eventStored,
  response: async (payload, axon) => {
    const aggregateId = await updateState(payload.eventId);
    return axon.stateUpdated.createSignal({ aggregateId });
  }
});

const cns = new CNS([eventStore, stateManager]);
```

## 🚨 Error Handling

Errors are delivered immediately via `onResponse` callbacks:

```typescript
const stimulation = cns.stimulate(signal, {
  onResponse: (response) => {
    if (response.error) {
      console.error(`Error in neuron processing:`, response.error);
      
      // Log error details
      console.error(`Signal: ${response.outputSignal?.collateral.id}`);
      console.error(`Stimulation: ${response.stimulationId}`);
      
      // Handle specific error types
      if (response.error instanceof ValidationError) {
        handleValidationError(response.error);
      }
    }
  }
});
await stimulation.waitUntilComplete();
```

**Error Recovery with Context:**
```typescript
let savedContext: ICNSStimulationContextStore | undefined;

const stimulation = cns.stimulate(signal, {
  onResponse: (response) => {
    if (response.error) {
      // Save context for retry
      savedContext = response.stimulation.getContext();
    }
  }
});
await stimulation.waitUntilComplete();

// Retry with preserved context
if (savedContext) {
  const retryStimulation = cns.stimulate(retrySignal, {
    ctx: savedContext
  });
  await retryStimulation.waitUntilComplete();
}
```

## 🔧 Advanced Configuration

### Custom Context Store
```typescript
class RedisContextStore implements ICNSStimulationContextStore {
  constructor(private client: RedisClient, private sessionId: string) {}
  
  get<T>(): T | undefined {
    // Implement Redis-backed context retrieval
  }
  
  set<T>(value: T): void {
    // Implement Redis-backed context storage
  }
}

const stimulation = cns.stimulate(signal, {
  createContextStore: () => new RedisContextStore(redisClient, 'session-123')
});
await stimulation.waitUntilComplete();
```

### CNS Configuration
```typescript
const cns = new CNS(neurons, {
  autoCleanupContexts: true, // Auto-cleanup unused contexts
  defaultConcurrency: 50     // Default concurrency limit
});
```

⚠️ **Performance Warning**: `autoCleanupContexts` adds computational overhead due to:
- **O(V²) initialization cost** - building SCC (Strongly Connected Components) structures
- **O(1 + A) runtime cost** per cleanup check (where A = number of SCC ancestors)
- **Memory overhead** for storing SCC graphs and ancestor relationships

**Use only when:**
- Memory leaks are a critical issue
- You have a small to medium-sized neuron graph (< 1000 neurons)
- Performance is less critical than memory management

**For production systems**, consider manual context cleanup or custom cleanup strategies instead.

---

*CNStra provides deterministic, type-safe orchestration without the complexity of traditional event systems. Build reliable, maintainable reactive applications with clear data flow and predictable behavior.*
