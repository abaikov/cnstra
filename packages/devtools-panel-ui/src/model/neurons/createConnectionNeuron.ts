import { neuron } from '@cnstra/core';
import { connectionAxon } from '../axons/connectionAxon';
import { devToolsTransportAxon } from '../axons/devToolsTransportAxon';
import type { TCNSDevToolsConnection } from '../types/TCNSDevToolsConnection';
import type { TCNSHeldEntitySingle } from '../types/TCNSHeldEntitySingle';

export function createConnectionNeuron(options: { connection: TCNSHeldEntitySingle<TCNSDevToolsConnection>; initialConnection: TCNSDevToolsConnection }) {
    const currentConnection = (): TCNSDevToolsConnection => options.connection.getSingleSlot().entity ?? options.initialConnection;
    return neuron(connectionAxon)
        .dendrite({
            collateral: devToolsTransportAxon.connectionChanged,
            response: ({ status }, axon) => {
                options.connection.writeSingleSlotContent({ ...currentConnection(), status, isOnline: status === 'connected' });
                return axon.connectionStatusChanged.createSignal({ status });
            },
        })
        .dendrite({
            collateral: devToolsTransportAxon.uiConfigReceived,
            response: ({ uiConfig }, axon) => {
                options.connection.writeSingleSlotContent({ ...currentConnection(), uiConfig });
                return axon.uiConfigApplied.createSignal({ uiConfig });
            },
        });
}
