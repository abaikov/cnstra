import { neuron } from '@cnstra/core';
import { appModelAxon } from '../../controller-layer/AppModelAxon';
import { db, dbEventQueue } from '../../../model';

/** Persists a topology's collaterals. */
export const collateralNeuron = neuron({}).dendrite({
    collateral: appModelAxon.topologyReceived,
    response: topo => {
        if (topo.collaterals.length > 0) {
            db.collaterals.upsertMany(topo.collaterals);
            dbEventQueue.flush();
        }
    },
});
