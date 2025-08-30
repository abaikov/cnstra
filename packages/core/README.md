# @cnstra/core

**Graph-routed, type-safe orchestration for reactive apps — no global event bus.**

## 🧠 What is CNStra?

**CNStra (Central Nervous System Orchestrator)** models your app as a **typed neuron graph**.  
You explicitly start a run with `cns.stimulate(...)`; CNStra then performs a **deterministic, hop-bounded traversal** from **collateral → dendrite → returned signal**, step by step.

> **Not pub/sub:** there are no ambient listeners or global `emit`. Only the **signal you return** from a dendrite continues the traversal; returning `null`/`undefined` ends that branch. `maxHops` guards against cycles.

## 🏗️ Core Model

### Neurons
Units of logic with clear DI and sharp boundaries:
- **ID** — unique name
- **Axon** — the neuron’s **output channels** (its collaterals)
- **Dendrites** — **input receptors** (typed reactions bound to specific collaterals)

### Collaterals
Typed **output channels** that mint signals:
- **ID** — string identifier (e.g., `'user:created'`)
- **Payload** — the shape carried by the signal
- `createSignal(payload)` → `{ type, payload }`

> **Afferent axon:** the object of collaterals you expose publicly. Its **keys** (e.g., `userCreated`) are what you pass to `cns.stimulate(...)`, not the string IDs.

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
await cns.stimulate(userCreated, {
  id: '123',
  name: 'John Doe'
});
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

```typescript
myNeuron
  .dendrite({
    collateral: inputCollateral,
    response: async (payload, axon, ctx) => {
      // Process input and return output signal
      // ctx parameter provides local context storage for this neuron
      return axon.output.createSignal(result);
    }
  });
```

### `CNS` Class

The main orchestrator that manages signal flow between neurons.

#### Constructor
```typescript
new CNS(neurons)
```

**Parameters:**
- `neurons`: Array of neurons that process signals

#### `stimulate()` Method
```typescript
await cns.stimulate(collateral, payload, options?)
```

**Parameters:**
- `collateral`: The collateral instance to trigger
- `payload`: Signal payload data
- `options`: Optional configuration object

**Options:**
- `maxHops`: Maximum number of signal hops (default: 1000)
- `onTrace`: Callback for tracing signal flow with context for recovery
- `abortSignal`: AbortController signal for cancellation
- `ctx`: Pre-existing context store to restore state
- `createContext`: Factory method to create custom context stores
- `concurrency`: Maximum concurrent operations (default: unlimited)

## 🔄 Key Behavior

### Only Returned Signals Are Processed
**Important**: In CNS, only the signal returned from the `reaction` function is processed and propagated to other neurons. Signals created with `axon.collateral.createSignal()` but not returned are NOT processed by the system.

```typescript
const processor = neuron('processor', {
  output: outputCollateral
})
.dendrite({
  collateral: inputCollateral,
  response: async (payload, axon) => {
    // This signal is created but NOT processed
    axon.output.createSignal({ message: 'Hello' });
    
    // Only this returned signal is processed
    return axon.output.createSignal({ message: 'World' });
  }
});
```

### Multiple Neurons on Same Collateral
Multiple neurons can listen to the same collateral:

```typescript
const emailService = neuron('email-service', { emailSent })
  .dendrite({
    collateral: userCreated,
    response: (payload, axon) => {
      return axon.emailSent.createSignal({ to: 'user@example.com' });
    }
  });

const notificationService = neuron('notification-service', { notificationSent })
  .dendrite({
    collateral: userCreated,
    response: (payload, axon) => {
      return axon.notificationSent.createSignal({ message: 'User created' });
    }
  });

// Both neurons will process the userCreated signal
const cns = new CNS([emailService, notificationService]);
```

### Conditional Logic
```typescript
const router = neuron('router', {
  success: successCollateral,
  error: errorCollateral
})
.dendrite({
  collateral: requestCollateral,
  response: async (payload, axon) => {
    try {
      const result = await processRequest(payload);
      return axon.success.createSignal(result);
    } catch (error) {
      return axon.error.createSignal({ error: error.message });
    }
  }
});
```

### Context Management

Neurons can maintain local state using the context parameter:

```typescript
const statefulNeuron = withCtx().neuron('stateful', { output: outputCollateral })
  .dendrite({
    collateral: inputCollateral,
    response: (payload, axon, ctx) => {
      // Get current state
      const currentState = ctx.get();
      
      // Update state
      ctx.set({ count: (currentState?.count || 0) + 1 });
      
      return axon.output.createSignal({ count: ctx.get()?.count });
    }
  });
```

### State Recovery and Restart

CNS provides built-in support for recovering from failures and restarting operations. The `onTrace` callback includes the current context state, allowing you to:

1. **Capture context on failure**: When an error occurs, the last trace contains the complete context state
2. **Restart with saved context**: Use the saved context to restore the system state
3. **Resume from failure point**: Continue processing from where it left off

```typescript
// Example: Recovery after failure
let lastContext: ICNSStimulationContextStore | undefined;

const cns = new CNS([myNeuron]);

cns.stimulate(input, payload, {
  onTrace: (trace) => {
    // Always capture the latest context
    lastContext = trace.context;
    
    if (trace.error) {
      console.log('Error occurred, context saved for recovery');
      // Save context to persistent storage
      saveContextToStorage(trace.context);
    }
  }
});

// Later: Restart with saved context
const savedContext = loadContextFromStorage();
if (savedContext) {
  cns.stimulate(failedCollateral, payload, {
    ctx: savedContext, // Restore previous state
    onTrace: (trace) => {
      // Continue monitoring
    }
  });
}
```

**Context Store Factory**: You can also provide a custom context factory:

```typescript
cns.stimulate(input, payload, {
  createContext: () => new CustomContextStore(),
  onTrace: (trace) => {
    // trace.context is your custom context store
  }
});
```

## 🧪 Testing

```bash
npm test
npm run test:types
```

## 📦 Build

```bash
npm run build
```

## 🚀 Examples

Run the examples to see CNS in action:

```bash
npm run examples
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT
