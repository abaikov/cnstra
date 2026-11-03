import { cnsNeuron } from '@cnstra/core';
import { appModelAxon } from '../../controller-layer/AppModelAxon';
import { db } from '../../../model/db';

export const appsNeuron = cnsNeuron({})
    .dendrite({
        collateral: appModelAxon.appUpserted,
        response: app => {
            db.apps.upsertEntityByKey(app.id, app);
        },
    })
    .dendrite({
        collateral: appModelAxon.appDisconnected,
        response: ({ appId }) => {
            db.apps.deleteEntityByKey(appId);
        },
    });
