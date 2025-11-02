import { neuron } from '@cnstra/core';
import { appModelAxon } from '../../controller-layer/AppModelAxon';
import { db } from '../../../model';
import { OIMReactiveIndexManual } from '@oimdb/core';

export const collateralNeuron = neuron('collateral-neuron', appModelAxon).bind(
    appModelAxon,
    {
        devtoolsInit: payload => {
            for (const c of payload.collaterals || []) {
                db.collaterals.upsertOne({
                    id: c.id,
                    name: c.name,
                    appId: c.appId,
                    neuronId: c.neuronId,
                    cnsId: c.cnsId,
                });
                (
                    db.collaterals.indexes.appId as OIMReactiveIndexManual<
                        string,
                        string
                    >
                ).addPks(c.appId, [c.id]);
                (
                    db.collaterals.indexes.neuronId as OIMReactiveIndexManual<
                        string,
                        string
                    >
                ).addPks(c.neuronId, [c.id]);
            }
        },
        devtoolsResponseBatch: () => undefined,
        selectAppClicked: () => undefined,
        appsActive: () => undefined,
        appAdded: () => undefined,
        appDisconnected: () => undefined,
        stimulationBatch: () => undefined,
    }
);
