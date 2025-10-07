# 🧠 CNS Graph Visualization

Interactive neural network graph visualization for CNStra DevTools with pixel-art decay theme.

## 🎯 Features

### Interactive Graph Visualization
- **Real-time CNS topology rendering** using PixiJS
- **Multiple branch support** - handles many short separate branches (typical CNS pattern)
- **Color-coded neurons** based on stimulation activity
- **Interactive neuron selection** with click handlers
- **Connection visualization** with directional arrows

### Color Coding System

#### Neuron Activity Levels
- **Inactive (0 stimulations)**: `#3d2824` - Dark flesh
- **Low (1-5)**: `#5c3832` - Medium flesh  
- **Medium (5-15)**: `#7a4940` - Light flesh
- **High (15-30)**: `#8b7355` - Yellow pus
- **Very High (30-50)**: `#5c6b47` - Green pus
- **Critical (50+)**: `#4a5c3a` - Acid green (highly active)

#### Connection Activity
- **Inactive**: `#261815` - Dark background
- **Low**: `#4a1e1e` - Dark blood
- **Medium**: `#6b2737` - Medium blood  
- **High**: `#8b2635` - Bright blood (active connection)

### Neuron Types
- **Input Neurons**: Green border, syringe icon (💉)
- **Processing Neurons**: Default border, microbe icon (🦠)
- **Output Neurons**: Red border, brain icon (🧠)

## 🎮 User Interface

### Graph View
- **Pan and zoom** support (planned)
- **Legend** showing activity levels
- **Overlay information** with network statistics
- **Pixel-perfect rendering** for retro aesthetic

### Neuron Details Panel
Opens on neuron click, showing:
- **Neuron information** (ID, type, position)
- **Activity metrics** with progress bars
- **Recent stimulations** (last 10)
- **Signal analysis** (types, intensity averages)
- **Real-time updates** as new stimulations occur

## 🔧 Technical Implementation

### Components

#### CNSGraph
```tsx
<CNSGraph
  neurons={neurons}
  connections={connections}
  onNeuronClick={handleNeuronClick}
/>
```

**Props:**
- `neurons: NeuronData[]` - Array of neuron data
- `connections: ConnectionData[]` - Array of connection data  
- `onNeuronClick: (neuron: NeuronData) => void` - Click handler

#### NeuronDetailsPanel
```tsx
<NeuronDetailsPanel
  neuron={selectedNeuron}
  onClose={handleClose}
/>
```

**Props:**
- `neuron: NeuronData | null` - Selected neuron data
- `onClose: () => void` - Close handler

### Data Types

#### NeuronData
```typescript
interface NeuronData {
  id: string;                    // Unique identifier
  name: string;                  // Display name
  x: number;                     // X position
  y: number;                     // Y position  
  stimulationCount: number;      // Total stimulations
  stimulations: StimulationData[]; // Detailed stimulation history
  type: 'input' | 'processing' | 'output'; // Neuron type
}
```

#### StimulationData
```typescript
interface StimulationData {
  id: string;           // Unique stimulation ID
  timestamp: number;    // When it occurred
  signal: any;          // Signal data
  sourceNeuron?: string; // Source neuron ID
  targetNeuron?: string; // Target neuron ID
}
```

#### ConnectionData  
```typescript
interface ConnectionData {
  from: string;         // Source neuron ID
  to: string;           // Target neuron ID
  weight: number;       // Connection strength (0-1)
  stimulationCount: number; // Activity level
}
```

## 🎨 Styling

### CSS Classes
- `.cns-graph` - Main graph container
- `.neuron-details-panel` - Details panel styling
- `.activity-*` - Activity level indicators
- `.neuron-type-*` - Neuron type styling

### Animations
- **Slide-in panel** animation
- **Decay glow** for active elements
- **Flicker** for critical activity levels
- **Pulse infection** for highly active neurons

## 🚀 Usage Examples

### Basic Integration
```tsx
const [selectedNeuron, setSelectedNeuron] = useState<NeuronData | null>(null);
const [neurons, setNeurons] = useState<NeuronData[]>([]);
const [connections, setConnections] = useState<ConnectionData[]>([]);

const handleNeuronClick = (neuron: NeuronData) => {
  setSelectedNeuron(neuron);
};

return (
  <div style={{ position: 'relative', height: '100vh' }}>
    <CNSGraph
      neurons={neurons}
      connections={connections}
      onNeuronClick={handleNeuronClick}
    />
    
    <NeuronDetailsPanel
      neuron={selectedNeuron}
      onClose={() => setSelectedNeuron(null)}
    />
  </div>
);
```

### Mock Data Generation
The graph includes automatic mock data generation for demonstration:
- **6 separate branches** with varying node counts
- **Random stimulation activity** (0-60 per neuron)
- **Cross-branch connections** for realistic topology
- **Different branch directions** (horizontal, vertical, diagonal)

## 🎯 Future Enhancements

### Planned Features
- **Real-time updates** from CNS stimulation events
- **Zoom and pan controls** for large networks
- **Filtering options** (by activity, type, etc.)
- **Export functionality** (PNG, SVG)
- **Performance optimization** for large graphs (1000+ neurons)
- **Minimap** for navigation
- **Search and highlight** specific neurons
- **Temporal playback** of stimulation history

### Performance Considerations
- **Efficient rendering** with PixiJS Graphics objects
- **Level-of-detail** rendering for large graphs
- **Viewport culling** for off-screen elements
- **Batch updates** for real-time data

---

*Built with PixiJS, React, and lots of decay-themed pixels* 🦠💀🧟‍♂️
