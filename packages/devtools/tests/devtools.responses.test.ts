import { CNS, collateral, withCtx } from '@cnstra/core';
import { CNSDevTools } from '../src';
import { FakeTransport } from './fakeTransport';

describe('CNSDevTools responses', () => {
    it('forwards NeuronResponseMessage with neuronId and collateralName', async () => {
        const ping = collateral<'payload', 'ping'>('ping');
        const A = withCtx<unknown>()
            .neuron<'A', never, any, any>('A', {})
            .dendrite({ collateral: ping, response: () => undefined });

        const cns = new CNS<any, any, any, any>([A as any]);

        const transport = new FakeTransport();
        // eslint-disable-next-line no-new
        new CNSDevTools(cns as any, transport as any, {
            devToolsInstanceId: 'test-app',
            devToolsInstanceName: 'Test App',
        });

        // Emit a real signal through CNS so DevTools captures response
        (cns.getCollaterals().find(c => (c as any).name === 'ping') as any)
            .createSignal
            ? cns.stimulate((ping as any).createSignal('payload'))
            : cns.stimulate({ collateral: ping, payload: 'payload' } as any);

        await new Promise(r => setTimeout(r, 0));
        expect(transport.responses.length).toBe(1);
        const msg = transport.responses[0];
        expect(typeof msg.stimulationId).toBe('string');
        expect(msg.neuronId).toBe('test-app:A');
        expect(msg.collateralName).toBe('ping');
        expect(msg.appId).toBe('test-app');
    });

    it('ensures neuron ID format consistency between init and response messages', async () => {
        const ping = collateral<'payload', 'ping'>('ping');
        const A = withCtx<unknown>()
            .neuron<'A', never, any, any>('A', {})
            .dendrite({ collateral: ping, response: () => undefined });

        const cns = new CNS<any, any, any, any>([A as any]);

        const transport = new FakeTransport();
        new CNSDevTools(cns as any, transport as any, {
            devToolsInstanceId: 'test-app',
            devToolsInstanceName: 'Test App',
        });

        // Trigger stimulation to generate both init and response messages
        (cns.getCollaterals().find(c => (c as any).name === 'ping') as any)
            .createSignal
            ? cns.stimulate((ping as any).createSignal('payload'))
            : cns.stimulate({ collateral: ping, payload: 'payload' } as any);

        await new Promise(r => setTimeout(r, 0));

        // Verify init message contains qualified neuron IDs
        expect(transport.inits.length).toBe(1);
        const initMessage = transport.inits[0];
        const neuronInInit = initMessage.neurons.find(n => n.name === 'A');
        expect(neuronInInit).toBeDefined();
        expect(neuronInInit!.id).toBe('test-app:A');

        // Verify response message uses the same qualified neuron ID format
        expect(transport.responses.length).toBe(1);
        const responseMessage = transport.responses[0];
        expect(responseMessage.neuronId).toBe('test-app:A');
        expect(responseMessage.appId).toBe('test-app');

        // Critical: neuron ID in response must match neuron ID in init
        expect(responseMessage.neuronId).toBe(neuronInInit!.id);
    });
});
