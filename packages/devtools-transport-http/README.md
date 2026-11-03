# @cnstra/devtools-transport-http

HTTP long-polling transport for CNStra DevTools — the app side.

`@cnstra/devtools-transport-ws` is the default and stays the default. This is the
fallback for a network that will not carry a WebSocket upgrade: an ingress with
upgrades off, a proxy that strips them, a platform that cuts long-lived
connections. The protocol is unchanged — the exact frames that would have gone
over the socket go over three plain HTTP verbs against one endpoint served by
`@cnstra/devtools-server`:

```
POST   <url>/__cnstra/poll?sessionId=…   one protocol message; answers 204
GET    <url>/__cnstra/poll?sessionId=…   {"messages": string[]}; parks up to ~25s
DELETE <url>/__cnstra/poll?sessionId=…   drops the session
```

## Usage

```ts setup
import type { CNS } from '@cnstra/core';
import type { TCNSNeuron } from '@cnstra/types';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';

declare const cns: CNS<TCNSNeuron>;
declare const registry: CNSPersistOptionsRegistry;
```

```ts
import { CNSDevTools } from '@cnstra/devtools';
import { CNSDevToolsTransportHttp } from '@cnstra/devtools-transport-http';

const transport = new CNSDevToolsTransportHttp({ url: 'http://localhost:8080' });
const devtools = new CNSDevTools('my-app', transport, { appName: 'My App' });
devtools.registerCNS(cns, registry);

// on shutdown
transport.close();
```

## Options

| option | default | meaning |
| --- | --- | --- |
| `url` | — | DevTools server base URL, e.g. `http://localhost:8080` |
| `fetchImpl` | `globalThis.fetch` | `fetch` implementation, for a runtime without one (Node < 18) or for tests |
| `sessionId` | minted | the key the server files this app's mailbox under; one per transport instance |
| `pollIntervalMs` | `1000` | base delay before retrying a **failed** request; doubles per consecutive failure, capped at 15s |
| `consoleLogEnabled` | `false` | log send/poll failures and invalid messages |

## Behaviour

- The receive loop starts lazily — on the first `sendBatch` or the first
  `onStimulationCommand` subscription — and runs until `close()`. The server sweeps a session that stops polling after ~60s, so the
  loop must keep going for as long as the transport is alive.
- Because the server parks the `GET`, a new one is issued immediately after each
  answer. An idle app is one open request, not a request loop.
- A failed request backs off and the loop survives it: the server may simply be
  restarting. A failed `sendBatch` keeps its items for the next send and never
  throws out into the host app.
- Received messages are routed by `type`: `cns.stimulation.resume` /
  `cns.stimulation.launch` go to `onStimulationCommand`. Each is validated
  against the DTO schema first, exactly as over the socket.
