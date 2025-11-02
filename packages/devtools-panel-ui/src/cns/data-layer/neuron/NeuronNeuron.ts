import { neuron } from '@cnstra/core';
import { db } from '../../../model';
import type { UINeuron } from '../../../model';
import { appModelAxon } from '../../controller-layer/AppModelAxon';
import { StimulationBatchMessage } from '@cnstra/devtools-dto';

export const neuronNeuron = neuron('neuron-neuron', {}).bind(appModelAxon, {
    devtoolsResponseBatch: payload => {
        payload.responses.forEach(response => {
            const appId = response.appId;
            const outputCollateralName = response.outputCollateralName;
            const inputCollateralName = response.inputCollateralName;

            const appDendriteIds =
                db.dendrites.indexes.appId.getPksByKey(appId);
            const appDendrites = db.dendrites.collection.getManyByPks(
                Array.from(appDendriteIds)
            );

            // Track neurons that received input signals (via dendrites listening to inputCollateralName)
            // This handles cases where neurons process signals but don't emit output
            if (inputCollateralName) {
                const inputDendrites = appDendrites.filter(
                    d => d.name === inputCollateralName
                );
                inputDendrites.forEach(d => {
                    const neuronId = d.neuronId;
                    if (!neuronId) return;
                    const n = db.neurons.collection.getOneByPk(neuronId);
                    if (!n) return;
                    const current = n.stimulationCount || 0;
                    db.neurons.upsertOne({
                        ...n,
                        stimulationCount: Math.max(0, current + 1),
                    });
                });
            }

            // Track neurons that emit output signals (via dendrites listening to outputCollateralName)
            if (outputCollateralName) {
                // TODO: we need composed indexes
                const reactedDendrites = appDendrites.filter(
                    d => d.name === outputCollateralName
                );
                reactedDendrites.forEach(d => {
                    const dendriteId = d.id;
                    const dendrite =
                        db.dendrites.collection.getOneByPk(dendriteId);
                    if (!dendrite) return;
                    const neuronId = dendrite.neuronId;
                    if (!neuronId) return;
                    const n = db.neurons.collection.getOneByPk(neuronId);
                    if (!n) return;
                    const current = n.stimulationCount || 0;
                    db.neurons.upsertOne({
                        ...n,
                        stimulationCount: Math.max(
                            0,
                            current + reactedDendrites.length
                        ),
                    });
                });
            }
        });
    },
    selectAppClicked: () => {},
    appsActive: () => {},
    appAdded: () => {},
    appDisconnected: () => {},
    stimulationBatch: (payload, axon) => {
        const p = payload as StimulationBatchMessage;
        p.stimulations.forEach(stimulation => {
            const n = db.neurons.collection.getOneByPk(stimulation.neuronId) as
                | UINeuron
                | undefined;
            if (!n) return;
            const current = n.stimulationCount || 0;
            db.neurons.upsertOne({
                ...n,
                stimulationCount: Math.max(0, current + 1),
            });
        });
    },
    // Central ingestion is handled in apps-neuron to avoid duplicates
    // Keep this as a no-op
    devtoolsInit: () => {},
});
