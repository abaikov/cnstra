# 🎨 Neon Styles for CNS DevTools Panel

## Overview

This package provides a complete neon styling system for visualizing neural networks with beautiful, glowing effects that make signal flow easy to track.

## Features

- ✨ **Neon Color Palette** - 8 carefully chosen neon colors
- 🎯 **Group-based Coloring** - Deterministic colors for neuron groups
- 🔥 **Heat Maps** - Edge thickness and opacity based on activity
- ⚡ **Particle System** - Animated spikes traveling along edges
- 🌟 **Glow Effects** - Multiple layers of glow for authentic neon look

## Quick Start

```typescript
import { CNSDevToolsPanel, TCNSNodeStyle, TCNSEdgeStyle, CANVAS_BG } from '@cnstra/devtools-panel';

// Create panel with neon styles
const panel = new CNSDevToolsPanel({
    channelName: 'cns-devtools',
    width: 1200,
    height: 800
});

// The panel automatically uses neon styles!
document.body.appendChild(panel.render());
```

## Color System

### Base Neon Palette

```typescript
import { NEON_PALETTE } from '@cnstra/devtools-panel';

// 8 neon colors automatically distributed:
// - Ice Cyan (#00ccff)
// - Purple (#cc00ff) 
// - Mint (#00ff80)
// - Pink (#ff0080)
// - Amber (#ffcc00)
// - Coral (#ff4400)
// - Lime (#80ff00)
// - Electric Blue (#0066ff)
```

### Group-based Colors

```typescript
import { getGroupColor } from '@cnstra/devtools-panel';

// Deterministic colors based on group names
const inputColor = getGroupColor('input');     // Always same color
const computeColor = getGroupColor('compute'); // Always same color
const outputColor = getGroupColor('output');   // Always same color
```

## Styling Functions

### Node Styling

```typescript
import { TCNSNodeStyle } from '@cnstra/devtools-panel';

const style = TCNSNodeStyle({ 
    group: 'input',     // Group for color
    active: true        // Active state (thicker stroke)
});

// Returns:
// {
//   radius: 12,
//   fill: '#00ccff26',    // Semi-transparent fill
//   stroke: '#00ccff',    // Main stroke color
//   strokeWidth: 3.0,     // Thicker when active
//   glow: '#00ccff'       // Glow color
// }
```

### Edge Styling

```typescript
import { TCNSEdgeStyle } from '@cnstra/devtools-panel';

const style = TCNSEdgeStyle({ 
    group: 'compute',   // Group for color
    heat: 75,           // Activity level (0-100)
    active: false       // Active state
});

// Returns:
// {
//   color: '#cc00ff',     // Main color
//   width: 3.25,          // Width based on heat
//   alpha: 0.725,         // Opacity based on heat
//   glow: '#cc00ff'       // Glow color
// }
```

### Particle Styling

```typescript
import { TCNSParticleStyle } from '@cnstra/devtools-panel';

const style = TCNSParticleStyle({ 
    group: 'output'      // Group for color
});

// Returns:
// {
//   size: 3.2,            // Particle size in px
//   speed: 420,           // Movement speed px/s
//   life: 900,            // Lifetime in ms
//   color: '#80ff00',     // Particle color
//   trailAlpha: 0.35      // Trail transparency
// }
```

## Integration with CNS

### 1. Setup CNS with Glia

```typescript
import { CNS } from '@cnstra/core';
import { MicrogliaTrace, AstrogliaMeta } from '@cnstra/glia';

const cns = new CNS(afferentAxon, neurons)
    .use(MicrogliaTrace('cns-devtools'));

// Add metadata for visualization
cns.useFor(neuronA, AstrogliaMeta({ 
    label: 'Input', 
    group: 'input',      // This determines the color!
    layer: 0 
}));

cns.useFor(neuronB, AstrogliaMeta({ 
    label: 'Process', 
    group: 'compute',    // Different group = different color
    layer: 1 
}));
```

### 2. Create DevTools Panel

```typescript
import { CNSDevToolsPanel } from '@cnstra/devtools-panel';

const panel = new CNSDevToolsPanel({
    channelName: 'cns-devtools',
    width: 1200,
    height: 800
});

document.body.appendChild(panel.render());
```

### 3. Watch Signals Flow!

```typescript
// Now when you stimulate the network:
cns.stimulate('input', { data: 42 });

// You'll see:
// - Nodes glow in their group colors
// - Edges thicken based on signal activity
// - Particles travel along edges showing signal flow
// - Heat maps build up on frequently used paths
```

## Customization

### Custom Particle Presets

```typescript
import { TCNSMakeDefaultParticlePreset } from '@cnstra/devtools-panel';

const customPreset = TCNSMakeDefaultParticlePreset('custom-group');
customPreset.poolSize = 2048;           // More particles
customPreset.maxPerEdgeBurst = 12;      // More per burst
customPreset.style.speed = 600;         // Faster movement
customPreset.style.life = 1200;         // Longer life

// Apply to panel
panel.setParticlePreset(customPreset);
```

### Custom Color Schemes

```typescript
import { TCNSHsl } from '@cnstra/devtools-panel';

// Create custom neon colors
const customNeon = TCNSHsl(180, 100, 60);  // Teal
const warmNeon = TCNSHsl(30, 100, 60);     // Orange

// Use in your custom styles
const customStyle = {
    ...TCNSNodeStyle({ group: 'custom' }),
    stroke: customNeon,
    glow: warmNeon
};
```

## Performance Features

- 🚀 **Efficient Rendering** - Uses PIXI.js with WebGL
- 🔄 **Particle Pooling** - Pre-allocated particles to avoid GC
- 📊 **Heat Decay** - Automatic cooling of edge activity
- 🎯 **Batch Processing** - Events processed in batches per frame

## Technical Details

### Blend Modes

All neon effects use `BLEND_MODES.ADD` for authentic glow:

```typescript
// In PIXI.js
graphics.blendMode = PIXI.BLEND_MODES.ADD;
```

### Heat Calculation

Edge heat is calculated from signal frequency:

```typescript
// Heat increases with each signal
heat[edgeId] += signalCount;

// Automatically cools down each frame
heat *= 0.98; // 2% cooling per frame
```

### Color Hashing

Group colors are deterministically generated:

```typescript
// FNV-1a hash for stable colors
const colorIndex = hash32(groupName) % NEON_PALETTE.length;
const color = NEON_PALETTE[colorIndex];
```

## Troubleshooting

### Colors Not Showing

- Ensure `BLEND_MODES.ADD` is enabled
- Check that groups are properly set in `AstrogliaMeta`
- Verify PIXI.js is properly initialized

### Particles Not Moving

- Check that `MicrogliaTrace` is enabled
- Verify BroadcastChannel is working
- Ensure particle system is properly initialized

### Performance Issues

- Reduce `poolSize` in particle presets
- Lower `maxPerEdgeBurst` for fewer particles
- Use `requestAnimationFrame` for smooth updates

## Examples

See `neon-example.ts` for complete working examples of:
- Basic neon rendering
- Integration with CNS
- Custom styling
- Particle system usage
