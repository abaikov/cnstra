import type { TExoSchema } from '@exodra/core';
import { derive } from '@exodra/reactivity';
import type { TExoRouter } from '@exodra/router';
import { sidebarView } from '../ui/Sidebar';
import { topologyView } from '../ui/TopologyView';
import { isExplorerPath } from './routes';
import type { DevtoolsSocket } from './controllers/socket';
import type { AppSelection } from './controllers/selection';
import { CNSExplorerWsClient } from '../explorer/explorerClient';
import { createExplorerController } from '../explorer/explorerController';
import { explorerPage } from '../explorer/ExplorerPage';

// The native Exodra shell: the flex layout that was `AppInner` in the old React
// App.tsx. Two main panes: the Topology graph (React island) and the faceted
// Explorer (native Exodra) — the single stimulation UI (roster · facets · chart ·
// map · waterfall · retry/clone). The legacy nested-view Stimulations pages are
// retired; the Explorer's bucket protocol is the one stimulation surface.

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
    const { effectiveSelectedAppId } = selection;

    // Main-pane views built once (stable refs) so switching by route reuses DOM.
    const topoPane = topologyView(effectiveSelectedAppId);
    // Faceted explorer (bucket protocol): scale-first roster + facets + waterfall +
    // retry/clone; its query-state ⇄ the URL so slices are shareable.
    const explorerCtrl = createExplorerController(
        new CNSExplorerWsClient(socket),
        {
            readSearch: () =>
                typeof window !== 'undefined' ? window.location.search : '',
            writeSearch: s =>
                void router.navigate('/explorer' + (s ? `?${s}` : '')),
        }
    );
    const explorerPane = explorerPage(explorerCtrl);
    const mainChild = derive(router.location, loc =>
        isExplorerPath(loc.pathname) ? explorerPane : topoPane
    );

    return (
        <div
            static={{
                class: 'no-smooth pixel-perfect',
                style: 'display:flex;height:100vh;width:100vw;font-family:var(--font-primary);background:var(--bg-primary);color:var(--text-primary)',
            }}
        >
            <div static={{ children: [sidebarView({ router, socket, selection })] }} />
            <div
                static={{
                    style: 'flex:1;display:flex;flex-direction:column;background:var(--bg-primary);border:1px solid var(--border-primary);overflow:hidden',
                }}
                bindable={{ children: mainChild }}
            />
        </div>
    );
}
