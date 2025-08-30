# @cnstra/core

**Graph-routed, type-safe orchestration for reactive apps — no global event bus.**

## 🧠 What is CNStra?

**CNStra (Central Nervous System Orchestrator)** models your app as a **typed neuron graph**.  
You explicitly start a run with `cns.stimulate(...)`; CNStra then performs a **deterministic, hop-bounded traversal** from **collateral → dendrite → returned signal**, step by step.

> **Zero dependencies:** CNS has no third-party dependencies, making it suitable for any JavaScript/TypeScript environment - browsers, Node.js, serverless, edge functions, React Native, or embedded systems.

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
cns.stimulate(collateral, payload, options?)
```

**Parameters:**
- `collateral`: The collateral instance to trigger
- `payload`: Signal payload data
- `options`: Optional configuration object

**Options:**

##### `maxHops?: number` (default: 1000)
Prevents infinite loops by limiting signal traversal depth. Each signal hop increments the counter.
```typescript
// Prevent runaway recursion
cns.stimulate(input, data, {
  maxHops: 50 // Stop after 50 signal hops
});
```
⚠️ **Memory Impact**: Higher values allow deeper graphs but increase memory usage.

##### `onTrace?: (trace) => void`
Real-time callback for monitoring signal flow, errors, and completion. Essential for fire-and-forget pattern.
```typescript
cns.stimulate(input, data, {
  onTrace: (trace) => {
    console.log(`Signal: ${trace.collateralId}, Hops: ${trace.hops}`);
    
    if (trace.error) {
      console.error('Processing failed:', trace.error);
    }
    
    if (trace.queueLength === 0) {
      console.log('Stimulation completed');
    }
  }
});
```

##### `abortSignal?: AbortSignal`
Gracefully stop stimulation using AbortController. Already-running operations complete, but no new work starts.
```typescript
const controller = new AbortController();

cns.stimulate(input, data, {
  abortSignal: controller.signal
});

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);
```

##### `ctx?: ICNSStimulationContextStore`
Provide existing context store for recovery/retry scenarios. Restores neuron state from previous stimulation.
```typescript
// Retry with preserved context
cns.stimulate(failedCollateral, payload, {
  ctx: savedContextStore, // Restore previous state
  onTrace: (trace) => { /* monitor retry */ }
});
```

##### `createContextStore?: () => ICNSStimulationContextStore`
Factory for custom context store implementations. Useful for persistence, encryption, or specialized storage.
```typescript
cns.stimulate(input, data, {
  createContextStore: () => new RedisContextStore('session-123'),
  onTrace: (trace) => {
    // trace.contextStore is your custom RedisContextStore
  }
});
```

##### `spikeId?: string`
Custom identifier for this stimulation cascade. Auto-generated if not provided. Useful for debugging and correlation.
```typescript
cns.stimulate(input, data, {
  spikeId: 'user-action-' + Date.now(),
  onTrace: (trace) => {
    console.log('Spike ID:', trace.spikeId);
  }
});
```

##### `allowType?: (collateralId: string) => boolean`
Filter which collateral types can be processed. Useful for selective stimulation or debugging specific paths.
```typescript
cns.stimulate(input, data, {
  allowType: (type) => type.startsWith('user:'), // Only process user-related signals
  onTrace: (trace) => {
    // Only user: collaterals will appear in traces
  }
});
```

##### `concurrency?: number` (default: unlimited)
Limit concurrent operations to prevent resource exhaustion. Both sync and async operations count toward this limit.
```typescript
cns.stimulate(input, data, {
  concurrency: 10, // Max 10 operations at once
  onTrace: (trace) => {
    // Processing respects concurrency limit
  }
});
```

**Why These Options Matter:**
- **Control**: Fine-tune behavior for your specific use case
- **Performance**: Manage memory and concurrency based on system constraints  
- **Reliability**: Implement timeouts, retries, and error recovery
- **Debugging**: Filter signals, add correlation IDs, and monitor execution
- **Integration**: Work with existing systems via custom context stores

## 🧠 Memory Policy & Error Handling

### Memory-First Design
CNS is designed with strict memory efficiency and universal compatibility in mind:

- **Zero dependencies**: No third-party packages - runs in any JavaScript/TypeScript environment
- **No error storage**: Errors are immediately passed to your `onTrace` callback and not stored in memory
- **Streaming traces**: Signal traces are delivered via callbacks, not accumulated in arrays
- **Context on-demand**: Context stores are created only when needed and passed via traces
- **No global state**: The system maintains no persistent state between stimulations
- **Context scope**: Context stores exist only for the duration of a single stimulation - they are automatically cleaned up when stimulation completes
- **Context content warning**: ⚠️ Context values dictionary is kept in memory during stimulation - store minimal data only (IDs, counters, flags) rather than large objects or payloads
- **Context mutation**: CNS modifies context dictionaries in-place - create new context objects if you need versioning or rollback capabilities

### maxHops Memory Impact
⚠️ **Warning**: Using `maxHops` parameter increases memory consumption proportionally:
- Default hop limit: 1000
- Higher `maxHops` = more potential concurrent signals = more memory usage
- For infinite recursion scenarios, keep `maxHops` reasonable (100-1000 range)

### Error Handling Philosophy
CNS handles errors through immediate callback delivery rather than storage because:
1. **Memory efficiency**: No error accumulation in library memory
2. **Real-time feedback**: Immediate error notification to your application
3. **Recovery control**: You decide how to handle and store errors
4. **Context preservation**: Error traces include full context for recovery scenarios

```typescript
// Error handling example
cns.stimulate(input, payload, {
  onTrace: (trace) => {
    if (trace.error) {
      // Handle immediately - error won't be stored by CNS
      logError(trace.error);
      saveErrorContext(trace.contextStore);
    }
  }
});

// ✅ Good: Minimal context data
const goodContext = { 
  retryCount: 3, 
  userId: "123", 
  lastAttempt: Date.now() 
};

// ❌ Bad: Large objects in context
const badContext = { 
  fullUserProfile: largeUserObject,
  historicalData: massiveArray,
  fileBuffer: binaryData
};
```

## 🔄 Key Behavior

### Sync-First Processing with Async Support
CNS processes signals synchronously by default, avoiding microtask scheduling until absolutely necessary. This provides predictable, immediate execution for synchronous operations while seamlessly handling async when needed.

**Synchronous Path** - No async/await overhead:
```typescript
const syncNeuron = neuron('sync-processor', { output })
  .dendrite({
    collateral: input,
    response: (payload, axon) => {
      // Pure synchronous processing - runs immediately
      // No Promise creation, no microtask scheduling
      const result = processSync(payload);
      return axon.output.createSignal({ result });
    }
  });

// Chain of sync neurons executes immediately in single tick
const chainStart = collateral<{ value: number }>('start');
const chainMiddle = collateral<{ doubled: number }>('middle');  
const chainEnd = collateral<{ final: string }>('end');

const step1 = neuron('step1', { chainMiddle })
  .dendrite({
    collateral: chainStart,
    response: (payload, axon) => {
      return axon.chainMiddle.createSignal({ doubled: payload.value * 2 });
    }
  });

const step2 = neuron('step2', { chainEnd })
  .dendrite({
    collateral: chainMiddle,
    response: (payload, axon) => {
      return axon.chainEnd.createSignal({ final: `Result: ${payload.doubled}` });
    }
  });

// This entire chain executes synchronously in one tick
cns.stimulate(chainStart, { value: 5 });
```

**Mixed Sync/Async** - Async only where needed:
```typescript
const mixedNeuron = neuron('mixed-processor', { output })
  .dendrite({
    collateral: input,
    response: async (payload, axon) => {
      // Synchronous preprocessing - runs immediately
      const validated = validateInput(payload);
      const transformed = transformData(validated);
      
      // Only here do we enter async context
      const result = await fetchFromAPI(transformed);
      
      // Synchronous postprocessing
      const formatted = formatResult(result);
      return axon.output.createSignal({ formatted });
    }
  });
```

**Key Performance Benefits:**
- **Sync chains execute in single tick**: No microtask delays between neurons
- **Minimal Promise overhead**: Async context created only when needed
- **Predictable execution**: Sync operations complete before any async work starts
- **No unnecessary await**: Sync neurons don't use async/await syntax

### Isolated Stimulation Scope
Each `cns.stimulate()` call creates an isolated signal cascade. You never need to worry about "messageId" or signal correlation - all signals in your trace belong exclusively to your stimulation.

#### Complex Orchestration Example: Card & Deck Creation

```typescript
// Define collaterals for the orchestration
const httpRequest = collateral<{ cardText: string }>('http:request');
const requestProcessed = collateral<{ cardText: string }>('request:processed');
const deckCreated = collateral<{ deckId: string; cardText: string }>('deck:created');
const cardCreated = collateral<{ cardId: string; deckId: string }>('card:created');

// Controller neuron: orchestrates the entire process
const controllerNeuron = withCtx<{
  cardText?: string;
  deckId?: string;
  cardId?: string;
}>().neuron('controller', { requestProcessed, cardCreated })
  .dendrite({
    collateral: httpRequest,
    response: async (payload, axon, ctx) => {
      // Step 1: Store card text in context and signal processing started
      ctx.set({ cardText: payload.cardText });
      return axon.requestProcessed.createSignal({ cardText: payload.cardText });
    }
  })
  .dendrite({
    collateral: deckCreated,
    response: async (payload, axon, ctx) => {
      // Step 3: Deck created, now create the card
      const context = ctx.get()!;
      ctx.set({ ...context, deckId: payload.deckId });
      return axon.cardCreated.createSignal({
        deckId: payload.deckId,
        cardText: context.cardText!
      });
    }
  });

// Deck service: creates deck when request is processed
const deckNeuron = neuron('deck-service', { deckCreated })
  .dendrite({
    collateral: requestProcessed,
    response: async (payload, axon) => {
      // Step 2: Create deck (async operation)
      const deckId = await createDeck();
      return axon.deckCreated.createSignal({
        deckId,
        cardText: payload.cardText
      });
    }
  });

// Card service: creates card when deck is ready
const cardNeuron = neuron('card-service', { cardCreated })
  .dendrite({
    collateral: cardCreated,
    response: async (payload, axon) => {
      // Step 4: Create card (async operation)  
      const cardId = await createCard(payload.deckId, payload.cardText);
      return axon.cardCreated.createSignal({
        cardId,
        deckId: payload.deckId
      });
    }
  });

// HTTP handler using CNS orchestration
app.post('/create-card', async (req, res) => {
  const cns = new CNS([controllerNeuron, deckNeuron, cardNeuron]);
  
  let deckId: string | undefined;
  let cardId: string | undefined;
  
  cns.stimulate(httpRequest, { cardText: req.body.text }, {
    onTrace: (trace) => {
      // Collect results as they become available
      if (trace.collateralId === 'deck:created') {
        deckId = (trace.payload as any).deckId;
      }
      if (trace.collateralId === 'card:created') {
        cardId = (trace.payload as any).cardId;
      }
      
      // Process complete when queue is empty
      if (trace.queueLength === 0) {
        res.json({ deckId, cardId, success: true });
      }
    }
  });
});
```

**Key Benefits of Isolated Stimulation:**

1. **No Signal Pollution**: Every signal in your trace belongs to your request - no cross-contamination
2. **No Correlation IDs**: No need to track "messageId" or "requestId" through the system
3. **Guaranteed Ordering**: Signals process in deterministic order within your stimulation
4. **Clean Scoping**: Each HTTP request gets its own isolated signal cascade
5. **Context Safety**: Context store is private to your stimulation - no shared state issues

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

### Context-Based Retry Mechanisms

CNS supports robust retry mechanisms using context stores to maintain state across stimulation attempts. This is particularly useful for handling transient failures:

#### Stateful Retry Pattern
```typescript
type RetryContext = {
  tryNumber: number;
};

const retryableNeuron = withCtx<RetryContext>().neuron('retryable', { output })
  .dendrite({
    collateral: input,
    response: async (payload, axon, ctx) => {
      const current = ctx.get() || { tryNumber: 0 };
      const tryNumber = current.tryNumber + 1;
      
      // Update context with incremented try number
      ctx.set({ tryNumber });

      if (tryNumber === 1) {
        // First attempt: simulate failure
        throw new Error('Transient failure');
      } else {
        // Second attempt: succeed
        return axon.output.createSignal({
          result: `Success on try ${tryNumber}`,
          payload
        });
      }
    }
  });
```

#### Retry Orchestration
```typescript
let contextStore: ICNSStimulationContextStore | undefined;

const handleStimulation = (isRetry = false) => {
  cns.stimulate(input, payload, {
    ctx: contextStore, // Use preserved context for retries
    onTrace: (trace) => {
      // Detect stimulation end
      if (trace.queueLength === 0) {
        if (trace.error && !isRetry) {
          // Capture context and retry
          contextStore = trace.contextStore;
          setTimeout(() => handleStimulation(true), 100);
        } else if (!trace.error && trace.collateralId === 'output') {
          // Success - process result
          console.log('Retry succeeded:', trace.payload);
        }
      }
    }
  });
};

handleStimulation();
```

#### Context Versioning for Selective Recovery
Since CNS modifies the context dictionary in-place, you can create new context objects for version control and selective recovery:

```typescript
// Create context snapshots for version control
const createContextSnapshot = (store: ICNSStimulationContextStore) => {
  const snapshot = new CNSStimulationContextStore();
  snapshot.setAll(store.getAll());
  return snapshot;
};

const retryWithVersionControl = () => {
  let preFailureContext: ICNSStimulationContextStore | undefined;
  
  cns.stimulate(input, payload, {
    onTrace: (trace) => {
      // Save context before potential failure points
      if (trace.collateralId === 'risky-operation') {
        preFailureContext = createContextSnapshot(trace.contextStore);
      }
      
      if (trace.queueLength === 0 && trace.error) {
        // Option 1: Retry with context from just before failure
        // (excludes the failed step's context changes)
        cns.stimulate(failedCollateral, payload, {
          ctx: preFailureContext,
          onTrace: (retryTrace) => { /* handle retry */ }
        });
        
        // Option 2: Retry with full context including failed step
        // (useful when failure was transient, not logic error)
        cns.stimulate(failedCollateral, payload, {
          ctx: trace.contextStore,
          onTrace: (retryTrace) => { /* handle retry */ }
        });
      }
    }
  });
};
```

### State Recovery and Restart

CNS provides built-in support for recovering from failures and restarting operations. The `onTrace` callback includes the current context state, allowing you to:

1. **Capture context on failure**: When an error occurs, the trace contains the complete context state
2. **Restart with preserved context**: Use the saved context to restore neuron states
3. **Resume from failure point**: Continue processing from where it left off
4. **Implement retry logic**: Context preserves attempt counts and other stateful retry data

```typescript
// Example: Advanced recovery with persistence
let savedContextStore: ICNSStimulationContextStore | undefined;

cns.stimulate(input, payload, {
  onTrace: (trace) => {
    if (trace.queueLength === 0) {
      if (trace.error) {
        // Failure: save context for recovery
        savedContextStore = trace.contextStore;
        await persistContextToStorage(trace.contextStore.getAll());
        console.log('Context saved for recovery');
      }
    }
  }
});

// Recovery from persistent storage
const restoreAndRetry = async () => {
  const persistedState = await loadContextFromStorage();
  const contextStore = createContextStore();
  contextStore.setAll(persistedState);
  
  cns.stimulate(failedCollateral, originalPayload, {
    ctx: contextStore, // Restore full state
    onTrace: (trace) => {
      // Monitor recovery attempt
    }
  });
};
```

**Custom Context Store Implementations**: You can create your own context store implementations by implementing the `ICNSStimulationContextStore` interface:

```typescript
import { ICNSStimulationContextStore } from '@cnstra/core';

// Example: Redis-backed context store for distributed systems
class RedisContextStore implements ICNSStimulationContextStore {
  constructor(private redis: RedisClient, private keyPrefix: string) {}

  get(key: string): unknown {
    // Synchronous get - consider caching for performance
    return this.redis.getSync(`${this.keyPrefix}:${key}`);
  }

  set(key: string, value: unknown): void {
    this.redis.set(`${this.keyPrefix}:${key}`, JSON.stringify(value));
  }

  getAll(): Record<string, unknown> {
    const keys = this.redis.keys(`${this.keyPrefix}:*`);
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const shortKey = key.replace(`${this.keyPrefix}:`, '');
      result[shortKey] = JSON.parse(this.redis.getSync(key));
    }
    return result;
  }

  setAll(values: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(values)) {
      this.set(key, value);
    }
  }
}

// Example: Immutable context store for versioning
class ImmutableContextStore implements ICNSStimulationContextStore {
  private data: Record<string, unknown> = {};
  private version = 0;

  get(key: string): unknown {
    return this.data[key];
  }

  set(key: string, value: unknown): void {
    // Create new instance instead of mutating
    this.data = { ...this.data, [key]: value };
    this.version++;
  }

  getAll(): Record<string, unknown> {
    return { ...this.data }; // Return copy
  }

  setAll(values: Record<string, unknown>): void {
    this.data = { ...values };
    this.version++;
  }

  getVersion(): number {
    return this.version;
  }
}

// Usage with custom context store
cns.stimulate(input, payload, {
  createContextStore: () => new RedisContextStore(redisClient, 'session-123'),
  onTrace: (trace) => {
    // trace.contextStore is your custom RedisContextStore
    console.log('Using Redis-backed context');
  }
});
```

**Context Store Interface**:
```typescript
interface ICNSStimulationContextStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  getAll(): Record<string, unknown>;
  setAll(values: Record<string, unknown>): void;
}
```

**Custom Store Use Cases**:
- **Persistence**: Redis, database, or file-based storage
- **Distribution**: Share context across multiple CNS instances
- **Immutability**: Version-controlled context for advanced debugging
- **Encryption**: Secure sensitive context data
- **Compression**: Optimize memory usage for large context objects
- **Auditing**: Log all context changes for compliance

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
