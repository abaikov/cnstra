# @cnstra/devtools-panel

PixiJS-based visualization panel for CNS neural networks.

## Features

- **Real-time visualization**: See signals flow through your neural network
- **Interactive graph**: Zoom, pan, and explore the network structure
- **Live animations**: Watch spikes travel along edges in real-time
- **Performance monitoring**: Track timing and errors
- **Beautiful UI**: Neon aesthetic with smooth animations

## Installation

```bash
npm install @cnstra/devtools-panel
```

## Usage

### Basic Setup

```typescript
import { CNSDevToolsPanel } from '@cnstra/devtools-panel';

// Create the devtools panel
const panel = new CNSDevToolsPanel({
  channelName: 'cns-devtools',
  width: 1200,
  height: 800
});

// Mount to DOM
document.body.appendChild(panel);
```

### Integration with CNS

```typescript
import { CNS } from '@cnstra/core';
import { MicrogliaTrace } from '@cnstra/glia';
import { CNSDevToolsPanel } from '@cnstra/devtools-panel';

// Create CNS with tracing enabled
const cns = new CNS(afferentAxon, neurons)
  .use(MicrogliaTrace('cns-devtools'));

// Create and mount devtools panel
const panel = new CNSDevToolsPanel({
  channelName: 'cns-devtools'
});

document.body.appendChild(panel);

// Now when you stimulate the network, you'll see live visualization!
cns.stimulate('input', { data: 42 });
```

### React Integration

```tsx
import React from 'react';
import { CNSDevToolsPanel } from '@cnstra/devtools-panel';

function App() {
  return (
    <div>
      <h1>Neural Network Visualization</h1>
      <CNSDevToolsPanel 
        width={1200} 
        height={800}
        channelName="cns-devtools"
      />
    </div>
  );
}
```

## Controls

- **Mouse wheel**: Zoom in/out
- **Drag**: Pan around the graph
- **Click node**: Select and inspect
- **Play/Pause**: Control animation playback
- **Speed slider**: Adjust animation speed (0.25x to 4x)

## Architecture

The devtools panel consists of several key components:

- **GraphLayout**: Uses ELK.js for automatic graph layout
- **GraphRenderer**: PixiJS-based rendering with neon aesthetics
- **EventEngine**: Processes CNS events via BroadcastChannel
- **Controls**: React-based UI controls

## Events

The panel receives events from CNS via BroadcastChannel:

- `stage`: Signal processing stages
- `enqueue`: New signals entering the network
- `error`: Processing errors

## Performance

- Handles thousands of events per minute smoothly
- Batches event processing to avoid GC churn
- WebGL rendering for smooth animations
- Efficient memory management with event buffering

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## License

MIT
