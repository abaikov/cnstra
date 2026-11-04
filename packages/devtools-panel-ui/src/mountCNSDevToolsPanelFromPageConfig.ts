import { composeExoPlugins } from '@exodra/core';
import { ExoDomBackend, withExoChildList, withExoCompiler, withExoForeignNamespaces } from '@exodra/dom';
import { EXO_KEYED_LIST_VOCABULARY } from '@exodra/list-reconcile';
import { OIMExodraPlugin } from '@oimdb/exodra';
import './theme/theme.css';
import './theme/panel.css';
import './theme/status.css';
import './theme/primitives.css';
import './view/diagram/diagram.css';
import './view/graphs/graphs.css';
import './view/lists/lists.css';
import './view/scheduled/scheduled.css';
import './view/launch/launch.css';
import './view/explorer/explorer.css';
import './view/filters/filters.css';
import './view/details/details.css';
import { createCNSDevToolsSocket } from './transport/socket';
import { CNSExplorerActionClient } from './transport/CNSExplorerActionClient';
import { createDevTools } from './model/createDevTools';
import { createCNSHashExplorerAddress } from './model/createCNSHashExplorerAddress';
import { createCNSMemoryExplorerAddress } from './model/createCNSMemoryExplorerAddress';
import { createDevToolsSyncTransport } from './transport/createDevToolsSyncTransport';
import { devToolsTransportAxon } from './model/axons/devToolsTransportAxon';
import { explorerMachine } from './view/explorer/explorerMachine';
import type { TCNSDevToolsPageConfig } from './types/TCNSDevToolsPageConfig';
import type { TCNSDevToolsPanelMount } from './types/TCNSDevToolsPanelMount';
import type { TCNSDevToolsTransportFactory } from './types/TCNSDevToolsTransportFactory';

const PANEL_CLASS_NAME = 'cns-devtools';

export function mountCNSDevToolsPanelFromPageConfig(element: HTMLElement, pageConfig: TCNSDevToolsPageConfig, createDemoTransport?: TCNSDevToolsTransportFactory): TCNSDevToolsPanelMount {
    const isPanelClassAdded = !element.classList.contains(PANEL_CLASS_NAME);
    if (isPanelClassAdded) element.classList.add(PANEL_CLASS_NAME);
    const socket = createCNSDevToolsSocket(pageConfig, createDemoTransport);
    const syncTransport = createDevToolsSyncTransport(socket, pageConfig.httpUrl);
    const devTools = createDevTools({
        batchTransduceFn: syncTransport.batchTransduceFn,
        actionClient: new CNSExplorerActionClient(socket),
        transportKind: socket.transportKind,
        isReadOnly: pageConfig.isReadOnly,
        createExplorerAddress: pageConfig.location === 'memory' ? createCNSMemoryExplorerAddress : createCNSHashExplorerAddress,
        db: pageConfig.db,
    });
    socket.connect({
        onStatus: status => {
            if (status !== 'connected') syncTransport.failPendingRequests(new Error(`the devtools connection is ${status}`));
            devTools.cns.stimulate(devToolsTransportAxon.connectionChanged.createSignal({ status }));
        },
        onUiConfig: uiConfig => devTools.cns.stimulate(devToolsTransportAxon.uiConfigReceived.createSignal({ uiConfig })),
    });
    const removeResponseListener = devTools.cns.addResponseListener(response => {
        // eslint-disable-next-line no-console
        if (response.error) console.error('[CNStra devtools] neuron response error:', response.error);
    });
    const exodraPlugin = new OIMExodraPlugin({ db: devTools.db });
    const backend = composeExoPlugins(withExoChildList(withExoForeignNamespaces(withExoCompiler(new ExoDomBackend()))), EXO_KEYED_LIST_VOCABULARY, {
        exodraPlugin: () => exodraPlugin,
        devTools: () => devTools,
        cns: () => devTools.cns,
    });
    const unrender = backend.render(explorerMachine, element);
    const renderedNode = element.lastChild;
    return {
        unmount: () => {
            unrender();
            renderedNode?.remove();
            socket.dispose();
            syncTransport.failPendingRequests(new Error('the devtools panel is unmounted'));
            removeResponseListener();
            devTools.dispose();
            if (isPanelClassAdded) element.classList.remove(PANEL_CLASS_NAME);
        },
    };
}
