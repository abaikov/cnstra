/**
 * @cnstra/mcp entry for the DevTools panel's OWN data-flow graph.
 *
 * The panel is itself a CNStra app: `mainCNS` ingests WebSocket frames and drives
 * them through neurons into OIMDB collections. This exposes that graph to AI tools
 * (cns_get_graph / cns_list_neurons / cns_get_neuron) so the panel's data flows —
 * WS → appIngress → data-layer neurons → OIMDB — can be traced while developing it.
 *
 * Run: npx tsx cns-mcp.ts   (wired as the `cnstra` server in .mcp.json)
 */
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
import { startCNSMCPServer } from '@cnstra/mcp';
import { mainCNS } from './src/cns/index';
import { wsNeuron } from './src/cns/ws/WsNeuron';
import { appIngressNeuron } from './src/cns/controller-layer/AppIngressNeuron';
import { appsNeuron } from './src/cns/data-layer/app/AppsNeuron';
import { neuronNeuron } from './src/cns/data-layer/neuron/NeuronNeuron';
import { collateralNeuron } from './src/cns/data-layer/collateral/CollateralNeuron';
import { dendriteNeuron } from './src/cns/data-layer/dendrite/DendriteNeuron';
import { responsesNeuron } from './src/cns/data-layer/response/ResponsesNeuron';
import { stimulationNeuron } from './src/cns/data-layer/stimulation/StimulationNeuron';
import { uiStateNeuron } from './src/cns/data-layer/ui-state/UIStateNeuron';
import { wsAxon } from './src/cns/ws/WsAxon';
import { appModelAxon } from './src/cns/controller-layer/AppModelAxon';

const registry = new CNSPersistOptionsRegistry();

const neurons: Record<string, unknown> = {
    wsNeuron,
    appIngressNeuron,
    appsNeuron,
    neuronNeuron,
    collateralNeuron,
    dendriteNeuron,
    responsesNeuron,
    stimulationNeuron,
    uiStateNeuron,
};
for (const [name, n] of Object.entries(neurons))
    registry.register(name, n as never);

// Name the collaterals so the graph reads in domain terms.
for (const [name, c] of Object.entries(wsAxon))
    registry.registerCollateral(`ws:${name}`, c as never);
for (const [name, c] of Object.entries(appModelAxon))
    registry.registerCollateral(name, c as never);

void startCNSMCPServer(mainCNS as never, registry, {
    name: 'cnstra-devtools-panel',
});
