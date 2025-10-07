import { neuron } from '@cnstra/core';
import { appModelAxon } from '../../controller-layer/AppModelAxon';
import { db, dbEventQueue } from '../../../model';
import type { UINeuron } from '../../../model';
import type {
    ResponseBatchMessage,
    NeuronResponseMessage,
} from '@cnstra/devtools-dto';

export const responsesNeuron = neuron('responses-neuron', appModelAxon).bind(
    appModelAxon,
    {
        devtoolsInit: () => {},
        appsActive: () => {},
        appDisconnected: () => {},
        selectAppClicked: () => {},
        stimulationBatch: () => {},
        devtoolsResponseBatch: (payload: unknown) => {
            const isResponseBatchMessage = (
                p: unknown
            ): p is ResponseBatchMessage =>
                !!p &&
                typeof p === 'object' &&
                Array.isArray((p as ResponseBatchMessage).responses);
            if (!isResponseBatchMessage(payload)) return;
            type ExtendedResponse = NeuronResponseMessage & {
                neuronPk?: string;
                outputCollateralPayload?: unknown;
                inputCollateralPayload?: unknown;
                inputCollateralName?: string;
                outputCollateralName?: string;
                hopIndex?: number;
            };
            const responses = (payload.responses ||
                []) as Array<ExtendedResponse>;

            // aggregate per neuron for denorm counters
            const incByNeuron = new Map<string, number>();

            for (const r of responses) {
                const responseAppId = (r.appId as string) || 'unknown-app';
                const neuronId =
                    (r.neuronPk as string) || (r.neuronId as string);
                if (neuronId) {
                    incByNeuron.set(
                        neuronId,
                        (incByNeuron.get(neuronId) || 0) + 1
                    );
                }

                const outColl =
                    (r.outputCollateralName as string) ||
                    (r.collateralName as string);
                const stimId =
                    (r.stimulationId as string) ||
                    `auto:${responseAppId}:${r.timestamp}`;
                const respId = `${responseAppId}:resp:${stimId}:${r.timestamp}`;

                // store response only (topology comes from init)
                db.responses.collection.upsertOne({
                    responseId: respId,
                    stimulationId: stimId,
                    timestamp: r.timestamp,
                    inputCollateralName:
                        (r.inputCollateralName as string) || undefined,
                    outputCollateralName:
                        (r.outputCollateralName as string) || undefined,
                    hopIndex:
                        typeof r.hopIndex === 'number'
                            ? (r.hopIndex as number)
                            : undefined,
                    contexts:
                        (r.contexts as Record<string, unknown>) || undefined,
                    inputPayload:
                        (r as any).payload || r.inputCollateralPayload,
                    outputPayload:
                        r.responsePayload || r.outputCollateralPayload,
                    responsePayload:
                        r.responsePayload ||
                        r.outputCollateralPayload ||
                        r.inputCollateralPayload,
                    error: r.error,
                    duration: r.duration,
                });
                db.responses.indexes.appId.addPks(responseAppId, [respId]);
                db.responses.indexes.stimulationId.addPks(stimId, [respId]);
            }

            // apply denormalized stimulationCount increments
            incByNeuron.forEach((delta, neuronId) => {
                const n = db.neurons.collection.getOneByPk(neuronId) as
                    | UINeuron
                    | undefined;
                if (!n) return;
                const current = n.stimulationCount || 0;
                db.neurons.upsertOne({
                    ...n,
                    stimulationCount: current + delta,
                });
            });

            dbEventQueue.flush();
        },
    }
);
