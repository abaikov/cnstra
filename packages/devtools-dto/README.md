# CNStra DevTools DTO

Data Transfer Objects (DTOs) for the CNStra DevTools protocol.

📚 **[Full Documentation](https://cnstra.org/)** | [DevTools Guide](https://cnstra.org/docs/devtools/overview)

## Data Model Overview

The CNStra DevTools uses a normalized data model where neural network relationships are represented through separate entities rather than embedded relationships.

> Note: `@cnstra/core` runtime routing is identity-based (signals carry a collateral *object reference*, neurons/collaterals do not have built-in names/ids).  
> DevTools DTOs are the **persistence/debug layer** and therefore use stable string names and ids such as `neuronName`, `collateralName`, and `stimulationId`. Names are unique within one CNS instance (`cnsId`).

### Topology entities

#### `TCNSNeuronDTO`
- Represents a processing unit in the neural network
- Contains: `name`, `cnsId`, `appId`

#### `TCNSCollateralDTO`
- Represents an output channel (axon collateral) that neurons use to send signals
- Contains: `name`, `ownerNeuronName?`, `cnsId`, `appId`
- **Key relationship**: `ownerNeuronName` names the neuron that OWNS this collateral (signal source); absent means an entry collateral that no axon owns

#### `TCNSDendriteDTO`
- Represents an input channel that neurons use to receive signals
- Contains: `neuronName`, `collateralName`, `cnsId`, `appId`
- **Key relationships**:
  - `neuronName` names the neuron that OWNS this dendrite (signal destination)
  - `collateralName` names the collateral this dendrite listens to

### Building Neural Network Connections

To create connections between neurons in the DevTools visualization:

1. **Find signal sources**: Use `ownerNeuronName` on each `TCNSCollateralDTO` to map collateral names → owning neurons
2. **Find signal destinations**: Use `collateralName` + `neuronName` on each `TCNSDendriteDTO` to map collateral names → listening neurons
3. **Create connections**: For each collateral, connect the owning neuron → all listening neurons

```typescript
import type { TCNSTopologyMessageDTO } from '@cnstra/devtools-dto';

declare const topology: TCNSTopologyMessageDTO;

const ownerByCollateral = new Map<string, string>();
topology.collaterals.forEach(c => {
    if (c.ownerNeuronName) ownerByCollateral.set(c.name, c.ownerNeuronName);
});

const listenersByCollateral = new Map<string, Set<string>>();
topology.dendrites.forEach(d => {
    const listeners = listenersByCollateral.get(d.collateralName) || new Set<string>();
    listeners.add(d.neuronName);
    listenersByCollateral.set(d.collateralName, listeners);
});

const connections: { from: string; to: string; via: string }[] = [];
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

### Runtime data

The runtime records are the name-based resumable-execution model, re-exported from `@cnstra/persist-dto`.

#### `TCNSStimulationState`
- One stimulation (a run), stable across retries
- Contains: `stimulationId`, `entry`, `status`, `progress`, `scopeName?`

#### `TCNSStimulationAttempt`
- One execution of a stimulation; a retry starts a new attempt
- Contains: `stimulationAttemptId`, `stimulationId`, `attemptNumber`, `status`, `startedAt`, `completedAt`, `hopCount`, `hasError`, `replayOf`, `entry`
- Use for: retry history, attempt timelines

#### `TCNSStimulationTask`
- One neuron activation (hop) inside an attempt
- Contains: `stimulationAttemptId`, `index`, `neuronName`, `dendriteCollateralName`, `inputIndex`, `output`, `status`, `error`, `startedAt`, `duration`, `activationContext?`
- Use for: signal flow tracking, performance monitoring, error tracking

### Message Types

#### `TCNSTopologyMessageDTO`
- Sent by an app to describe its static network structure
- Contains: `cnsId`, `appId`, `appName`, `version`, `timestamp`, `neurons[]`, `collaterals[]`, `dendrites[]`

#### `TCNSAppBatchMessageDTO`
- Sent by an app during runtime; `items` mixes topology messages with `cns.stimulation`, `cns.stimulation.attempt` and `cns.stimulation.task` records
- Use for: real-time activity visualization

#### `TCNSClientMessageDTO` / `TCNSServerMessageDTO`
- The panel ↔ server protocol: queries, scheduled list, retry, clone, command and launch requests, and their results and broadcasts

## Common Pitfalls

### ❌ Don't confuse a stimulation with its tasks
- `TCNSStimulationState` = the run as a whole
- `TCNSStimulationAttempt` = one execution of that run
- `TCNSStimulationTask` = one neuron activation inside an attempt
- For activity counts, count tasks

### ❌ Don't rely on embedded relationships
All relationships are represented through separate entities joined by name within a `cnsId`, not embedded arrays.

## Architecture Notes

This normalized approach provides several benefits:
- **Flexibility**: Collaterals can be shared across multiple dendrites
- **Consistency**: Single source of truth for each entity
- **Performance**: Efficient querying and updates
- **Extensibility**: Easy to add new relationship types

The tradeoff is that building relationships requires joining across entities rather than following embedded references.
