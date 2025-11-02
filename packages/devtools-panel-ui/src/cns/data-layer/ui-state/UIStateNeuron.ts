import { neuron } from '@cnstra/core';
import { appModelAxon } from '../../controller-layer/AppModelAxon';
import { db, dbEventQueue } from '../../../model';

export const uiStateNeuron = neuron('ui-state-neuron', appModelAxon).bind(
    appModelAxon,
    {
        devtoolsInit: () => {},
        appsActive: () => {},
        appAdded: () => {},
        appDisconnected: () => {},
        selectAppClicked: () => {},
        stimulationBatch: () => {},
        devtoolsResponseBatch: () => {},
    }
);

// Helper functions to manage response UI state
export const responseUIStateHelpers = {
    getExpanded: (responseId: string): boolean => {
        const state = db.responseUIState.collection.getOneByPk(responseId);
        return state?.isExpanded ?? false;
    },

    setExpanded: (responseId: string, isExpanded: boolean): void => {
        db.responseUIState.collection.upsertOne({
            responseId,
            isExpanded,
        });
        dbEventQueue.flush();
    },

    toggleExpanded: (responseId: string): boolean => {
        const currentState =
            db.responseUIState.collection.getOneByPk(responseId);
        const newExpanded = !(currentState?.isExpanded ?? false);
        db.responseUIState.collection.upsertOne({
            responseId,
            isExpanded: newExpanded,
        });
        dbEventQueue.flush();
        return newExpanded;
    },
};
