---
id: testing
title: Testing with Neuron Replacement - Mocks and Component Isolation
sidebar_label: Testing
slug: /recipes/testing
description: Learn how to easily test CNStra applications by replacing neurons with mocks. Especially effective when data from DB/mocks is also accessed through neuron-signals.
keywords: [testing, unit tests, integration tests, mocks, mock neurons, neuron replacement, test isolation, signal testing, database testing, neuron replacement, testing patterns]
---

CNStra architecture makes testing simple thanks to the explicit neuron graph structure and typed signals. The key idea: **neurons can be easily replaced with mocks**, especially if data access (DB, external APIs) is also implemented through neurons.

## Why This Works

In CNStra, each neuron:
- Accepts one input signal through a dendrite
- Returns one or more output signals through an axon
- Has explicit typed contracts (collaterals)

This means:
- ✅ Neurons are easily replaceable with mocks that have the same axons
- ✅ Tests are isolated: you can test one neuron by replacing its dependencies
- ✅ Types guarantee mock compatibility
- ✅ Signals can be created directly without real neurons

## Basic Pattern: Replacing a Neuron with a Mock

### Example: Testing Business Logic with a DB Mock

```ts
import { CNS, collateral, neuron } from '@cnstra/core';

// Shared collaterals (contracts)
const user = {
  fetchRequest: collateral<{ userId: string }>('user:fetch-request'),
  fetched: collateral<{ userId: string; name: string }>('user:fetched'),
};

// Real DB neuron (in production)
export const dbUserNeuron = neuron('db-user', { fetched: user.fetched })
  .dendrite({
    collateral: user.fetchRequest,
    response: async (payload) => {
      const userData = await db.users.findById(payload.userId);
      return user.fetched.createSignal({
        userId: userData.id,
        name: userData.name,
      });
    },
  });

// Mock neuron for tests
export const mockDbUserNeuron = neuron('mock-db-user', { fetched: user.fetched })
  .dendrite({
    collateral: user.fetchRequest,
    response: async (payload) => {
      // Return test data without real DB
      return user.fetched.createSignal({
        userId: payload.userId,
        name: `Mock User ${payload.userId}`,
      });
    },
  });

// Business logic we're testing
export const userProcessor = neuron('user-processor', {
  processed: collateral<{ userId: string; greeting: string }>('user:processed'),
})
  .dendrite({
    collateral: user.fetched,
    response: (payload, axon) => {
      return axon.processed.createSignal({
        userId: payload.userId,
        greeting: `Hello, ${payload.name}!`,
      });
    },
  });

// Test: use mock instead of real DB neuron
describe('User Processor', () => {
  it('should process user data correctly', async () => {
    // Create CNS with mock neuron instead of real one
    const cns = new CNS([mockDbUserNeuron, userProcessor]);
    
    const responses: unknown[] = [];
    const stimulation = cns.stimulate(
      user.fetchRequest.createSignal({ userId: '123' }),
      {
        onResponse: (response) => {
          responses.push(response);
        },
      }
    );
    
    await stimulation.waitUntilComplete();
    
    // Verify processor received data and processed it
    const processed = responses.find(
      r => r.outputSignal?.collateralName === 'user:processed'
    );
    expect(processed?.outputSignal?.payload).toEqual({
      userId: '123',
      greeting: 'Hello, Mock User 123!',
    });
  });
});
```

## Advanced Pattern: Mocks with Configurable Behavior

Mocks can be made flexible to test different scenarios:

```ts
// Factory for mock neurons with configurable behavior
function createMockDbUserNeuron(
  behavior: 'success' | 'not-found' | 'error'
) {
  return neuron('mock-db-user', {
    fetched: user.fetched,
    notFound: collateral<{ userId: string }>('user:not-found'),
    error: collateral<{ userId: string; error: string }>('user:error'),
  })
    .dendrite({
      collateral: user.fetchRequest,
      response: async (payload, axon) => {
        if (behavior === 'not-found') {
          return axon.notFound.createSignal({ userId: payload.userId });
        }
        if (behavior === 'error') {
          return axon.error.createSignal({
            userId: payload.userId,
            error: 'Database connection failed',
          });
        }
        // success
        return axon.fetched.createSignal({
          userId: payload.userId,
          name: `Test User ${payload.userId}`,
        });
      },
    });
}

// Tests for different scenarios
describe('User Processor with different DB behaviors', () => {
  it('handles successful fetch', async () => {
    const cns = new CNS([
      createMockDbUserNeuron('success'),
      userProcessor,
    ]);
    // ... test success scenario
  });

  it('handles user not found', async () => {
    const cns = new CNS([
      createMockDbUserNeuron('not-found'),
      userProcessor,
      // Need neuron to handle not-found
      handleNotFoundNeuron,
    ]);
    // ... test not-found scenario
  });
});
```

## Testing with Real Signals but Mock Neurons

You can create signals directly, bypassing real neurons:

```ts
describe('Testing downstream neurons in isolation', () => {
  it('should process signal without upstream neuron', async () => {
    // Test only userProcessor by creating signal directly
    const cns = new CNS([userProcessor]);
    
    // Create signal directly, as if sent by dbUserNeuron
    const fetchedSignal = user.fetched.createSignal({
      userId: '123',
      name: 'Test User',
    });
    
    const responses: unknown[] = [];
    await cns.stimulate(fetchedSignal, {
      onResponse: (r) => responses.push(r),
    });
    
    // Verify processing result
    const processed = responses.find(
      r => r.outputSignal?.collateralName === 'user:processed'
    );
    expect(processed?.outputSignal?.payload.greeting).toBe('Hello, Test User!');
  });
});
```

## Testing Entire Graphs with Partial Replacement

You can replace only some neurons, leaving others real:

```ts
// Real business logic
const orderProcessor = neuron('order-processor', {
  orderCreated: collateral<{ orderId: string }>('order:created'),
})
  .dendrite({
    collateral: user.fetched,
    response: (payload, axon) => {
      // Creates order based on user data
      return axon.orderCreated.createSignal({
        orderId: `order-${payload.userId}`,
      });
    },
  });

describe('Order flow with mocked DB', () => {
  it('should create order using mocked user data', async () => {
    // Replace only DB neuron, others are real
    const cns = new CNS([
      mockDbUserNeuron,  // mock
      userProcessor,      // real
      orderProcessor,     // real
    ]);
    
    await cns.stimulate(
      user.fetchRequest.createSignal({ userId: '123' })
    );
    
    // Verify entire graph worked correctly
    // with mock data from DB
  });
});
```

## Testing with Mocks Through Signals (Recommended Approach)

**Best practice**: if data access is implemented through neuron-signals, testing becomes trivial:

```ts
// In production: neuron reads from DB
export const dbReadNeuron = neuron('db-read', {
  dataFetched: collateral<{ id: string; data: unknown }>('db:data-fetched'),
})
  .dendrite({
    collateral: collateral<{ id: string }>('db:read-request'),
    response: async (payload, axon) => {
      const data = await database.findById(payload.id);
      return axon.dataFetched.createSignal({ id: payload.id, data });
    },
  });

// In tests: mock neuron returns test data
export const mockDbReadNeuron = neuron('mock-db-read', {
  dataFetched: collateral<{ id: string; data: unknown }>('db:data-fetched'),
})
  .dendrite({
    collateral: collateral<{ id: string }>('db:read-request'),
    response: async (payload, axon) => {
      // Return predefined test data
      const testData = {
        '123': { name: 'Test Item 1' },
        '456': { name: 'Test Item 2' },
      };
      return axon.dataFetched.createSignal({
        id: payload.id,
        data: testData[payload.id] || null,
      });
    },
  });

// Business logic works the same with real and mock neurons
const businessLogic = neuron('business', {
  result: collateral<{ processed: unknown }>('business:result'),
})
  .dendrite({
    collateral: collateral<{ id: string; data: unknown }>('db:data-fetched'),
    response: (payload, axon) => {
      // Processes data regardless of source
      return axon.result.createSignal({
        processed: transformData(payload.data),
      });
    },
  });

// Test: simply replace dbReadNeuron with mockDbReadNeuron
const testCns = new CNS([mockDbReadNeuron, businessLogic]);
const prodCns = new CNS([dbReadNeuron, businessLogic]);
// Both work the same way!
```

## Testing with Context

If neurons use context, it can also be mocked:

```ts
import { withCtx } from '@cnstra/core';

const ctxNeuron = withCtx<{ sessionId: string }>()
  .neuron('ctx-neuron', {
    output: collateral<{ result: string }>('ctx:output'),
  })
  .dendrite({
    collateral: collateral<{ action: string }>('ctx:input'),
    response: (payload, axon, ctx) => {
      // Context stores per-neuron per-stimulation metadata (session tracking)
      const sessionId = ctx.get()?.sessionId || 'default';
      // Business data flows through payloads
      return axon.output.createSignal({
        result: `${payload.action} (session: ${sessionId})`,
      });
    },
  });

describe('Context-aware neuron', () => {
  it('should use provided context', async () => {
    const cns = new CNS([ctxNeuron]);
    
    const responses: unknown[] = [];
    await cns.stimulate(
      collateral<{ action: string }>('ctx:input').createSignal({ action: 'test' }),
      {
        ctx: {
          get: () => ({ sessionId: 'test-session-123' }),
          set: () => {},
          delete: () => {},
        },
        onResponse: (r) => responses.push(r),
      }
    );
    
    expect(responses[0]?.outputSignal?.payload.result).toBe(
      'test (session: test-session-123)'
    );
  });
});
```

## Integration Tests with Real Neurons

For integration tests, you can use real neurons but with a test DB:

```ts
// Real neuron, but with test DB
const testDb = createTestDatabase(); // in-memory or test DB

const testDbNeuron = neuron('test-db', {
  fetched: user.fetched,
})
  .dendrite({
    collateral: user.fetchRequest,
    response: async (payload) => {
      // Use test DB instead of production
      const userData = await testDb.users.findById(payload.userId);
      return user.fetched.createSignal({
        userId: userData.id,
        name: userData.name,
      });
    },
  });

// Integration test with real logic but test DB
describe('Integration test', () => {
  beforeEach(async () => {
    await testDb.users.insert({ id: '123', name: 'Test User' });
  });

  it('should work end-to-end with test DB', async () => {
    const cns = new CNS([testDbNeuron, userProcessor]);
    // ... full integration test
  });
});
```

## Benefits of This Approach

1. **Isolation**: Each neuron is tested independently
2. **Speed**: Mocks are faster than real DBs/APIs
3. **Determinism**: Tests always return predictable results
4. **Type Safety**: TypeScript guarantees mock compatibility
5. **Flexibility**: Easy to test edge cases and errors
6. **Readability**: Explicit graph structure makes tests clear

## Recommendations

- ✅ Use shared collaterals for contracts between neurons
- ✅ Create mock neuron factories for reuse
- ✅ Test neurons in isolation by creating signals directly
- ✅ For integration tests, use real neurons with test DB
- ✅ If data comes through neuron-signals, mocking is trivial
- ✅ Use types to guarantee mock compatibility

## Example: Complete Test Suite

```ts
import { CNS, collateral, neuron } from '@cnstra/core';

// Contracts
const user = {
  fetchRequest: collateral<{ userId: string }>('user:fetch-request'),
  fetched: collateral<{ userId: string; name: string }>('user:fetched'),
};

// Mock DB neuron
const createMockDb = (users: Record<string, { name: string }>) =>
  neuron('mock-db', { fetched: user.fetched })
    .dendrite({
      collateral: user.fetchRequest,
      response: async (payload, axon) => {
        const userData = users[payload.userId];
        if (!userData) {
          throw new Error(`User ${payload.userId} not found`);
        }
        return axon.fetched.createSignal({
          userId: payload.userId,
          name: userData.name,
        });
      },
    });

// Business logic
const processor = neuron('processor', {
  processed: collateral<{ greeting: string }>('processor:processed'),
})
  .dendrite({
    collateral: user.fetched,
    response: (payload, axon) =>
      axon.processed.createSignal({
        greeting: `Hello, ${payload.name}!`,
      }),
  });

describe('Full test suite', () => {
  it('processes user correctly', async () => {
    const mockDb = createMockDb({
      '123': { name: 'Alice' },
    });
    const cns = new CNS([mockDb, processor]);
    
    const results: unknown[] = [];
    await cns.stimulate(
      user.fetchRequest.createSignal({ userId: '123' }),
      { onResponse: (r) => results.push(r) }
    );
    
    const processed = results.find(
      r => r.outputSignal?.collateralName === 'processor:processed'
    );
    expect(processed?.outputSignal?.payload.greeting).toBe('Hello, Alice!');
  });

  it('handles missing user', async () => {
    const mockDb = createMockDb({});
    const cns = new CNS([mockDb, processor]);
    
    await expect(
      cns.stimulate(user.fetchRequest.createSignal({ userId: '999' }))
    ).rejects.toThrow('User 999 not found');
  });
});
```

This approach makes testing CNStra applications simple and effective, especially when data access is implemented through neuron-signals.
