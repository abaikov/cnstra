# 🚀 CNStra DevTools Complete Example

**Complete working example** showing CNStra DevTools in action:
- ✅ **DevTools Server** using our `@cnstra/devtools-server` 
- ✅ **DevTools UI Panel** using our `@cnstra/devtools-panel-ui`
- ✅ **Example CNS App** with DevTools integration
- ✅ **Real-time monitoring** of CNS signals and topology

📚 **[Full Documentation](https://cnstra.org/)** | [DevTools Guide](https://cnstra.org/docs/devtools/overview) | [Backend Examples](https://cnstra.org/docs/examples/runnable)

## What This Demonstrates

### **🎯 CNS Application**
Simple ping-pong app with two neurons:
- **`ping-service`** - receives messages and logs them
- **`logger-service`** - outputs logs with timestamps

### **🔧 DevTools Integration**
- App connects to DevTools server via WebSocket
- Real-time topology discovery
- Live monitoring of signal flow
- Modern React + Pixi.js UI

### **📦 Our Packages in Action**
- `@cnstra/devtools` - DevTools client integration
- `@cnstra/devtools-server` - Server handling all protocols
- `@cnstra/devtools-panel-ui` - Modern web interface
- `@cnstra/devtools-transport-ws` - WebSocket communication

## 🎬 Quick Start

**Working demo (ready to run):**

```bash
# Build and start everything
npm run build --workspace=@cnstra/example-app
npm run demo:standalone --workspace=@cnstra/example-app
```

This will:
1. ✅ Start standalone DevTools server on port 8080
2. ✅ Start example CNS app with DevTools enabled  
3. ✅ Run demo scenarios every 5 seconds
4. ✅ Show real-time communication in terminal

**Watch terminal output to see DevTools protocol in action!**

## What You'll See

### **📊 Terminal Output (DevTools Server)**
```bash
🚀 Standalone DevTools Server started on ws://localhost:8080
📡 New connection
📨 Received: init
✅ App registered: Simple CNS App
📊 Topology: 2 neurons, 2 collaterals
📡 New connection
📨 Received: neuron-response-batch
📦 Response batch: 2 responses
```

### **📊 Terminal Output (Example App)**
```bash
🚀 Simple CNS app started with DevTools enabled
🔗 Connected to DevTools server

🎭 Running demo scenarios...
📨 Received ping: Hello CNS!
📝 [2024-01-15T10:30:45.123Z] INFO: Ping received: Hello CNS!
📨 Received ping: DevTools test message  
📝 [2024-01-15T10:30:45.456Z] DEBUG: Direct log message from demo

✨ Demo completed! Check DevTools for activity.
```

### **🎭 Demo Activity**
The app runs demo scenarios every 5 seconds:
1. **Ping Message**: "Hello CNS!"
2. **Ping Message**: "DevTools test message"  
3. **Direct Log**: Debug level message

Each triggers CNS signals sent to DevTools server!

## Sample Terminal Output

**DevTools Server:**
```bash
🚀 DevTools Server started:
   📡 WebSocket: ws://localhost:8080
   🌐 DevTools UI: http://localhost:8080
📡 New WebSocket connection
🖥️ DevTools client connected
📡 New WebSocket connection
📨 Received message: init
✅ App connected: Simple CNS App (example-app)
📊 Topology: 2 neurons, 2 collaterals, 2 dendrites
📨 Received message: neuron-response-batch
📦 Response batch: 2 responses
```

**Example App:**
```bash
🚀 Simple CNS app started with DevTools enabled
📡 Connect to ws://localhost:8080 for DevTools
🔗 Connected to DevTools server

🎭 Running demo scenarios...
📨 Received ping: Hello CNS!
📝 [2024-01-15T10:30:45.123Z] INFO: Ping received: Hello CNS!
📨 Received ping: DevTools test message  
📝 [2024-01-15T10:30:45.456Z] INFO: Ping received: DevTools test message
📝 [2024-01-15T10:30:45.789Z] DEBUG: Direct log message from demo

✨ Demo completed! Check DevTools for activity.
```

## Architecture Overview

```
┌─────────────────┐    WebSocket    ┌──────────────────┐
│   Example App   │◄──────────────►│ DevTools Server  │
│                 │                 │                  │
│ ┌─────────────┐ │                 │ ┌──────────────┐ │
│ │ ping-service│ │                 │ │ Repository   │ │
│ └─────────────┘ │                 │ │ (in-memory)  │ │
│ ┌─────────────┐ │                 │ └──────────────┘ │
│ │logger-service│ │                 └──────────────────┘
│ └─────────────┘ │                           │
└─────────────────┘                           │ HTTP
                                               ▼
                                    ┌──────────────────┐
                                    │  DevTools UI     │
                                    │  (React + Pixi)  │
                                    │  localhost:8080  │
                                    └──────────────────┘
```

## Manual Setup

If you prefer step-by-step:

1. **Build all packages:**
   ```bash
   npm run build:example
   ```

2. **Start DevTools server:**
   ```bash
   npm run start:server --workspace=@cnstra/example-app
   ```

3. **Open browser:**
   ```
   http://localhost:8080
   ```

4. **Start example app:**
   ```bash
   npm run start --workspace=@cnstra/example-app
   ```

## Code Highlights

```ts setup
import type { WebSocket } from 'ws';
import type { CNS } from '@cnstra/core';
import type { TCNSNeuron } from '@cnstra/types';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import { CNSDevToolsServer } from '@cnstra/devtools-server';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';
import { CNSDevTools } from '@cnstra/devtools';
import { CNSDevToolsTransportWs } from '@cnstra/devtools-transport-ws';

declare const ws: WebSocket;
declare const message: unknown;
declare const cns: CNS<TCNSNeuron<any>>;
declare const registry: CNSPersistOptionsRegistry;
```

### **DevTools Server (3 lines!)**
```typescript
const repository = new CNSDevToolsServerRepositoryInMemory();
const devToolsServer = new CNSDevToolsServer(repository);
await devToolsServer.handleMessage(ws, message);
```

### **App Integration (3 lines!)**
```typescript
const transport = new CNSDevToolsTransportWs({ url: 'ws://localhost:8080' });
const devtools = new CNSDevTools('ecommerce-app', transport, { appName: 'E-commerce Demo App' });
devtools.registerCNS(cns, registry);
```

**That's it!** Our packages handle all the complexity.
