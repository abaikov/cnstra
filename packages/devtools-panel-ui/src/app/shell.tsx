import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import type { TExoRouter } from '@exodra/router';
import type { DevtoolsSocket } from './controllers/socket';
import type { AppSelection } from './controllers/selection';
import { CNSExplorerWsClient } from '../explorer/explorerClient';
import { createExplorerController } from '../explorer/explorerController';
import { explorerPage } from '../explorer/ExplorerPage';

// The native Exodra shell. The DevTools panel is now a single surface: the faceted
// Explorer (an observability / runs viewer). The old left sidebar (connected-apps
// cards, connection block, debug panels, nav buttons) and the cytoscape Network
// Topology graph have been removed — identity + connection health are folded into
// the Explorer's top bar, and the Explorer is the only main view (no landing page,
// no nav click).

export interface CreateShellParams {
    router: TExoRouter;
    socket: DevtoolsSocket;
    selection: AppSelection;
}

export function createShell({
    router,
    socket,
    selection,
}: CreateShellParams): TExoSchema {
    // Faceted explorer (bucket protocol): scale-first roster + facets + waterfall +
    // chart + retry/clone; its query-state ⇄ the URL so slices are shareable.
    const explorerCtrl = createExplorerController(
        new CNSExplorerWsClient(socket),
        {
            // The router uses HASH history, so the query lives in the hash
            // ("#/explorer?st=…"), NOT window.location.search — read it from there
            // or a reload restores nothing (empty details, lost breadcrumb).
            readSearch: () => {
                if (typeof window === 'undefined') return '';
                const h = window.location.hash;
                const i = h.indexOf('?');
                return i >= 0 ? h.slice(i) : '';
            },
            // Canonical URL is the root `#/?…` (the `/explorer` segment is gone).
            writeSearch: s => void router.navigate('/' + (s ? `?${s}` : '')),
        }
    );

    // The server pushes its switches on connect, which is after this controller
    // exists — so follow the socket's copy rather than reading it once.
    socket.uiConfig.subscribe(config => {
        explorerCtrl.allowedActions.setValue(config.actions ?? {});
        // Only when the user has not already chosen a range: the config is the
        // OPENING view, not a cage.
        explorerCtrl.applyDefaultWindow(config.defaultWindowMs);
    });

    // Connected-app name for the top-bar identity block (the health indicator the
    // old sidebar owned). Tracks the effective selection over the connected set.
    const appName = bindable('');
    const recomputeName = (): void => {
        const id = selection.effectiveSelectedAppId.getValue();
        const app = selection.connectedApps.getValue().find(a => a.id === id);
        appName.setValue(app?.name || '');
    };
    selection.effectiveSelectedAppId.subscribe(recomputeName);
    selection.connectedApps.subscribe(recomputeName);
    recomputeName();

    const explorerPane = explorerPage(explorerCtrl, {
        connectionStatus: socket.connectionStatus,
        transport: socket.transport,
        appName,
    });

    return (
        <div
            static={{
                style: 'display:flex;height:100vh;width:100vw;font-family:var(--font-body);background:var(--bg-primary);color:var(--text-primary)',
            }}
        >
            <div
                static={{
                    style: 'flex:1;display:flex;flex-direction:column;background:var(--bg-primary);border:1px solid var(--border-primary);overflow:hidden',
                    children: [explorerPane],
                }}
            />
        </div>
    );
}
