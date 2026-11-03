/**
 * @cnstra/mcp entry for the DevTools panel's OWN data-flow graph.
 *
 * The panel is itself a CNStra app: `mainCNS` ingests WebSocket frames and drives
 * them through neurons into the OIMDB apps collection. This exposes that graph to AI tools
 * (cns_get_graph / cns_list_neurons / cns_get_neuron) so the panel's data flows —
 * WS → appIngress → data-layer neurons → OIMDB — can be traced while developing it.
 *
 * Run: npx tsx cns-mcp.ts   (wired as the `cnstra` server in .mcp.json)
 */
import { CNSPersistOptionsRegistryFactory } from '@cnstra/persist';
import { startCNSMCPServer } from '@cnstra/mcp';
import { mainCNS } from './src/cns/index';
import { wsNeuron } from './src/cns/ws/WsNeuron';
import { appIngressNeuron } from './src/cns/controller-layer/AppIngressNeuron';
import { appsNeuron } from './src/cns/data-layer/app/AppsNeuron';

const registry = CNSPersistOptionsRegistryFactory.create({
    wsNeuron,
    appIngressNeuron,
    appsNeuron,
});

void startCNSMCPServer(mainCNS as never, registry, {
    name: 'cnstra-devtools-panel',
});
