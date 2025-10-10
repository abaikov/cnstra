---
id: devtools-overview
title: DevTools Overview
sidebar_label: Overview
sidebar_position: 2
slug: /devtools/overview
---

# CNStra DevTools

Powerful debugging and monitoring tools for CNStra applications. Visualize your neural network topology, inspect signal flows, and monitor performance in real-time.

## Features

### 🧠 Neural Network Visualization
- **Interactive Graph**: Explore your application's neural network as an interactive graph
- **Real-time Updates**: See neurons, collaterals, and connections update live
- **Topology Analysis**: Understand the structure and dependencies of your neural system

### 📊 Signal Flow Monitoring
- **Live Stimulation Tracking**: Watch signals propagate through your neural network
- **Response Inspection**: Examine payloads, context, and timing for each response
- **Queue Visualization**: Monitor signal queues and processing order

### 🔍 Advanced Debugging
- **Signal Filtering**: Filter by signal type, neuron, or time range
- **Context Inspection**: Deep dive into stimulation context and state
- **Performance Metrics**: Measure response times and identify bottlenecks
- **Error Tracking**: Catch and analyze errors in your neural network

### 🧪 Snapshots & Replay
- **Record Sessions**: Capture full stimulation sessions with inputs, responses, and context deltas
- **Deterministic Replay**: Re-run captured sessions to reproduce issues exactly
- **Shareable Artifacts**: Export/import snapshots for team debugging and CI reproduction

### 🚀 Multi-Instance Support
- **Server Manager**: Start/stop DevTools servers on custom ports
- **Multiple Apps**: Connect to multiple CNStra applications simultaneously
- **Cross-Platform**: Available for macOS, Windows, and Linux

## Quick Start

1. **Download** the DevTools application from the [Download page](/docs/devtools/download)
2. **Install** the DevTools package in your project:
   ```bash
   npm i -D @cnstra/devtools @cnstra/devtools-server @cnstra/devtools-transport-ws
   ```
3. **Configure** your application to connect to DevTools:
   ```ts
   import { CNSDevTools } from '@cnstra/devtools';
   import { CNSDevToolsTransportWs } from '@cnstra/devtools-transport-ws';

   const transport = new CNSDevToolsTransportWs({ 
     url: 'ws://localhost:8080' 
   });
   
   const devtools = new CNSDevTools('my-app', transport, {
     devToolsInstanceName: 'My App DevTools',
   });
   
   devtools.registerCNS(cns);
   ```
4. **Launch** DevTools and start debugging!

## Use Cases

- **Development**: Debug complex neural networks during development
- **Testing**: Verify signal flows and responses in test scenarios
- **Performance**: Identify bottlenecks and optimize neural network performance
- **Production Monitoring**: Monitor live applications (with appropriate security measures)

## Next Steps

- [Download DevTools](/docs/devtools/download) - Get the desktop application
- [Integration Guide](/docs/devtools/integration) - Learn how to integrate DevTools
- [Advanced Features](/docs/devtools/advanced) - Explore advanced debugging capabilities
