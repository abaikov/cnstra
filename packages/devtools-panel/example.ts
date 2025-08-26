// Example integration of CNS DevTools Panel
// This shows how to use the visualization with your neural network

import { CNSDevToolsPanel } from './src/CNSDevToolsPanel';

// Example usage:
export function createDevToolsExample() {
    // Create the devtools panel
    const panel = new CNSDevToolsPanel({
        channelName: 'cns-devtools',
        width: 1200,
        height: 800,
    });

    // Mount to DOM
    document.body.appendChild(panel.render());

    // Create a BroadcastChannel to simulate CNS events
    const channel = new BroadcastChannel('cns-devtools');

    // Simulate some neural network activity
    setInterval(() => {
        const event = {
            kind: 'enqueue',
            spikeId: `spike-${Date.now()}`,
            toType: 'output',
            hops: Math.floor(Math.random() * 3),
            t: Date.now(),
        };

        channel.postMessage(event);
        console.log('Sent event:', event);
    }, 2000);

    return { panel, channel };
}

// Example with CNS integration (when you have the full CNS setup):
/*
import { CNS } from '@cnstra/core';
import { MicrogliaTrace, AstrogliaMeta } from '@cnstra/glia';
import { CNSDevToolsPanel } from '@cnstra/devtools-panel';

export function createCNSWithVisualization() {
  // Create CNS with tracing enabled
  const cns = new CNS(afferentAxon, neurons)
    .use(MicrogliaTrace('cns-devtools'));

  // Add metadata to neurons for better visualization
  cns.useFor(neuronA, AstrogliaMeta({ 
    label: 'Input Neuron', 
    group: 'input', 
    color: '#7fffd4', 
    layer: 0 
  }));

  cns.useFor(neuronB, AstrogliaMeta({ 
    label: 'Process Neuron', 
    group: 'compute', 
    color: '#ff7f7f', 
    layer: 1 
  }));

  cns.useFor(neuronC, AstrogliaMeta({ 
    label: 'Output Neuron', 
    group: 'output', 
    color: '#7f7fff', 
    layer: 2 
  }));

  // Create and mount devtools panel
  const panel = new CNSDevToolsPanel({
    channelName: 'cns-devtools',
    width: 1200,
    height: 800
  });

  document.body.appendChild(panel.render());

  // Now when you stimulate the network, you'll see live visualization!
  cns.stimulate('input', { data: 42 });

  return { cns, panel };
}
*/
