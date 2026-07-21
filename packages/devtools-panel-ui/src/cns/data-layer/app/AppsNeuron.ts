import { neuron } from '@cnstra/core';
import { appModelAxon } from '../../controller-layer/AppModelAxon';
import { db, dbEventQueue } from '../../../model';

/** Persists apps. Indexes are derived, so this is a plain upsert / remove. */
export const appsNeuron = neuron({})
    .dendrite({
        collateral: appModelAxon.appUpserted,
        response: app => {
            db.apps.upsertOne(app);
            dbEventQueue.flush();
        },
    })
    .dendrite({
        collateral: appModelAxon.appDisconnected,
        response: ({ appId }) => {
            const app = db.apps.getOneByPk(appId);
            if (app) {
                db.apps.removeOne(app);
                dbEventQueue.flush();
            }
        },
    });
