import { neuron } from '@cnstra/core';
import { db } from '../../../model';
import { OIMReactiveIndexManual } from '@oimdb/core';
import { appModelAxon } from '../../controller-layer/AppModelAxon';
import { Stimulation } from '@cnstra/devtools-dto';

// Configuration for data retention
const MAX_STIMULATIONS_PER_APP = 5000;
const STIMULATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cleanup old stimulations to prevent unbounded memory growth
function cleanupOldStimulations(appId: string) {
    const allStimulations = db.stimulations.collection.getAll();
    const appStimulations = allStimulations
        .filter((s: any) => s.appId === appId)
        .sort((a: any, b: any) => b.timestamp - a.timestamp);

    const now = Date.now();
    const toRemove: Stimulation[] = [];

    // Remove by TTL
    for (const stim of appStimulations) {
        if (now - stim.timestamp > STIMULATION_TTL_MS) {
            toRemove.push(stim);
        }
    }

    // Remove by count limit (keep only most recent)
    if (appStimulations.length > MAX_STIMULATIONS_PER_APP) {
        const excess = appStimulations.slice(MAX_STIMULATIONS_PER_APP);
        for (const stim of excess) {
            if (!toRemove.includes(stim)) {
                toRemove.push(stim);
            }
        }
    }

    if (toRemove.length > 0) {
        console.log(
            `🧹 Cleaning up ${toRemove.length} old stimulations for app ${appId}`
        );
        db.stimulations.collection.removeMany(toRemove);
        const stimIndex = db.stimulations.indexes
            .appId as OIMReactiveIndexManual<string, string>;
        stimIndex.removePks(
            appId,
            toRemove.map(element => element.stimulationId)
        );
    }
}

export const stimulationNeuron = neuron('stimulation-neuron', {}).bind(
    appModelAxon,
    {
        devtoolsInit: () => {},
        devtoolsResponseBatch: () => {},
        selectAppClicked: () => {},
        appsActive: () => {},
        appAdded: () => {},
        appDisconnected: () => {},
        stimulationBatch: (payload, axon) => {
            const message = payload as {
                type: 'stimulation-batch';
                stimulations: Array<{
                    type: 'stimulation';
                    appId: string;
                    stimulationId: string;
                    timestamp: number;
                    neuronId: string;
                    collateralName: string;
                    payload?: unknown;
                    queueLength: number;
                    hops?: number;
                    error?: unknown;
                }>;
            };
            // Removed verbose logging - too frequent

            for (const stimulation of message.stimulations) {
                // Debug log for replay stimulations
                if (
                    typeof stimulation.stimulationId === 'string' &&
                    stimulation.stimulationId.includes('-replay-')
                ) {
                    console.log(
                        '🔁 [StimulationNeuron] Processing REPLAY stimulation:',
                        {
                            stimulationId: stimulation.stimulationId,
                            appId: stimulation.appId,
                            neuronId: stimulation.neuronId,
                            collateralName: stimulation.collateralName,
                            timestamp: stimulation.timestamp,
                        }
                    );
                }
                // Validate and warn about missing data
                if (
                    !stimulation.neuronId ||
                    stimulation.neuronId === 'unknown'
                ) {
                    console.error(
                        '❌ StimulationNeuron: Received stimulation with missing/unknown neuronId! ' +
                            'DevTools metrics will be INACCURATE. ' +
                            'Fix CNS core to include proper neuron metadata in responses.',
                        {
                            stimulation,
                            hint: 'Check @cnstra/devtools package response listener - it should extract neuronId from outputSignal',
                        }
                    );
                }
                if (
                    !stimulation.collateralName ||
                    stimulation.collateralName === 'unknown'
                ) {
                    console.error(
                        '❌ StimulationNeuron: Received stimulation with missing/unknown collateralName! ' +
                            'DevTools metrics will be INACCURATE. ' +
                            'Fix CNS core to include proper collateral information in signals.',
                        {
                            stimulation,
                            hint: 'Check @cnstra/devtools package response listener - it should extract collateralName from signals',
                        }
                    );
                }

                // Store stimulation in database (with fallback to allow telemetry)
                db.stimulations.upsertOne({
                    stimulationId: stimulation.stimulationId,
                    appId: stimulation.appId,
                    cnsId: (stimulation as any).cnsId || stimulation.appId,
                    timestamp: stimulation.timestamp,
                    neuronId: stimulation.neuronId || 'unknown',
                    collateralName: stimulation.collateralName || 'unknown',
                    payload: stimulation.payload,
                });

                // Update indexes
                const stimulationAppIndex = db.stimulations.indexes
                    .appId as OIMReactiveIndexManual<string, string>;
                stimulationAppIndex.addPks(stimulation.appId, [
                    stimulation.stimulationId,
                ]);
            }

            // Run cleanup for each app that sent stimulations
            const affectedApps = new Set(
                message.stimulations.map(s => s.appId)
            );
            for (const appId of affectedApps) {
                cleanupOldStimulations(appId);
            }
        },
    }
);
