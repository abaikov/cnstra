import { neuron } from '@cnstra/core';
import { db, dbEventQueue } from '../../../model';
import type { TStimulation } from '../../../model';
import { appModelAxon } from '../../controller-layer/AppModelAxon';

// Bound memory: cap retained stimulations per app.
const MAX_STIMULATIONS_PER_APP = 5000;
const STIMULATION_TTL_MS = 5 * 60 * 1000;

function cleanupOldStimulations(appId: string): void {
    const pks = Array.from(db.stimulations.indexes.appId.getPksByKey(appId));
    const appStimulations = db.stimulations
        .getManyByPks(pks)
        .sort((a, b) => b.startedAt - a.startedAt);

    const now = Date.now();
    const toRemove: TStimulation[] = [];
    for (const s of appStimulations) {
        if (now - s.startedAt > STIMULATION_TTL_MS) toRemove.push(s);
    }
    if (appStimulations.length > MAX_STIMULATIONS_PER_APP) {
        for (const s of appStimulations.slice(MAX_STIMULATIONS_PER_APP)) {
            if (!toRemove.includes(s)) toRemove.push(s);
        }
    }
    if (toRemove.length > 0) db.stimulations.removeMany(toRemove);
}

/** Persists stimulations and applies completion patches. */
export const stimulationNeuron = neuron({})
    .dendrite({
        collateral: appModelAxon.stimulationStarted,
        response: stimulation => {
            db.stimulations.upsertOne(stimulation);
            cleanupOldStimulations(stimulation.appId);
            dbEventQueue.flush();
        },
    })
    .dendrite({
        collateral: appModelAxon.stimulationCompleted,
        response: patch => {
            db.stimulations.upsertOneByPk(patch.stimulationId, {
                completedAt: patch.completedAt,
                hopCount: patch.hopCount,
                hasError: patch.hasError,
            });
            dbEventQueue.flush();
        },
    });
