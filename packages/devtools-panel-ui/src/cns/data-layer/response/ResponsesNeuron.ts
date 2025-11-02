import { neuron } from '@cnstra/core';
import { appModelAxon } from '../../controller-layer/AppModelAxon';
import { db, dbEventQueue } from '../../../model';
import type { TCollateral } from '../../../model';
import type {
    ResponseBatchMessage,
    NeuronResponseMessage,
    StimulationResponse,
} from '@cnstra/devtools-dto';
import { OIMReactiveIndexManual } from '@oimdb/core';

// Configuration for data retention
const MAX_RESPONSES_PER_APP = 5000;
const RESPONSE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cleanup old responses to prevent unbounded memory growth
function cleanupOldResponses(appId: string) {
    const allResponses = db.responses.collection.getAll();
    const appResponses = allResponses
        .filter((r: any) => r.appId === appId)
        .sort((a: any, b: any) => b.timestamp - a.timestamp);

    const now = Date.now();
    const toRemove: StimulationResponse[] = [];

    // Remove by TTL
    for (const resp of appResponses) {
        if (now - resp.timestamp > RESPONSE_TTL_MS) {
            toRemove.push(resp);
        }
    }

    // Remove by count limit (keep only most recent)
    if (appResponses.length > MAX_RESPONSES_PER_APP) {
        const excess = appResponses.slice(MAX_RESPONSES_PER_APP);
        for (const resp of excess) {
            if (!toRemove.includes(resp)) {
                toRemove.push(resp);
            }
        }
    }

    if (toRemove.length > 0) {
        console.log(
            `🧹 Cleaning up ${toRemove.length} old responses for app ${appId}`
        );
        db.responses.collection.removeMany(toRemove);
        const respIndex = db.responses.indexes.appId as OIMReactiveIndexManual<
            string,
            string
        >;
        respIndex.removePks(
            appId,
            toRemove.map(element => element.responseId)
        );
    }
}

export const responsesNeuron = neuron('responses-neuron', appModelAxon).bind(
    appModelAxon,
    {
        devtoolsInit: () => {},
        appsActive: () => {},
        appAdded: () => {},
        appDisconnected: () => {},
        selectAppClicked: () => {},
        stimulationBatch: () => {},
        devtoolsResponseBatch: payload => {
            const isResponseBatchMessage = (
                p: unknown
            ): p is ResponseBatchMessage =>
                !!p &&
                typeof p === 'object' &&
                Array.isArray((p as ResponseBatchMessage).responses);
            if (!isResponseBatchMessage(payload)) return;
            type ExtendedResponse = NeuronResponseMessage & {
                neuronPk?: string;
            };
            const responses = (payload.responses ||
                []) as Array<ExtendedResponse>;

            // Removed verbose logging - too frequent

            for (const r of responses) {
                const responseAppId = (r.appId as string) || 'unknown-app';
                const outColl = r.outputCollateralName;

                const stimId =
                    (r.stimulationId as string) ||
                    `auto:${responseAppId}:${r.timestamp}`;
                const respId = `${responseAppId}:resp:${stimId}:${r.timestamp}`;

                // Debug log for replay responses
                if (typeof stimId === 'string' && stimId.includes('-replay-')) {
                    console.log(
                        '🔁 [ResponsesNeuron] Processing REPLAY response:',
                        {
                            stimId,
                            responseAppId,
                            inputCollateralName: r.inputCollateralName,
                            outputCollateralName: r.outputCollateralName,
                            timestamp: r.timestamp,
                        }
                    );
                }

                // Also create stimulation from response (inputSignal is the stimulation)
                const inputColl = r.inputCollateralName;
                db.stimulations.upsertOne({
                    stimulationId: stimId,
                    appId: responseAppId,
                    timestamp: r.timestamp,
                    collateralName: inputColl,
                } as any);
                db.stimulations.indexes.appId.addPks(responseAppId, [stimId]);

                // store response only (topology comes from init)
                db.responses.collection.upsertOne({
                    responseId: respId,
                    stimulationId: stimId,
                    timestamp: r.timestamp,
                    appId: responseAppId,
                    cnsId: (r as any).cnsId || responseAppId, // fallback to appId
                    inputCollateralName:
                        (r.inputCollateralName as string) || undefined,
                    outputCollateralName: outColl,
                    hopIndex:
                        typeof r.hopIndex === 'number'
                            ? (r.hopIndex as number)
                            : undefined,
                    contexts:
                        (r.contexts as Record<string, unknown>) || undefined,
                    inputPayload: r.inputPayload,
                    outputPayload: r.outputPayload,
                    responsePayload: r.responsePayload || r.outputPayload,
                    error: r.error,
                    duration: r.duration,
                });
                db.responses.indexes.appId.addPks(responseAppId, [respId]);
                db.responses.indexes.stimulationId.addPks(stimId, [respId]);
            }

            // Run cleanup for each app that sent responses
            const affectedApps = new Set<string>();
            responses.forEach(r => {
                const appId = (r.appId as string) || 'unknown-app';
                affectedApps.add(appId);
            });
            for (const appId of affectedApps) {
                cleanupOldResponses(appId);
            }

            dbEventQueue.flush();
        },
    }
);
