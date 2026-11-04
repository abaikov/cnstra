import { defineCNSHomeostatModel } from '@cnstra/sync';
import type { TCNSDevToolsReceptors } from './types/TCNSDevToolsReceptors';
import { topologyAxon } from './axons/topologyAxon';
import { KEEP_SYNCED_DATA_AFTER_IDLE_MS } from './constants/KEEP_SYNCED_DATA_AFTER_IDLE_MS';

export function defineTopologyModel(homeostatReceptors: TCNSDevToolsReceptors) {
    return defineCNSHomeostatModel(topologyAxon)
        .homeostatReceptor('apps', {
            homeostatReceptor: homeostatReceptors.apps,
            summaryOf: apps => apps,
            keepAfterIdleMs: KEEP_SYNCED_DATA_AFTER_IDLE_MS,
            afterWrite: ({ key: [scopeName] }, axon) => axon.appsChanged.createSignal({ scopeName }),
        })
        .homeostatReceptor('topology', {
            homeostatReceptor: homeostatReceptors.topology,
            summaryOf: topology => topology,
            keepAfterIdleMs: KEEP_SYNCED_DATA_AFTER_IDLE_MS,
            afterWrite: ({ key: [scopeName] }, axon) => axon.topologyChanged.createSignal({ scopeName }),
        });
}
