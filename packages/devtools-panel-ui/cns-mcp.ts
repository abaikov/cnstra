import { CNSPersistOptionsRegistryFactory } from '@cnstra/persist';
import { startCNSMCPServer } from '@cnstra/mcp';
import { createDevTools } from './src/model/createDevTools';
import { devToolsTransportAxon } from './src/model/axons/devToolsTransportAxon';
import { explorerUiAxon } from './src/model/axons/explorerUiAxon';

const refuseWithoutConnection = async (): Promise<never> => {
    throw new Error('the devtools panel graph is served to an AI tool without a devtools connection');
};

const devTools = createDevTools({
    transportKind: 'socket',
    batchTransduceFn: async requests => requests.map(({ name, key }) => ({ name, key, error: new Error(`not served: ${name}`) })),
    actionClient: {
        retry: refuseWithoutConnection,
        clone: refuseWithoutConnection,
        command: refuseWithoutConnection,
        launch: refuseWithoutConnection,
    },
});

const registry = CNSPersistOptionsRegistryFactory.create({ ...devTools.neurons, explorerUiAxon, devToolsTransportAxon });

void startCNSMCPServer(devTools.cns, registry, {
    name: 'cnstra-devtools-panel',
});
