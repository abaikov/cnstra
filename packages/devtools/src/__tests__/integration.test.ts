import { CNSDevTools } from '../index';
import { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import { InitMessage, NeuronResponseMessage } from '@cnstra/devtools-dto';

/**
 * Simple integration test to verify DevTools sends correct messages
 * in the correct order with minimal setup
 */

// Minimal mock CNS
class SimpleMockCNS {
    private responseListeners: any[] = [];

    getNeurons() {
        return [
            {
                name: 'test-neuron',
                axon: { testOutput: {} },
                dendrites: [],
            },
        ];
    }

    getCollaterals() {
        return [{ name: 'test-output' }];
    }

    addResponseListener(fn: any) {
        this.responseListeners.push(fn);
    }

    getParentNeuronByCollateralName(collateralName: string) {
        if (collateralName === 'test-output') {
            return { name: 'test-neuron' };
        }
        return null;
    }

    // Trigger a response for testing
    triggerResponse(response: any) {
        this.responseListeners.forEach(fn => fn(response));
    }

    stimulate() {}
}

// Simple transport that captures all messages in order
class CaptureTransport implements ICNSDevToolsTransport {
    public messages: Array<{
        type: 'init' | 'response';
        payload: any;
    }> = [];

    sendInitMessage(message: InitMessage): Promise<void> {
        this.messages.push({ type: 'init', payload: message });
        return Promise.resolve();
    }

    sendNeuronResponseMessage(message: NeuronResponseMessage): Promise<void> {
        this.messages.push({ type: 'response', payload: message });
        return Promise.resolve();
    }

    onStimulateCommand(): () => void {
        return () => {};
    }
}

describe('CNSDevTools Simple Integration', () => {
    describe('safeJson serialization', () => {
        it('handles circular structures and errors', () => {
            const mockCNS = new SimpleMockCNS();
            const transport = new CaptureTransport();

            const devtools = new CNSDevTools('test-app', transport, {
                devToolsInstanceId: 'test-app',
            });

            // Test circular structure
            const obj: any = { a: 1 };
            obj.self = obj;
            const result = (devtools as any).safeJson(obj);
            expect(result).toEqual({ a: 1, self: '[Circular]' });

            // Test error serialization
            const err = new Error('boom');
            const res = (devtools as any).safeJson(err);
            expect((res as any).message).toBe('boom');
        });
    });

    it('should send init message immediately on registerCNS', async () => {
        const mockCNS = new SimpleMockCNS();
        const transport = new CaptureTransport();

        const devtools = new CNSDevTools('test-app', transport, {
            devToolsInstanceId: 'test-app',
        });
        devtools.registerCNS(mockCNS as any, 'mockingCNS');

        // Wait for async init
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(transport.messages.length).toBeGreaterThan(0);
        expect(transport.messages[0].type).toBe('init');

        const initMsg = transport.messages[0].payload as InitMessage;
        expect(initMsg.neurons).toHaveLength(1);
        expect(initMsg.neurons[0].name).toBe('test-neuron');
        expect(initMsg.neurons[0].id).toBe('test-app:cns:test-neuron');
        expect(initMsg.collaterals).toHaveLength(1);
        expect(initMsg.collaterals[0].name).toBe('test-output');
        expect(initMsg.collaterals[0].neuronId).toBe(
            'test-app:cns:test-neuron'
        );
    });

    it('should send response message when CNS triggers response', async () => {
        const mockCNS = new SimpleMockCNS();
        const transport = new CaptureTransport();

        const devtools = new CNSDevTools('test-app', transport, {
            devToolsInstanceId: 'test-app',
            cnsId: 'test-app:core',
        });
        devtools.registerCNS(mockCNS as any, 'mockingCNS');

        await new Promise(resolve => setTimeout(resolve, 0));

        // Clear init message
        transport.messages = [];

        // Trigger a response
        mockCNS.triggerResponse({
            inputSignal: {
                collateralName: 'test-input',
                payload: { data: 'input' },
            },
            outputSignal: {
                collateralName: 'test-output',
                payload: { data: 'output' },
            },
            stimulationId: 'stim-123',
        });

        await new Promise(resolve => setTimeout(resolve, 0));

        // Should have exactly 1 response message (NO stimulation message)
        expect(transport.messages.length).toBe(1);
        expect(transport.messages[0].type).toBe('response');

        const respMsg = transport.messages[0].payload as NeuronResponseMessage;
        expect(respMsg.appId).toBe('test-app');
        expect(respMsg.stimulationId).toBe('stim-123');
        expect(respMsg.inputCollateralName).toBe('test-input');
        expect(respMsg.outputCollateralName).toBe('test-output');
    });

    it('should handle response with missing outputSignal gracefully', async () => {
        const mockCNS = new SimpleMockCNS();
        const transport = new CaptureTransport();

        const devtools = new CNSDevTools('test-app', transport, {
            devToolsInstanceId: 'test-app',
        });
        devtools.registerCNS(mockCNS as any, 'mockingCNS');

        await new Promise(resolve => setTimeout(resolve, 0));
        transport.messages = [];

        // Trigger response without outputSignal
        mockCNS.triggerResponse({
            inputSignal: {
                collateralName: 'test-input',
                payload: { data: 'input' },
            },
            // No outputSignal
        });

        await new Promise(resolve => setTimeout(resolve, 0));

        // Should still send response, but with "unknown" neuronId
        expect(transport.messages.length).toBe(1);
        expect(transport.messages[0].type).toBe('response');

        const respMsg = transport.messages[0].payload as NeuronResponseMessage;
        expect(respMsg.outputCollateralName).toBeUndefined();
    });

    it('should send correct message order: init → response(s)', async () => {
        const mockCNS = new SimpleMockCNS();
        const transport = new CaptureTransport();

        const devtools = new CNSDevTools('test-app', transport, {
            devToolsInstanceId: 'test-app',
        });
        devtools.registerCNS(mockCNS as any, 'mockingCNS');

        await new Promise(resolve => setTimeout(resolve, 0));

        // Trigger multiple responses
        mockCNS.triggerResponse({
            inputSignal: {
                collateralName: 'test-input',
                payload: {},
            },
            outputSignal: {
                collateralName: 'test-output',
                payload: { n: 1 },
            },
            stimulationId: 'stim-1',
        });

        mockCNS.triggerResponse({
            inputSignal: {
                collateralName: 'test-input',
                payload: {},
            },
            outputSignal: {
                collateralName: 'test-output',
                payload: { n: 2 },
            },
            stimulationId: 'stim-2',
        });

        await new Promise(resolve => setTimeout(resolve, 0));

        // Order: init, response, response
        expect(transport.messages.length).toBe(3);
        expect(transport.messages[0].type).toBe('init');
        expect(transport.messages[1].type).toBe('response');
        expect(transport.messages[2].type).toBe('response');
    });
});
