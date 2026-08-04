import { neuron } from '@cnstra/core';
import { db, dbEventQueue } from '../../../model';
import { appModelAxon } from '../../controller-layer/AppModelAxon';

/**
 * Persists the CNS + neurons of a topology. Per-neuron activity is NOT stored as a
 * counter — under the polling ingest every hop re-arrives each tick, so an
 * incrementing counter inflates without bound. The graph derives node size from
 * the live hop set (`buildGraphData`), and the details panel derives activity from
 * a neuron's own signals, so there is nothing to accumulate here.
 */
export const neuronNeuron = neuron({}).dendrite({
    collateral: appModelAxon.topologyReceived,
    response: topo => {
        db.cns.upsertOne({ cnsId: topo.cnsId, appId: topo.appId });
        for (const n of topo.neurons) db.neurons.upsertOne(n);
        dbEventQueue.flush();
    },
});
