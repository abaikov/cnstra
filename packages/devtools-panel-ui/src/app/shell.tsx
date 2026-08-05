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
            readSearch: () =>
                typeof window !== 'undefined' ? window.location.search : '',
            writeSearch: s =>
                void router.navigate('/explorer' + (s ? `?${s}` : '')),
        }
    );

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
