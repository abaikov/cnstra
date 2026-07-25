import type { TExoSchema } from '@exodra/core';
import { bindable, derive } from '@exodra/reactivity';
import { reactIsland } from '@exodra/react';
import type { TExoRouter } from '@exodra/router';
import { sidebarView } from '../ui/Sidebar';
import { topologyView } from '../ui/TopologyView';
import StimulationsPage from '../ui/StimulationsPage';
import { isStimulationsPath } from './routes';
import type { DevtoolsSocket } from './controllers/socket';
import type { AppSelection } from './controllers/selection';

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
}

export function createShell({
    router,
    socket,
    selection,
}: CreateShellParams): TExoSchema {
    const { effectiveSelectedAppId, selectedCnsId } = selection;

    // ── Stimulations pane is still a React island; Topology is native. ───────
    const stimProps = bindable<{
        appId: string;
        wsRef: DevtoolsSocket['wsRef'];
        cnsId: string | null;
    }>({
        appId: effectiveSelectedAppId.getValue() ?? '',
        wsRef: socket.wsRef,
        cnsId: selectedCnsId.getValue(),
    });
    const refreshMainProps = (): void => {
        stimProps.setValue({
            appId: effectiveSelectedAppId.getValue() ?? '',
            wsRef: socket.wsRef,
            cnsId: selectedCnsId.getValue(),
        });
    };
    effectiveSelectedAppId.subscribe(refreshMainProps);
    selectedCnsId.subscribe(refreshMainProps);

    // Build both panes once (stable refs) so switching by route reuses DOM.
    const topoPane = topologyView(effectiveSelectedAppId);
    const stimIsland = reactIsland(StimulationsPage, stimProps);
    const mainChild = derive(router.location, loc =>
        isStimulationsPath(loc.pathname) ? stimIsland : topoPane
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
