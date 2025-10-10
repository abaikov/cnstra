---
id: devtools-integration
title: DevTools Integration
sidebar_label: Integration
sidebar_position: 3
slug: /devtools/integration
---

# DevTools Integration

Learn how to integrate CNStra DevTools into your application for debugging and monitoring.

## Basic Setup

### 1. Install Dependencies

```bash
npm i -D @cnstra/devtools @cnstra/devtools-server @cnstra/devtools-transport-ws
```

### 2. Configure Transport

Choose your preferred transport method:

#### WebSocket Transport (Recommended)
```ts
import { CNSDevToolsTransportWs } from '@cnstra/devtools-transport-ws';

const transport = new CNSDevToolsTransportWs({
  url: 'ws://localhost:8080'
});
```

#### HTTP Transport
```ts
import { CNSDevToolsTransportHttp } from '@cnstra/devtools-transport-http';

const transport = new CNSDevToolsTransportHttp({
  url: 'http://localhost:8080'
});
```

### 3. Initialize DevTools

```ts
import { CNSDevTools } from '@cnstra/devtools';

const devtools = new CNSDevTools('my-app', transport, {
  devToolsInstanceName: 'My App DevTools',
  // Optional: Enable performance monitoring
  enablePerformanceMonitoring: true,
  // Optional: Set log level
  logLevel: 'info'
});

// Register your CNS instance
devtools.registerCNS(cns);
```

## React Integration

For React applications, use the DevTools provider:

```tsx
import { CNSDevToolsProvider } from '@cnstra/react';
import { CNSDevToolsTransportWs } from '@cnstra/devtools-transport-ws';

const transport = new CNSDevToolsTransportWs({ url: 'ws://localhost:8080' });

function App() {
  return (
    <CNSDevToolsProvider 
      appName="my-react-app" 
      transport={transport}
      options={{ enablePerformanceMonitoring: true }}
    >
      <YourAppComponents />
    </CNSDevToolsProvider>
  );
}
```

## Node.js Integration

For Node.js applications:

```ts
import { CNSDevTools } from '@cnstra/devtools';
import { CNSDevToolsTransportWs } from '@cnstra/devtools-transport-ws';

// Only enable in development
if (process.env.NODE_ENV === 'development') {
  const transport = new CNSDevToolsTransportWs({ 
    url: 'ws://localhost:8080' 
  });
  
  const devtools = new CNSDevTools('my-api', transport);
  devtools.registerCNS(cns);
}
```

## Configuration Options

### DevTools Options

```ts
interface CNSDevToolsOptions {
  devToolsInstanceName?: string;           // Display name in DevTools
  enablePerformanceMonitoring?: boolean;   // Enable performance metrics
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  maxQueueSize?: number;                   // Max signals to keep in memory
  enableSignalFiltering?: boolean;         // Enable signal filtering
  customMetadata?: Record<string, any>;    // Custom app metadata
}
```

### Transport Options

#### WebSocket Transport
```ts
interface CNSDevToolsTransportWsOptions {
  url: string;                    // WebSocket server URL
  reconnectInterval?: number;     // Reconnection interval (ms)
  maxReconnectAttempts?: number; // Max reconnection attempts
  heartbeatInterval?: number;     // Heartbeat interval (ms)
}
```

#### HTTP Transport
```ts
interface CNSDevToolsTransportHttpOptions {
  url: string;                    // HTTP server URL
  pollInterval?: number;          // Polling interval (ms)
  timeout?: number;              // Request timeout (ms)
}
```

## Production Considerations

### Security
- Only enable DevTools in development environments
- Use secure WebSocket connections (wss://) in production
- Implement authentication if exposing DevTools publicly

### Performance
- DevTools add minimal overhead (~1-2ms per signal)
- Use `maxQueueSize` to limit memory usage
- Consider disabling in high-throughput applications

### Environment Variables
```bash
# Enable DevTools only in development
CNSTRA_DEVTOOLS_ENABLED=true
CNSTRA_DEVTOOLS_URL=ws://localhost:8080
CNSTRA_DEVTOOLS_APP_NAME=my-app
```

## Troubleshooting

### Connection Issues
- Ensure DevTools server is running
- Check firewall settings
- Verify WebSocket URL is correct

### Performance Issues
- Reduce `maxQueueSize` if memory usage is high
- Disable `enablePerformanceMonitoring` if not needed
- Use signal filtering to reduce data volume

### Common Errors
- `Connection refused`: DevTools server not running
- `Authentication failed`: Check server configuration
- `Memory limit exceeded`: Reduce `maxQueueSize`
