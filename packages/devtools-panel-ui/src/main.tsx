import { mount } from '@exodra/dom';
import { createRouter } from '@exodra/router';
import { mainCNS } from './cns';
import './ui/theme.css';
import './ui/components.css';
import './ui/styles.css';
import { createHashHistory } from './exo/hash-history';
import { routes } from './app/routes';
import { createDevtoolsSocket } from './app/controllers/socket';
import { createAppSelection } from './app/controllers/selection';
import { createShell } from './app/shell';

// Client-only bootstrap (no SSR): hash-history router (electron loads over
// file://), the WebSocket + selection controllers, then mount the shell. The
// data layer (mainCNS + OIMDB) is imported transitively via the controllers and
// runs unchanged from the React version.
// The panel ingests the WS stream into its own `mainCNS` fire-and-forget
// (`stimulate(...)` without awaiting `waitUntilComplete()` or passing onResponse).
// A throwing data-layer neuron response (e.g. an OIMDB write rejected during
// queue.flush) is caught by cnstra and rides `response.error`, but with no
// listener the fast path skips building the response entirely → silent. One
// global listener surfaces every ingestion failure. No core change needed.
mainCNS.addResponseListener(r => {
    if (r.error) {
        // eslint-disable-next-line no-console
        console.error('[CNStra ingest] neuron response error:', r.error);
    }
});

const root = document.getElementById('root');
if (root) {
    const router = createRouter(routes, { history: createHashHistory() });
    const socket = createDevtoolsSocket();
    const selection = createAppSelection({ router });

    // The Explorer IS the whole tool and lives at the ROOT `/` — no landing page,
    // no redirect. A bare reload (empty hash → pathname '/') lands right here, and
    // a legacy `#/explorer?…` link still resolves via the alias route.
    mount(createShell({ router, socket, selection }), root);
}
