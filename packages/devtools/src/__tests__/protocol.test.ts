import { CNSDevTools } from '../index';
import { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import { InitMessage, NeuronResponseMessage } from '@cnstra/devtools-dto';

/**
 * Unit tests to verify DevTools sends correct messages
 * Focus: WHAT is sent, WHEN it's sent, in WHAT ORDER
 */

// Minimal mock CNS
class TestMockCNS {
    private responseListeners: any[] = [];

    getNeurons() {
        return [
            {
                name: 'user-service',
                axon: { userCreated: {}, userUpdated: {} },
                dendrites: [],
            },
            {
                name: 'email-service',
                axon: { emailSent: {} },
                dendrites: [],
            },
        ];
    }

    getCollaterals() {
        return [
            { name: 'user-created' },
            { name: 'user-updated' },
            { name: 'email-sent' },
        ];
    }

    addResponseListener(fn: any) {
        this.responseListeners.push(fn);
    }

    getParentNeuronByCollateralName(collateralName: string) {
        if (
            collateralName === 'user-created' ||
            collateralName === 'user-updated'
        ) {
            return { name: 'user-service' };
        }
        if (collateralName === 'email-sent') {
            return { name: 'email-service' };
        }
        return null;
    }

    // Test helper: trigger a response
    triggerResponse(response: any) {
        this.responseListeners.forEach(fn => fn(response));
    }

    stimulate() {}
}

// Transport that captures all messages
class TestTransport implements ICNSDevToolsTransport {
    public messages: Array<{
        type: 'init' | 'response';
        payload: any;
        timestamp: number;
    }> = [];

    sendInitMessage(message: InitMessage): Promise<void> {
        this.messages.push({
            type: 'init',
            payload: message,
            timestamp: Date.now(),
        });
        return Promise.resolve();
    }

    sendNeuronResponseMessage(message: NeuronResponseMessage): Promise<void> {
        this.messages.push({
            type: 'response',
            payload: message,
            timestamp: Date.now(),
        });
        return Promise.resolve();
    }

    onStimulateCommand(): () => void {
        return () => {};
    }

    // Test helper: get messages by type
    getMessagesByType(type: string) {
        return this.messages.filter(m => m.type === type);
    }

    // Test helper: clear messages
    clear() {
        this.messages = [];
    }
}

describe('DevTools Message Protocol', () => {
    describe('Initialization', () => {
        it('sends ONLY init message on registerCNS', async () => {
            const mockCNS = new TestMockCNS();
            const transport = new TestTransport();

            const devtools = new CNSDevTools('my-app', transport, {
                devToolsInstanceId: 'my-app',
                cnsId: 'my-app:main',
            });
            devtools.registerCNS(mockCNS as any, 'mockingCNS');

            await new Promise(resolve => setTimeout(resolve, 0));

            // CRITICAL: Only 1 message sent (init), no stimulations
            expect(transport.messages.length).toBe(1);
            expect(transport.messages[0].type).toBe('init');
        });

        it('init message contains complete topology', async () => {
            const mockCNS = new TestMockCNS();
            const transport = new TestTransport();

            const devtools = new CNSDevTools('my-app', transport, {
                devToolsInstanceId: 'my-app',
                cnsId: 'my-app:main',
            });
            devtools.registerCNS(mockCNS as any, 'mockingCNS');

            await new Promise(resolve => setTimeout(resolve, 0));

            const initMsg = transport.messages[0].payload as InitMessage;

            expect(initMsg.neurons).toHaveLength(2);
            expect(initMsg.collaterals).toHaveLength(3);
            expect(initMsg.appId).toBe('my-app');
            expect(initMsg.cnsId).toBe('my-app:main');

            // Check neuron IDs are properly formatted
            expect(initMsg.neurons[0].id).toBe('my-app:main:user-service');
            expect(initMsg.neurons[1].id).toBe('my-app:main:email-service');
        });
    });

    describe('Response Messages', () => {
        it('sends ONLY response message when CNS fires response (NO stimulation)', async () => {
            const mockCNS = new TestMockCNS();
            const transport = new TestTransport();

            const devtools = new CNSDevTools('my-app', transport, {
                devToolsInstanceId: 'my-app',
                cnsId: 'my-app:main',
            });
            devtools.registerCNS(mockCNS as any, 'mockingCNS');

            await new Promise(resolve => setTimeout(resolve, 0));
            transport.clear();

            // Trigger response
            mockCNS.triggerResponse({
                inputSignal: {
                    collateralName: 'user-signup',
                    payload: { email: 'test@test.com' },
                },
                outputSignal: {
                    collateralName: 'user-created',
                    payload: { userId: 'u123' },
                },
                stimulationId: 'stim-abc',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            // CRITICAL: Exactly 1 message, type=response, NO stimulation
            expect(transport.messages.length).toBe(1);
            expect(transport.messages[0].type).toBe('response');

            const stimMessages = transport.getMessagesByType('stimulation');
            expect(stimMessages.length).toBe(0);
        });

        it('response message contains all required fields', async () => {
            const mockCNS = new TestMockCNS();
            const transport = new TestTransport();

            const devtools = new CNSDevTools('my-app', transport, {
                devToolsInstanceId: 'my-app',
                cnsId: 'my-app:main',
            });
            devtools.registerCNS(mockCNS as any, 'mockingCNS');

            await new Promise(resolve => setTimeout(resolve, 0));
            transport.clear();

            mockCNS.triggerResponse({
                inputSignal: {
                    collateralName: 'user-signup',
                    payload: { email: 'test@test.com' },
                },
                outputSignal: {
                    collateralName: 'user-created',
                    payload: { userId: 'u123' },
                },
                stimulationId: 'stim-xyz',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            const respMsg = transport.messages[0]
                .payload as NeuronResponseMessage;

            // Verify all required fields
            expect(respMsg.responseId).toBeDefined();
            expect(respMsg.responseId).toContain('my-app:resp:');
            expect(respMsg.stimulationId).toBe('stim-xyz');
            expect(respMsg.appId).toBe('my-app');
            expect(respMsg.timestamp).toBeGreaterThan(0);
            expect(respMsg.inputCollateralName).toBe('user-signup');
            expect(respMsg.outputCollateralName).toBe('user-created');
            expect(respMsg.inputPayload).toEqual({ email: 'test@test.com' });
            expect(respMsg.outputPayload).toEqual({ userId: 'u123' });
        });

        it('derives neuronId from outputSignal collateral owner', async () => {
            const mockCNS = new TestMockCNS();
            const transport = new TestTransport();

            const devtools = new CNSDevTools('my-app', transport, {
                devToolsInstanceId: 'my-app',
                cnsId: 'my-app:main',
            });
            devtools.registerCNS(mockCNS as any, 'mockingCNS');

            await new Promise(resolve => setTimeout(resolve, 0));
            transport.clear();

            // Response with email-service outputSignal
            mockCNS.triggerResponse({
                inputSignal: {
                    collateralName: 'user-created',
                    payload: { userId: 'u123' },
                },
                outputSignal: {
                    collateralName: 'email-sent',
                    payload: { to: 'user@test.com' },
                },
                stimulationId: 'stim-email',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            const respMsg = transport.messages[0]
                .payload as NeuronResponseMessage;

            // outputCollateralName should be email-sent
            expect(respMsg.outputCollateralName).toBe('email-sent');
        });

        it('handles missing outputSignal gracefully (outputCollateralName is undefined)', async () => {
            const mockCNS = new TestMockCNS();
            const transport = new TestTransport();

            const devtools = new CNSDevTools('my-app', transport, {
                devToolsInstanceId: 'my-app',
                cnsId: 'my-app:main',
            });
            devtools.registerCNS(mockCNS as any, 'mockingCNS');

            await new Promise(resolve => setTimeout(resolve, 0));
            transport.clear();

            // Response without outputSignal (neuron didn't output anything)
            mockCNS.triggerResponse({
                inputSignal: {
                    collateralName: 'some-input',
                    payload: {},
                },
                // No outputSignal - neuron processed but didn't output
                stimulationId: 'stim-nooutput',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            // Should still send response
            expect(transport.messages.length).toBe(1);
            expect(transport.messages[0].type).toBe('response');

            const respMsg = transport.messages[0]
                .payload as NeuronResponseMessage;
            expect(respMsg.outputCollateralName).toBeUndefined();
            expect(respMsg.inputCollateralName).toBe('some-input');
        });
    });

    describe('Message Order', () => {
        it('sends messages in order: init → response → response (NO stimulations)', async () => {
            const mockCNS = new TestMockCNS();
            const transport = new TestTransport();

            const devtools = new CNSDevTools('my-app', transport, {
                devToolsInstanceId: 'my-app',
                cnsId: 'my-app:main',
            });
            devtools.registerCNS(mockCNS as any, 'mockingCNS');

            await new Promise(resolve => setTimeout(resolve, 0));

            // Trigger 2 responses
            mockCNS.triggerResponse({
                inputSignal: { collateralName: 'user-signup', payload: {} },
                outputSignal: { collateralName: 'user-created', payload: {} },
                stimulationId: 'stim-1',
            });

            mockCNS.triggerResponse({
                inputSignal: { collateralName: 'user-created', payload: {} },
                outputSignal: { collateralName: 'email-sent', payload: {} },
                stimulationId: 'stim-2',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            // Should have: init, response, response (3 total, NO stimulations)
            expect(transport.messages.length).toBe(3);
            expect(transport.messages[0].type).toBe('init');
            expect(transport.messages[1].type).toBe('response');
            expect(transport.messages[2].type).toBe('response');

            // Verify NO stimulation messages
            const stimMessages = transport.getMessagesByType('stimulation');
            expect(stimMessages.length).toBe(0);
        });

        it('timestamps are sequential', async () => {
            const mockCNS = new TestMockCNS();
            const transport = new TestTransport();

            const devtools = new CNSDevTools('my-app', transport, {
                devToolsInstanceId: 'my-app',
            });
            devtools.registerCNS(mockCNS as any, 'mockingCNS');

            await new Promise(resolve => setTimeout(resolve, 0));

            mockCNS.triggerResponse({
                inputSignal: { collateralName: 'user-signup', payload: {} },
                outputSignal: { collateralName: 'user-created', payload: {} },
                stimulationId: 'stim-1',
            });

            await new Promise(resolve => setTimeout(resolve, 1)); // Small delay

            mockCNS.triggerResponse({
                inputSignal: { collateralName: 'user-created', payload: {} },
                outputSignal: { collateralName: 'email-sent', payload: {} },
                stimulationId: 'stim-2',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            // Check timestamps are sequential
            expect(transport.messages[0].timestamp).toBeLessThanOrEqual(
                transport.messages[1].timestamp
            );
            expect(transport.messages[1].timestamp).toBeLessThanOrEqual(
                transport.messages[2].timestamp
            );
        });
    });

    describe('Summary', () => {
        it('DevTools sends ONLY init+responses, NEVER stimulations', async () => {
            const mockCNS = new TestMockCNS();
            const transport = new TestTransport();

            const devtools = new CNSDevTools('my-app', transport, {
                devToolsInstanceId: 'my-app',
            });
            devtools.registerCNS(mockCNS as any, 'mockingCNS');

            await new Promise(resolve => setTimeout(resolve, 0));

            // Trigger many responses
            for (let i = 0; i < 10; i++) {
                mockCNS.triggerResponse({
                    inputSignal: {
                        collateralName: 'user-signup',
                        payload: { email: `user${i}@test.com` },
                    },
                    outputSignal: {
                        collateralName: 'user-created',
                        payload: { i },
                    },
                    stimulationId: `stim-${i}`,
                });
            }

            await new Promise(resolve => setTimeout(resolve, 0));

            // Should have: 1 init + 10 responses = 11 total
            expect(transport.messages.length).toBe(11);

            // Count by type
            const initCount = transport.getMessagesByType('init').length;
            const responseCount =
                transport.getMessagesByType('response').length;
            const stimCount = transport.getMessagesByType('stimulation').length;

            expect(initCount).toBe(1);
            expect(responseCount).toBe(10);
            expect(stimCount).toBe(0); // CRITICAL: NO stimulation messages
        });
    });

    describe('Data Completeness (can we reconstruct the graph?)', () => {
        it('init message has EVERYTHING needed to build topology graph', async () => {
            const mockCNS = new TestMockCNS();
            const transport = new TestTransport();

            const devtools = new CNSDevTools('my-app', transport, {
                devToolsInstanceId: 'my-app',
                cnsId: 'my-app:main',
            });
            devtools.registerCNS(mockCNS as any, 'mockingCNS');

            await new Promise(resolve => setTimeout(resolve, 0));

            const initMsg = transport.messages[0].payload as InitMessage;

            // Can we build neurons?
            expect(initMsg.neurons).toBeDefined();
            expect(Array.isArray(initMsg.neurons)).toBe(true);
            initMsg.neurons.forEach(neuron => {
                expect(neuron.id).toBeDefined();
                expect(neuron.name).toBeDefined();
                expect(neuron.appId).toBeDefined();
                expect(neuron.cnsId).toBeDefined();
                // Full ID format: cnsId:neuronName
                expect(neuron.id).toContain(neuron.name);
            });

            // Can we build collaterals?
            expect(initMsg.collaterals).toBeDefined();
            expect(Array.isArray(initMsg.collaterals)).toBe(true);
            initMsg.collaterals.forEach(col => {
                expect(col.name).toBeDefined();
                expect(col.neuronId).toBeDefined(); // CRITICAL: which neuron owns this?
                expect(col.appId).toBeDefined();
                // neuronId should be a valid neuron from neurons array
                const ownerExists = initMsg.neurons.some(
                    n => n.id === col.neuronId
                );
                expect(ownerExists).toBe(true);
            });

            // Can we build dendrites (if present)?
            if (initMsg.dendrites) {
                expect(Array.isArray(initMsg.dendrites)).toBe(true);
            }
        });

        it('response message has EVERYTHING needed to track signal flow', async () => {
            const mockCNS = new TestMockCNS();
            const transport = new TestTransport();

            const devtools = new CNSDevTools('my-app', transport, {
                devToolsInstanceId: 'my-app',
                cnsId: 'my-app:main',
            });
            devtools.registerCNS(mockCNS as any, 'mockingCNS');

            await new Promise(resolve => setTimeout(resolve, 0));
            transport.clear();

            mockCNS.triggerResponse({
                inputSignal: {
                    collateralName: 'user-signup',
                    payload: { email: 'test@test.com', name: 'John' },
                },
                outputSignal: {
                    collateralName: 'user-created',
                    payload: { userId: 'u123', email: 'test@test.com' },
                },
                stimulationId: 'stim-signup-123',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            const respMsg = transport.messages[0]
                .payload as NeuronResponseMessage;

            // CRITICAL FIELDS for reconstructing signal flow:

            // 1. Identity
            expect(respMsg.responseId).toBeDefined();
            expect(respMsg.stimulationId).toBeDefined();
            expect(respMsg.appId).toBeDefined();

            // 2. Timing
            expect(respMsg.timestamp).toBeDefined();
            expect(typeof respMsg.timestamp).toBe('number');
            expect(respMsg.timestamp).toBeGreaterThan(0);

            // 3. Signal flow (input → neuron → output)
            expect(respMsg.inputCollateralName).toBeDefined();
            expect(respMsg.outputCollateralName).toBeDefined();
            expect(respMsg.inputCollateralName).not.toBe(
                respMsg.outputCollateralName
            ); // Different!

            // 4. Payloads (what data was transformed?)
            expect(respMsg.inputPayload).toBeDefined();
            expect(respMsg.outputPayload).toBeDefined();
            expect(respMsg.responsePayload).toBeDefined();

            // 5. Can we build stimulation from this response?
            // inputCollateralName + stimulationId = enough to identify stimulation
            expect(respMsg.inputCollateralName).toBe('user-signup');
            expect(respMsg.stimulationId).toBe('stim-signup-123');

            // UI can derive: stimulation on "user-signup" → output "user-created"
            expect(respMsg.outputCollateralName).toBe('user-created');
        });

        it('multiple responses can reconstruct complete execution chain', async () => {
            const mockCNS = new TestMockCNS();
            const transport = new TestTransport();

            const devtools = new CNSDevTools('my-app', transport, {
                devToolsInstanceId: 'my-app',
                cnsId: 'my-app:main',
            });
            devtools.registerCNS(mockCNS as any, 'mockingCNS');

            await new Promise(resolve => setTimeout(resolve, 0));
            transport.clear();

            // Simulate a chain: signup → user-created → email-sent
            const stimId = 'stim-chain-123';

            // Step 1: user-service processes signup
            mockCNS.triggerResponse({
                inputSignal: {
                    collateralName: 'user-signup',
                    payload: { email: 'test@test.com' },
                },
                outputSignal: {
                    collateralName: 'user-created',
                    payload: { userId: 'u123' },
                },
                stimulationId: stimId,
            });

            // Step 2: email-service processes user-created
            mockCNS.triggerResponse({
                inputSignal: {
                    collateralName: 'user-created',
                    payload: { userId: 'u123' },
                },
                outputSignal: {
                    collateralName: 'email-sent',
                    payload: { to: 'test@test.com' },
                },
                stimulationId: stimId, // SAME stimulation ID!
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            expect(transport.messages.length).toBe(2);

            const resp1 = transport.messages[0]
                .payload as NeuronResponseMessage;
            const resp2 = transport.messages[1]
                .payload as NeuronResponseMessage;

            // Can we reconstruct the chain?
            // Both responses share stimulationId
            expect(resp1.stimulationId).toBe(stimId);
            expect(resp2.stimulationId).toBe(stimId);

            // Chain: user-signup → user-created → email-sent
            // (neurons can be derived from collaterals in init message)
            expect(resp1.inputCollateralName).toBe('user-signup');
            expect(resp1.outputCollateralName).toBe('user-created');

            expect(resp2.inputCollateralName).toBe('user-created');
            expect(resp2.outputCollateralName).toBe('email-sent');

            // The output of step 1 is the input of step 2!
            expect(resp1.outputCollateralName).toBe(resp2.inputCollateralName);

            // Timestamps should show order
            expect(resp1.timestamp).toBeLessThanOrEqual(resp2.timestamp);
        });

        it('can derive stimulation data from response (no separate stimulation message needed)', async () => {
            const mockCNS = new TestMockCNS();
            const transport = new TestTransport();

            const devtools = new CNSDevTools('my-app', transport, {
                devToolsInstanceId: 'my-app',
                cnsId: 'my-app:main',
            });
            devtools.registerCNS(mockCNS as any, 'mockingCNS');

            await new Promise(resolve => setTimeout(resolve, 0));
            transport.clear();

            mockCNS.triggerResponse({
                inputSignal: {
                    collateralName: 'user-signup',
                    payload: { email: 'test@test.com' },
                },
                outputSignal: {
                    collateralName: 'user-created',
                    payload: { userId: 'u123' },
                },
                stimulationId: 'stim-abc',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            const respMsg = transport.messages[0]
                .payload as NeuronResponseMessage;

            // From response, we can derive stimulation:
            const derivedStimulation = {
                stimulationId: respMsg.stimulationId, // ✓
                appId: respMsg.appId, // ✓
                collateralName: respMsg.inputCollateralName, // ✓ (stimulation = input signal)
                timestamp: respMsg.timestamp, // ✓
                payload: respMsg.inputPayload, // ✓
            };

            expect(derivedStimulation.stimulationId).toBe('stim-abc');
            expect(derivedStimulation.collateralName).toBe('user-signup');
            expect(derivedStimulation.appId).toBe('my-app');
            expect(derivedStimulation.payload).toEqual({
                email: 'test@test.com',
            });

            // UI can create db.stimulations from responses!
            expect(derivedStimulation).toMatchObject({
                stimulationId: expect.any(String),
                appId: expect.any(String),
                collateralName: expect.any(String),
                timestamp: expect.any(Number),
                payload: expect.any(Object),
            });
        });
    });
});
