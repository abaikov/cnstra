import { neuron } from '@cnstra/core';
import { db, dbEventQueue } from '../../../model';

/**
 * Holds no dendrites — it only exists so the collapsible-block UI state lives in
 * the same data layer. State is driven imperatively via the helpers below.
 */
export const uiStateNeuron = neuron({});

// Helpers to manage per-hop collapsible UI state.
export const responseUIStateHelpers = {
    getExpanded: (responseId: string): boolean => {
        const state = db.responseUIState.getOneByPk(responseId);
        return state?.isExpanded ?? false;
    },

    setExpanded: (responseId: string, isExpanded: boolean): void => {
        db.responseUIState.upsertOne({ responseId, isExpanded });
        dbEventQueue.flush();
    },

    toggleExpanded: (responseId: string): boolean => {
        const current = db.responseUIState.getOneByPk(responseId);
        const newExpanded = !(current?.isExpanded ?? false);
        db.responseUIState.upsertOne({ responseId, isExpanded: newExpanded });
        dbEventQueue.flush();
        return newExpanded;
    },
};
