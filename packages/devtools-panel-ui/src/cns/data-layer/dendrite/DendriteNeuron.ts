import { neuron } from '@cnstra/core';
import { db, dbEventQueue } from '../../../model';
import { appModelAxon } from '../../controller-layer/AppModelAxon';

/** Persists a topology's dendrites. */
export const dendriteNeuron = neuron({}).dendrite({
    collateral: appModelAxon.topologyReceived,
    response: topo => {
        if (topo.dendrites.length > 0) {
            db.dendrites.upsertMany(topo.dendrites);
            dbEventQueue.flush();
        }
    },
});
