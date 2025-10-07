import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../ui/App';
import { db } from '../model';
import { OIMReactiveIndexManual } from '@oimdb/core';

describe('Active app selection and UI rendering', () => {
    it('auto-selects first connected app and renders Real Data when neurons/responses exist', async () => {
        const appId = `test-auto-${Date.now()}`;

        // Seed DB with one connected app and ensure index contains it
        db.apps.upsertOne({
            appId,
            appName: 'Auto Select App',
            version: '0.0.1',
            firstSeenAt: Date.now(),
            lastSeenAt: Date.now(),
        });
        (db.apps.indexes.all as OIMReactiveIndexManual<'all', string>).addPks(
            'all',
            [appId]
        );

        // Seed neurons and responses for that app and ensure indexes
        const neuronId = `${appId}:neuron:input`;
        db.neurons.collection.upsertOne({ id: neuronId, appId, name: 'input' });
        db.neurons.indexes.appId.addPks(appId, [neuronId]);

        const stimId = `stim-${Date.now()}`;
        const respId = `${appId}:resp:${stimId}:${Date.now()}`;
        db.responses.upsertOne({
            id: respId,
            appId,
            stimulationId: stimId,
            timestamp: Date.now(),
            queueLength: 0,
        } as any);
        db.responses.indexes.appId.addPks(appId, [respId]);

        // Mount the App
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        root.render(<App />);

        // Allow effects and selectors to run
        await new Promise(res => setTimeout(res, 50));

        const html = container.innerHTML;
        // Selected badge should appear for the only app
        expect(html).toContain('🧟 SELECTED');
        // Overlay should report Real Data (not placeholder)
        expect(html).toContain('Real Data');

        root.unmount();
        container.remove();
    });
});
