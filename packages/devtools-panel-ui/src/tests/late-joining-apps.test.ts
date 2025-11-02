/**
 * Test for late-joining apps scenario
 *
 * This test simulates the scenario where:
 * 1. DevTools panel is already running
 * 2. A new app connects to the server
 * 3. The panel should receive and display the new app
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { db, dbEventQueue } from '../model';
import { DevToolsApp } from '@cnstra/devtools-dto';
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

describe('Late-Joining Apps', () => {
    beforeEach(() => {
        clearDatabase();
    });

    it('should handle app:added message and add new app to database', async () => {
        // Simulate that panel is already running with one app
        const existingApp: DevToolsApp = {
            appId: 'existing-app',
            appName: 'Existing App',
            version: '1.0.0',
            firstSeenAt: Date.now() - 10000,
            lastSeenAt: Date.now() - 5000,
        };

        // Add existing app to database
        db.apps.upsertOne(existingApp);
        const allIndex = db.apps.indexes.all as any;
        allIndex.addPks('all', [existingApp.appId]);
        dbEventQueue.flush();

        // Verify initial state
        let apps = db.apps.getAll();
        expect(apps.length).toBe(1);
        expect(apps[0].appId).toBe('existing-app');

        // Simulate server sending app:added for new app
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

        // Process app:added message
        await mainCNS.stimulate(
            appModelAxon.appAdded.createSignal(appAddedMessage)
        );
        await waitForProcessing();

        // Verify new app was added
        apps = db.apps.getAll();
        expect(apps.length).toBe(2);

        const existingAppInDb = apps.find(app => app.appId === 'existing-app');
        const newAppInDb = apps.find(app => app.appId === 'new-app');

        expect(existingAppInDb).toBeDefined();
        expect(newAppInDb).toBeDefined();
        expect(newAppInDb?.appName).toBe('New App');
        expect(newAppInDb?.version).toBe('2.0.0');
    });

    it('should handle apps:active message and update app list', async () => {
        // Simulate that panel is already running with one app
        const existingApp: DevToolsApp = {
            appId: 'existing-app',
            appName: 'Existing App',
            version: '1.0.0',
            firstSeenAt: Date.now() - 10000,
            lastSeenAt: Date.now() - 5000,
        };

        // Add existing app to database
        db.apps.upsertOne(existingApp);
        const allIndex = db.apps.indexes.all as any;
        allIndex.addPks('all', [existingApp.appId]);
        dbEventQueue.flush();

        // Verify initial state
        let apps = db.apps.getAll();
        expect(apps.length).toBe(1);

        // Simulate server sending apps:active with both existing and new app
        const newApp: DevToolsApp = {
            appId: 'new-app',
            appName: 'New App',
            version: '2.0.0',
            firstSeenAt: Date.now(),
            lastSeenAt: Date.now(),
        };

        const appsActiveMessage = {
            type: 'apps:active' as const,
            apps: [existingApp, newApp], // Server sends full list
        };

        // Process apps:active message
        await mainCNS.stimulate(
            appModelAxon.appsActive.createSignal(appsActiveMessage)
        );
        await waitForProcessing();

        // Verify both apps are in database
        apps = db.apps.getAll();
        expect(apps.length).toBe(2);

        const existingAppInDb = apps.find(app => app.appId === 'existing-app');
        const newAppInDb = apps.find(app => app.appId === 'new-app');

        expect(existingAppInDb).toBeDefined();
        expect(newAppInDb).toBeDefined();
    });

    it('should handle multiple late-joining apps', async () => {
        // Start with empty database
        let apps = db.apps.getAll();
        expect(apps.length).toBe(0);

        // Simulate multiple apps joining one by one
        const appsToAdd = [
            { appId: 'app-1', appName: 'App One', version: '1.0.0' },
            { appId: 'app-2', appName: 'App Two', version: '1.0.0' },
            { appId: 'app-3', appName: 'App Three', version: '1.0.0' },
        ];

        for (let i = 0; i < appsToAdd.length; i++) {
            const appData = appsToAdd[i];
            const app: DevToolsApp = {
                ...appData,
                firstSeenAt: Date.now(),
                lastSeenAt: Date.now(),
            };

            const appAddedMessage = {
                type: 'app:added' as const,
                app: app,
            };

            // Process app:added message
            await mainCNS.stimulate(
                appModelAxon.appAdded.createSignal(appAddedMessage)
            );
            await waitForProcessing();

            // Verify app was added
            apps = db.apps.getAll();
            expect(apps.length).toBe(i + 1);

            const addedApp = apps.find(a => a.appId === appData.appId);
            expect(addedApp).toBeDefined();
            expect(addedApp?.appName).toBe(appData.appName);
        }

        // Final verification
        apps = db.apps.getAll();
        expect(apps.length).toBe(3);

        const appIds = apps.map(a => a.appId).sort();
        expect(appIds).toEqual(['app-1', 'app-2', 'app-3']);
    });
});
