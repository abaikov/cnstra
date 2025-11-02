/**
 * E2E test for late-joining apps scenario
 *
 * This test simulates the complete flow:
 * 1. Panel connects to server
 * 2. Server has one app already connected
 * 3. New app connects to server
 * 4. Panel should receive app:added and update UI
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { db, dbEventQueue } from '../model';
import { DevToolsApp, InitMessage } from '@cnstra/devtools-dto';
import { appModelAxon } from '../cns/controller-layer/AppModelAxon';
import { mainCNS } from '../cns';

// Helper to wait for async processing
const waitForProcessing = () =>
    new Promise(resolve => setTimeout(resolve, 100));

// Helper to clear database
const clearDatabase = () => {
    db.neurons.collection.clear();
    db.collaterals.collection.clear();
    db.dendrites.collection.clear();
    db.responses.collection.clear();
    db.stimulations.collection.clear();
    db.apps.collection.clear();

    Object.values(db.neurons.indexes).forEach(index => index.clear());
    Object.values(db.collaterals.indexes).forEach(index => index.clear());
    Object.values(db.dendrites.indexes).forEach(index => index.clear());
    Object.values(db.responses.indexes).forEach(index => index.clear());
    Object.values(db.stimulations.indexes).forEach(index => index.clear());
    Object.values(db.apps.indexes).forEach(index => index.clear());

    dbEventQueue.flush();
};

describe('E2E Late-Joining Apps', () => {
    beforeEach(() => {
        clearDatabase();
    });

    it('should simulate complete late-joining app flow', async () => {
        // Step 1: Panel connects and receives initial apps list
        const initialApps: DevToolsApp[] = [
            {
                appId: 'existing-app',
                appName: 'Existing App',
                version: '1.0.0',
                firstSeenAt: Date.now() - 10000,
                lastSeenAt: Date.now() - 5000,
            },
        ];

        // Simulate apps:active message (what panel receives on initial connection)
        const appsActiveMessage = {
            type: 'apps:active' as const,
            apps: initialApps,
        };

        await mainCNS.stimulate(
            appModelAxon.appsActive.createSignal(appsActiveMessage)
        );
        await waitForProcessing();

        // Verify initial state
        let apps = db.apps.getAll();
        expect(apps.length).toBe(1);
        expect(apps[0].appId).toBe('existing-app');

        // Step 2: New app connects to server
        // Server would send init message first, then app:added
        const newAppInit: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'new-app',
            cnsId: 'new-app:main',
            appId: 'new-app',
            appName: 'New App',
            version: '2.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    id: 'new-app:main:service',
                    name: 'service',
                    appId: 'new-app',
                    cnsId: 'new-app:main',
                },
            ],
            collaterals: [
                {
                    id: 'new-app:main:service:event',
                    name: 'event',
                    neuronId: 'new-app:main:service',
                    appId: 'new-app',
                    cnsId: 'new-app:main',
                },
            ],
            dendrites: [],
        };

        // Process init message (this would happen on server side)
        await mainCNS.stimulate(
            appModelAxon.devtoolsInit.createSignal(newAppInit)
        );
        await waitForProcessing();

        // Step 3: Server sends app:added to all connected panels
        const newApp: DevToolsApp = {
            appId: 'new-app',
            appName: 'New App',
            version: '2.0.0',
            firstSeenAt: Date.now(),
            lastSeenAt: Date.now(),
        };

        const appAddedMessage = {
            type: 'app:added' as const,
            app: newApp,
        };

        // Process app:added message (what panel receives)
        await mainCNS.stimulate(
            appModelAxon.appAdded.createSignal(appAddedMessage)
        );
        await waitForProcessing();

        // Step 4: Verify both apps are now in database
        apps = db.apps.getAll();
        expect(apps.length).toBe(2);

        const existingAppInDb = apps.find(app => app.appId === 'existing-app');
        const newAppInDb = apps.find(app => app.appId === 'new-app');

        expect(existingAppInDb).toBeDefined();
        expect(newAppInDb).toBeDefined();
        expect(newAppInDb?.appName).toBe('New App');

        // Step 5: Verify topology was also processed
        const neurons = db.neurons.getAll();
        const newAppNeurons = neurons.filter(n => n.appId === 'new-app');
        expect(newAppNeurons.length).toBe(1);
        expect(newAppNeurons[0].name).toBe('service');

        const collaterals = db.collaterals.getAll();
        const newAppCollaterals = collaterals.filter(
            c => c.appId === 'new-app'
        );
        expect(newAppCollaterals.length).toBe(1);
        expect(newAppCollaterals[0].name).toBe('event');
    });
});
