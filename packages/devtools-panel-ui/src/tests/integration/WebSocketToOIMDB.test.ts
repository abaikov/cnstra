/**
 * WebSocket → CNS → OIMDB Integration Test
 *
 * This test verifies the COMPLETE data flow WITHOUT mocking OIMDB or CNS:
 * 1. Simulate server messages (init + response-batch)
 * 2. Trigger CNS neurons directly
 * 3. Data is correctly stored in OIMDB
 * 4. We can query OIMDB and get correct data back
 *
 * This is a TRUE integration test of the data layer logic.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { db, dbEventQueue } from '../../model';
import { InitMessage, NeuronResponseMessage } from '@cnstra/devtools-dto';
import { appModelAxon } from '../../cns/controller-layer/AppModelAxon';
import { mainCNS } from '../../cns';

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

describe('WebSocket → CNS → OIMDB Integration', () => {
    beforeEach(() => {
        clearDatabase();
    });

    it('processes init message and stores topology in OIMDB', async () => {
        // Step 1: Simulate server sending init message
        const initMsg: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'test-app',
            cnsId: 'test-app:main',
            appId: 'test-app',
            appName: 'Test Application',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    id: 'test-app:main:api',
                    name: 'api',
                    appId: 'test-app',
                    cnsId: 'test-app:main',
                },
                {
                    id: 'test-app:main:worker',
                    name: 'worker',
                    appId: 'test-app',
                    cnsId: 'test-app:main',
                },
            ],
            collaterals: [
                {
                    id: 'test-app:main:api:request-received',
                    name: 'request-received',
                    neuronId: 'test-app:main:api',
                    appId: 'test-app',
                    cnsId: 'test-app:main',
                },
                {
                    id: 'test-app:main:worker:work-done',
                    name: 'work-done',
                    neuronId: 'test-app:main:worker',
                    appId: 'test-app',
                    cnsId: 'test-app:main',
                },
            ],
            dendrites: [
                {
                    id: 'test-app:main:worker:d:request-received',
                    neuronId: 'test-app:main:worker',
                    name: 'request-received',
                    appId: 'test-app',
                    cnsId: 'test-app:main',
                },
            ],
        };

        // Step 2: Process init through CNS (simulating server → appIngress → neurons)
        await mainCNS.stimulate(
            appModelAxon.devtoolsInit.createSignal(initMsg)
        );

        await waitForProcessing();

        // Step 3: Verify topology is in OIMDB
        const neurons = db.neurons.getAll();
        expect(neurons.length).toBe(2);

        const api = neurons.find(n => n.name === 'api');
        const worker = neurons.find(n => n.name === 'worker');
        expect(api).toBeDefined();
        expect(worker).toBeDefined();
        expect(api?.id).toBe('test-app:main:api');
        expect(worker?.id).toBe('test-app:main:worker');

        const collaterals = db.collaterals.getAll();
        expect(collaterals.length).toBe(2);

        const requestCol = collaterals.find(c => c.name === 'request-received');
        const workCol = collaterals.find(c => c.name === 'work-done');
        expect(requestCol).toBeDefined();
        expect(workCol).toBeDefined();
        expect(requestCol?.neuronId).toBe('test-app:main:api');
        expect(workCol?.neuronId).toBe('test-app:main:worker');

        const dendrites = db.dendrites.getAll();
        expect(dendrites.length).toBe(1);
        expect(dendrites[0].neuronId).toBe('test-app:main:worker');
        expect(dendrites[0].name).toBe('request-received');

        const apps = db.apps.getAll();
        expect(apps.length).toBe(1);
        expect(apps[0].appId).toBe('test-app');
        expect(apps[0].appName).toBe('Test Application');
    });

    it('processes response-batch and stores in OIMDB with correct indexing', async () => {
        // Step 1: Send init first (required for context)
        const initMsg: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'response-test-app',
            cnsId: 'response-test-app:main',
            appId: 'response-test-app',
            appName: 'Response Test App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    id: 'response-test-app:main:processor',
                    name: 'processor',
                    appId: 'response-test-app',
                    cnsId: 'response-test-app:main',
                },
            ],
            collaterals: [
                {
                    id: 'response-test-app:main:processor:result',
                    name: 'result',
                    neuronId: 'response-test-app:main:processor',
                    appId: 'response-test-app',
                    cnsId: 'response-test-app:main',
                },
            ],
            dendrites: [],
        };

        await mainCNS.stimulate(
            appModelAxon.devtoolsInit.createSignal(initMsg)
        );
        await waitForProcessing();

        // Step 2: Send response-batch
        const responseBatch = {
            type: 'response-batch' as const,
            devToolsInstanceId: 'response-test-app',
            responses: [
                {
                    responseId: 'response-test-app:resp:stim-1:1000',
                    stimulationId: 'stim-1',
                    appId: 'response-test-app',
                    timestamp: Date.now(),
                    inputCollateralName: 'job',
                    outputCollateralName: 'result',
                    inputPayload: { task: 'process-data' },
                    outputPayload: { result: 'success' },
                    responsePayload: { result: 'success' },
                    duration: 150,
                },
                {
                    responseId: 'response-test-app:resp:stim-2:1001',
                    stimulationId: 'stim-2',
                    appId: 'response-test-app',
                    timestamp: Date.now() + 100,
                    inputCollateralName: 'job',
                    outputCollateralName: 'result',
                    inputPayload: { task: 'validate' },
                    outputPayload: { result: 'valid' },
                    responsePayload: { result: 'valid' },
                    duration: 50,
                    error: undefined,
                },
                {
                    responseId: 'response-test-app:resp:stim-3:1002',
                    stimulationId: 'stim-3',
                    appId: 'response-test-app',
                    timestamp: Date.now() + 200,
                    inputCollateralName: 'job',
                    outputCollateralName: 'result',
                    inputPayload: { task: 'fail' },
                    outputPayload: null,
                    responsePayload: null,
                    duration: 25,
                    error: 'Processing failed',
                },
            ] as NeuronResponseMessage[],
        };

        await mainCNS.stimulate(
            appModelAxon.devtoolsResponseBatch.createSignal(responseBatch)
        );
        await waitForProcessing();

        // Step 3: Verify responses are in OIMDB
        const responses = db.responses.getAll();
        expect(responses.length).toBe(3);

        // Check first response
        const resp1 = responses.find(
            r => (r as any).stimulationId === 'stim-1'
        );
        expect(resp1).toBeDefined();
        expect((resp1 as any).inputCollateralName).toBe('job');
        expect((resp1 as any).outputCollateralName).toBe('result');
        expect((resp1 as any).duration).toBe(150);
        expect((resp1 as any).error).toBeUndefined();

        // Check error response
        const resp3 = responses.find(
            r => (r as any).stimulationId === 'stim-3'
        );
        expect(resp3).toBeDefined();
        expect((resp3 as any).error).toBe('Processing failed');

        // Step 4: Verify stimulations are auto-created from responses
        const stimulations = db.stimulations.getAll();
        expect(stimulations.length).toBe(3);

        const stim1 = stimulations.find(
            s => (s as any).stimulationId === 'stim-1'
        );
        expect(stim1).toBeDefined();
        expect((stim1 as any).appId).toBe('response-test-app');
        expect((stim1 as any).collateralName).toBe('job'); // inputCollateralName

        // Step 5: Verify indexing works (query by appId)
        // Note: We can't directly access getPks, so we verify by checking the stored data
        const responsesByApp = responses.filter(
            (r: any) => r.appId === 'response-test-app'
        );
        expect(responsesByApp.length).toBe(3);

        const stimsByApp = stimulations.filter(
            (s: any) => s.appId === 'response-test-app'
        );
        expect(stimsByApp.length).toBe(3);
    });

    it('handles multiple apps with separate data in OIMDB', async () => {
        // App 1
        const app1Init: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'app-1',
            cnsId: 'app-1:main',
            appId: 'app-1',
            appName: 'App One',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    id: 'app-1:main:service-a',
                    name: 'service-a',
                    appId: 'app-1',
                    cnsId: 'app-1:main',
                },
            ],
            collaterals: [
                {
                    id: 'app-1:main:service-a:event-a',
                    name: 'event-a',
                    neuronId: 'app-1:main:service-a',
                    appId: 'app-1',
                    cnsId: 'app-1:main',
                },
            ],
            dendrites: [],
        };

        // App 2
        const app2Init: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'app-2',
            cnsId: 'app-2:main',
            appId: 'app-2',
            appName: 'App Two',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    id: 'app-2:main:service-b',
                    name: 'service-b',
                    appId: 'app-2',
                    cnsId: 'app-2:main',
                },
            ],
            collaterals: [
                {
                    id: 'app-2:main:service-b:event-b',
                    name: 'event-b',
                    neuronId: 'app-2:main:service-b',
                    appId: 'app-2',
                    cnsId: 'app-2:main',
                },
            ],
            dendrites: [],
        };

        // Send both inits
        await mainCNS.stimulate(
            appModelAxon.devtoolsInit.createSignal(app1Init)
        );
        await mainCNS.stimulate(
            appModelAxon.devtoolsInit.createSignal(app2Init)
        );
        await waitForProcessing();

        // Verify both apps are stored
        const apps = db.apps.getAll();
        expect(apps.length).toBe(2);

        const appIds = apps.map(a => a.appId).sort();
        expect(appIds).toEqual(['app-1', 'app-2']);

        // Verify neurons are correctly separated by appId
        const neurons = db.neurons.getAll();
        expect(neurons.length).toBe(2);

        const neuronsByApp1 = neurons.filter(n => n.appId === 'app-1');
        const neuronsByApp2 = neurons.filter(n => n.appId === 'app-2');

        expect(neuronsByApp1.length).toBe(1);
        expect(neuronsByApp2.length).toBe(1);

        // Verify collaterals are correctly separated
        const collaterals = db.collaterals.getAll();
        expect(collaterals.length).toBe(2);

        const collateralsByApp1 = collaterals.filter(c => c.appId === 'app-1');
        const collateralsByApp2 = collaterals.filter(c => c.appId === 'app-2');

        expect(collateralsByApp1.length).toBe(1);
        expect(collateralsByApp2.length).toBe(1);
    });

    it('NO stimulation messages are processed (only responses)', async () => {
        // Init
        const initMsg: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'no-stim-app',
            cnsId: 'no-stim-app:main',
            appId: 'no-stim-app',
            appName: 'No Stim App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    id: 'no-stim-app:main:worker',
                    name: 'worker',
                    appId: 'no-stim-app',
                    cnsId: 'no-stim-app:main',
                },
            ],
            collaterals: [
                {
                    id: 'no-stim-app:main:worker:work',
                    name: 'work',
                    neuronId: 'no-stim-app:main:worker',
                    appId: 'no-stim-app',
                    cnsId: 'no-stim-app:main',
                },
            ],
            dendrites: [],
        };

        await mainCNS.stimulate(
            appModelAxon.devtoolsInit.createSignal(initMsg)
        );
        await waitForProcessing();

        // Send 10 responses
        const responseBatch = {
            type: 'response-batch' as const,
            devToolsInstanceId: 'no-stim-app',
            responses: Array.from({ length: 10 }, (_, i) => ({
                responseId: `no-stim-app:resp:s-${i}:${5000 + i}`,
                stimulationId: `s-${i}`,
                neuronId: 'no-stim-app:main:worker',
                appId: 'no-stim-app',
                timestamp: Date.now() + i * 50,
                inputCollateralName: 'job',
                outputCollateralName: 'work',
                inputPayload: { i },
                outputPayload: { result: i },
                responsePayload: { result: i },
            })) as NeuronResponseMessage[],
        };

        await mainCNS.stimulate(
            appModelAxon.devtoolsResponseBatch.createSignal(responseBatch)
        );
        await waitForProcessing();

        // Verify: 10 responses + 10 stimulations (derived from responses)
        const responses = db.responses.getAll();
        expect(responses.length).toBe(10);

        const stimulations = db.stimulations.getAll();
        expect(stimulations.length).toBe(10); // Auto-created from responses

        // Verify stimulations have correct data
        stimulations.forEach((stim: any, i) => {
            expect(stim.appId).toBe('no-stim-app');
            expect(stim.collateralName).toBe('job'); // From inputCollateralName
        });
    });
});
