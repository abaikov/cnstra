import { neuron } from '@cnstra/core';
import { appModelAxon } from '../../controller-layer/AppModelAxon';
import { db } from '../../../model';
import { OIMReactiveIndexManual } from '@oimdb/core';

export const collateralNeuron = neuron('collateral-neuron', appModelAxon).bind(
    appModelAxon,
    {
        devtoolsInit: (payload: any) => {
            const appId = (payload as any).appId as string;
            for (const c of (payload.collaterals as Array<{
                collateralName: string;
                neuronId: string;
                appId: string;
                type: string;
            }>) || []) {
                db.collaterals.upsertOne({
                    collateralName: c.collateralName,
                    name: c.collateralName,
                    appId: c.appId,
                    neuronId: c.neuronId,
                    type: c.type,
                } as any);
                (
                    db.collaterals.indexes.appId as OIMReactiveIndexManual<
                        string,
                        string
                    >
                ).addPks(c.appId, [c.collateralName]);
                (
                    db.collaterals.indexes.neuronId as OIMReactiveIndexManual<
                        string,
                        string
                    >
                ).addPks(c.neuronId, [c.collateralName]);
            }
        },
        devtoolsResponseBatch: () => undefined,
        selectAppClicked: () => undefined,
        appsActive: () => undefined,
        appDisconnected: () => undefined,
        stimulationBatch: () => undefined,
    }
);
