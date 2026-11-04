# @cnstra/react

React bindings for CNS neural network-inspired event flow system.

📚 **[Full Documentation](https://cnstra.org/)** | [React Integration Guide](https://cnstra.org/docs/frontend/react-patterns) | [Frontend with OIMDB](https://cnstra.org/docs/frontend/oimdb)

## Installation

```bash
npm install @cnstra/react @cnstra/core
```

## Usage

### Basic Setup

```tsx file=App.tsx
import React from 'react';
import { CNSProvider, useCNS } from '@cnstra/react';
import { CNS, neuron, collateral } from '@cnstra/core';
import { Counter } from './Counter';

// Create your CNS instance
const cns = new CNS([
  (() => {
    const increment = collateral();
    const decrement = collateral();
    return neuron({
      increment,
      decrement
    }).dendrite({
      collateral: increment,
    response: (payload, axon) => {
      // Handle increment logic here
      return axon.increment.createSignal();
    }
  }).dendrite({
    collateral: decrement,
    response: (payload, axon) => {
      // Handle decrement logic here
      return axon.decrement.createSignal();
    }
  })
  })()
]);

function App() {
  return (
    <CNSProvider cns={cns}>
      <Counter />
    </CNSProvider>
  );
}
```

### Using the Hook

```tsx file=Counter.tsx
import { useCNS } from '@cnstra/react';
import { collateral } from '@cnstra/core';

export function Counter() {
  const cns = useCNS();

  // Keep collaterals in module scope or component state; don't re-create them per call.
  const increment = collateral();
  const decrement = collateral();

  const handleIncrement = () => {
    cns.stimulate(increment.createSignal());
  };

  const handleDecrement = () => {
    cns.stimulate(decrement.createSignal());
  };
  
  return (
    <div>
      <button onClick={handleIncrement}>+</button>
      <button onClick={handleDecrement}>-</button>
    </div>
  );
}
```

### Multiple CNS Instances

You can create multiple CNS instances and use them in different parts of your app:

```tsx
import React from 'react';
import { CNSProvider, useCNS } from '@cnstra/react';
import { CNS } from '@cnstra/core';

// First CNS instance
const cns1 = new CNS([/* neurons */]);
const cns2 = new CNS([/* other neurons */]);

function App() {
  return (
    <div>
      <CNSProvider cns={cns1}>
        <Component1 />
      </CNSProvider>
      
      <CNSProvider cns={cns2}>
        <Component2 />
      </CNSProvider>
    </div>
  );
}

function Component1() {
  const cns = useCNS(); // Uses cns1
  // ...
  return null;
}

function Component2() {
  const cns = useCNS(); // Uses cns2
  // ...
  return null;
}
```

## API

### `CNSProvider`

A React context provider that makes a CNS instance available to child components.

**Props:**
- `cns`: The CNS instance to provide
- `children`: React components that will have access to the CNS context

### `useCNS()`

A React hook that returns the CNS instance from the nearest `CNSProvider`.

**Returns:** The CNS instance

**Throws:** An error if used outside of a `CNSProvider`

## TypeScript Support

The package is fully typed. `useCNS()` takes no type arguments and returns `CNS<any, any>`, because a provider accepts any instance; narrow it to the type of yours:

```tsx
import { CNS, collateral, neuron } from '@cnstra/core';
import { useCNS } from '@cnstra/react';

const clicked = collateral<{ id: string }>();
const clickNeuron = neuron({}).dendrite({ collateral: clicked, response: () => {} });

const appCNS = new CNS([clickNeuron]);

function MyComponent() {
  const cns = useCNS() as typeof appCNS;
  return <button onClick={() => cns.stimulate(clicked.createSignal({ id: '1' }))}>Click</button>;
}
```
