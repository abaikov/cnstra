import { neuron } from '@cnstra/core';
import { db, dbEventQueue } from '../../../model';
import { appModelAxon } from '../../controller-layer/AppModelAxon';

/**
 * Persists the CNS + neurons of a topology, and maintains each neuron's
 * denormalized `stimulationCount` from the hop stream (graph node sizing).
 */
export const neuronNeuron = neuron({})
    .dendrite({
        collateral: appModelAxon.topologyReceived,
        response: topo => {
            db.cns.upsertOne({ cnsId: topo.cnsId, appId: topo.appId });
            for (const n of topo.neurons) {
                // Preserve any accumulated metric across topology re-sends.
                const prev = db.neurons.getOneByPk(n.id);
                db.neurons.upsertOne({
                    ...n,
                    stimulationCount: prev?.stimulationCount,
                });
            }
            dbEventQueue.flush();
        },
    })
    .dendrite({
        collateral: appModelAxon.hopAdded,
        response: hop => {
            const n = db.neurons.getOneByPk(hop.neuronId);
            if (!n) return;
            db.neurons.upsertOne({
                ...n,
                stimulationCount: (n.stimulationCount ?? 0) + 1,
            });
            dbEventQueue.flush();
        },
    });
