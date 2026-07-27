import type { TExoSchema } from '@exodra/core';
import { derive } from '@exodra/reactivity';
import type { TExoRouter } from '@exodra/router';
import { sidebarView } from '../ui/Sidebar';
import { topologyView } from '../ui/TopologyView';
import { durableRunsPage } from '../ui/DurableRunsPage';
import { isStimulationsPath, isDurablePath } from './routes';
import type { DevtoolsSocket } from './controllers/socket';
import type { AppSelection } from './controllers/selection';
import type { ICNSDurableRunsClient } from '../durable/ICNSDurableRunsClient';
import { CNSDurableRunsWsClient } from '../durable/CNSDurableRunsWsClient';

// The native Exodra shell: the flex layout that was `AppInner` in the old React
// App.tsx. The sidebar is now native Exodra; the two heavy main-pane views
// (Topology, Stimulations) are still React, hosted here as @exodra/react islands
// fed by reactive props bindables the controllers drive. Each island re-renders
// when its props emit — exactly React's model at the boundary. They get rewritten
// to native Exodra piece by piece; this shell/router/controller layer is Exodra.

export interface CreateShellParams {
    router: TExoRouter;
    socket: DevtoolsSocket;
    selection: AppSelection;
    durableClient: ICNSDurableRunsClient;
}

export function createShell({
    router,
    socket,
    selection,
    durableClient,
}: CreateShellParams): TExoSchema {
    const { effectiveSelectedAppId, selectedCnsId } = selection;

    // Main-pane views are native Exodra. Build once (stable refs) so switching by
    // route reuses DOM. The durable-runs admin polls only while it is the shown
    // pane (its onExoMount/onExoUnmount start/stop the poll).
    const topoPane = topologyView(effectiveSelectedAppId);
    // The Stimulations pane is the name-based Stimulation→Attempt→Task view (2b-3),
    // fed live from the devtools-server's durable store over the SAME socket, scoped
    // to the selected CNS. Observability only — no Launch; Retry/Clone go over 2b-2.
    const stimClient = new CNSDurableRunsWsClient(
        socket,
        () => selectedCnsId.getValue() ?? undefined
    );
    const stimPane = durableRunsPage(stimClient, {
        canLaunch: false,
        title: 'Stimulations',
        icon: '⚡',
    });
    const durablePane = durableRunsPage(durableClient);
    const mainChild = derive(router.location, loc =>
        isDurablePath(loc.pathname)
            ? durablePane
            : isStimulationsPath(loc.pathname)
              ? stimPane
              : topoPane
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
