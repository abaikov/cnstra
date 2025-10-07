# CNStra DevTools DTO

Data Transfer Objects (DTOs) for the CNStra DevTools protocol.

📚 **[Full Documentation](https://cnstra.org/)** | [DevTools Guide](https://cnstra.org/docs/examples/devtools)

## Data Model Overview

The CNStra DevTools uses a normalized data model where neural network relationships are represented through separate entities rather than embedded relationships.

### Core Entities

#### `Neuron`
- Represents a processing unit in the neural network
- Contains: `id`, `appId`, `name`, `axonCollaterals?`
- **Important**: `axonCollaterals` is provided for compatibility but use `Collateral` entities for authoritative relationships

#### `Collateral`
- Represents an output channel (axon collateral) that neurons use to send signals
- Contains: `collateralName`, `neuronId`, `appId`, `type`
- **Key relationship**: `neuronId` indicates which neuron OWNS this collateral (signal source)

#### `Dendrite`
- Represents an input channel that neurons use to receive signals
- Contains: `dendriteId`, `neuronId`, `appId`, `collateralName`, `type`, `collateralNames`
- **Key relationships**:
  - `neuronId` indicates which neuron OWNS this dendrite (signal destination)
  - `collateralName` indicates which collateral this dendrite listens to

### Building Neural Network Connections

To create connections between neurons in the DevTools visualization:

1. **Find signal sources**: Use `Collateral.neuronId` to map collateral names → owning neurons
2. **Find signal destinations**: Use `Dendrite.collateralName` + `Dendrite.neuronId` to map collateral names → listening neurons
3. **Create connections**: For each collateral, connect the owning neuron → all listening neurons

```typescript
// Example connection building logic
const ownerByCollateral = new Map<string, string>(); // collateralName -> owner neuronId
collaterals.forEach(c => ownerByCollateral.set(c.collateralName, c.neuronId));

const listenersByCollateral = new Map<string, Set<string>>(); // collateralName -> listener neuronIds
dendrites.forEach(d => {
    const listeners = listenersByCollateral.get(d.collateralName) || new Set();
    listeners.add(d.neuronId);
    listenersByCollateral.set(d.collateralName, listeners);
});

// Build connections: owner → listeners
const connections = [];
listenersByCollateral.forEach((listeners, collateralName) => {
    const owner = ownerByCollateral.get(collateralName);
    if (owner) {
        listeners.forEach(listener => {
            if (listener !== owner) {
                connections.push({ from: owner, to: listener, via: collateralName });
            }
        });
    }
});
```

### Runtime Data vs Events

#### `Stimulation`
- Represents a signal event sent on a collateral
- Contains: `stimulationId`, `neuronId`, `appId`, `collateralName`, `timestamp`, `payload`, `contexts`
- Use for: Activity visualization, signal flow tracking

#### `StimulationResponse`
- Represents a neuron's response to receiving a stimulation
- Contains: `responseId`, `stimulationId`, `neuronId`, `appId`, `timestamp`, `responsePayload`, `error`, `duration`
- Use for: Performance monitoring, error tracking

### Message Types

#### `InitMessage`
- Sent when DevTools connects to establish initial topology
- Contains: `neurons[]`, `collaterals[]`, `dendrites[]`
- Use for: Building static network structure

#### `StimulationMessage` / `StimulationBatchMessage`
- Sent during runtime to report signal activity
- Use for: Real-time activity visualization

#### `ResponseBatchMessage`
- Sent during runtime to report neuron responses
- Use for: Real-time performance monitoring

## Common Pitfalls

### ⚠️  Use `Collateral` entities for relationships
While `Neuron.axonCollaterals` exists for backward compatibility, use separate `Collateral` entities for authoritative relationship data.

### ❌ Don't confuse stimulations with responses
- `Stimulation` = signal sent on a collateral
- `StimulationResponse` = neuron's processing result
- For activity counts, use stimulations (events) not responses (results)

### ❌ Don't rely on embedded relationships
All relationships are represented through separate entities and foreign keys, not embedded arrays.

## Architecture Notes

This normalized approach provides several benefits:
- **Flexibility**: Collaterals can be shared across multiple dendrites
- **Consistency**: Single source of truth for each entity
- **Performance**: Efficient querying and updates
- **Extensibility**: Easy to add new relationship types

The tradeoff is that building relationships requires joining across entities rather than following embedded references.