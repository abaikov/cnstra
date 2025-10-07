# @cnstra/react

React bindings for CNS neural network-inspired event flow system.

📚 **[Full Documentation](https://cnstra.org/)** | [React Integration Guide](https://cnstra.org/docs/examples/react) | [Frontend with OIMDB](https://cnstra.org/docs/frontend/oimdb)

## Installation

```bash
npm install @cnstra/react @cnstra/core
```

## Usage

### Basic Setup

```tsx
import React from 'react';
import { CNSProvider, useCNS } from '@cnstra/react';
import { CNS, neuron, collateral } from '@cnstra/core';

// Create your CNS instance
const cns = new CNS([
  neuron('counter', {
    increment: collateral('increment'),
    decrement: collateral('decrement')
  }).dendrite({
    collateral: collateral('increment'),
    response: (payload, axon) => {
      // Handle increment logic here
      return axon.increment.createSignal();
    }
  }).dendrite({
    collateral: collateral('decrement'),
    response: (payload, axon) => {
      // Handle decrement logic here
      return axon.decrement.createSignal();
    }
  })
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

```tsx
import { useCNS } from '@cnstra/react';
import { collateral } from '@cnstra/core';

function Counter() {
  const cns = useCNS();
  
  const handleIncrement = () => {
    cns.stimulate(collateral('increment').createSignal());
  };
  
  const handleDecrement = () => {
    cns.stimulate(collateral('decrement').createSignal());
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
}

function Component2() {
  const cns = useCNS(); // Uses cns2
  // ...
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

The package is fully typed and supports generic types for your CNS instances:

```tsx
import { CNSProvider, useCNS } from '@cnstra/react';

// With custom types
const cns = new CNS<MyCollateralName, MyNeuronId, MyNeuron, MyDendrite>([/* neurons */]);

function MyComponent() {
  const cns = useCNS<MyCollateralName, MyNeuronId, MyNeuron, MyDendrite>();
  // cns is fully typed
}
```
