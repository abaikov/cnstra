import { neuron } from '@cnstra/core';
import { appModelAxon } from '../../controller-layer/AppModelAxon';
import { db, dbEventQueue } from '../../../model';
import type { UIHop } from '../../../model';

// Bound memory: cap retained hops per app.
const MAX_HOPS_PER_APP = 5000;
const HOP_TTL_MS = 5 * 60 * 1000;

function cleanupOldHops(appId: string): void {
    const pks = Array.from(db.responses.indexes.appId.getPksByKey(appId));
    const appHops = db.responses
        .getManyByPks(pks)
        .sort((a, b) => b.startedAt - a.startedAt);

    const now = Date.now();
    const toRemove: UIHop[] = [];
    for (const h of appHops) {
        if (now - h.startedAt > HOP_TTL_MS) toRemove.push(h);
    }
    if (appHops.length > MAX_HOPS_PER_APP) {
        for (const h of appHops.slice(MAX_HOPS_PER_APP)) {
            if (!toRemove.includes(h)) toRemove.push(h);
        }
    }
    if (toRemove.length > 0) db.responses.removeMany(toRemove);
}

/** Persists hops (the per-neuron steps of a stimulation). */
export const responsesNeuron = neuron({}).dendrite({
    collateral: appModelAxon.hopAdded,
    response: hop => {
        db.responses.upsertOne(hop);
        cleanupOldHops(hop.appId);
        dbEventQueue.flush();
    },
});
