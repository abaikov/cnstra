import { CNS, collateral, withCtx } from '@cnstra/core';
import { CNSDevTools } from '../src';
import { FakeTransport } from './fakeTransport';

describe('CNSDevTools init', () => {
    it('sends InitMessage with neurons, collaterals and dendrites', async () => {
        const ping = collateral<'payload', 'ping'>('ping');
        const pong = collateral<'payload', 'pong'>('pong');

        const A = withCtx<unknown>()
            .neuron<'A', 'pong', any>('A', { ping })
            .dendrite({ collateral: pong, response: () => undefined });

        const B = withCtx<unknown>()
            .neuron<'B', 'ping', any>('B', { pong })
            .dendrite({ collateral: ping, response: () => undefined });

        const cns = new CNS<any, any, any, any>([A as any, B as any]);

        const transport = new FakeTransport();
        // eslint-disable-next-line no-new
        new CNSDevTools(cns as any, transport as any, {
            devToolsInstanceId: 'test-app',
            devToolsInstanceName: 'Test App',
        });

        // allow async init
        await new Promise(r => setTimeout(r, 0));

        expect(transport.inits.length).toBe(1);
        const init = transport.inits[0];
        expect(init.type).toBe('init');
        expect(init.neurons.length).toBe(2);
        expect(init.collaterals.length).toBeGreaterThanOrEqual(2);
        expect(init.dendrites.length).toBeGreaterThanOrEqual(2);

        // DTO shape checks
        init.neurons.forEach(n => {
            expect(typeof n.neuronId).toBe('string');
            expect(n.appId).toBe('test-app');
            expect(Array.isArray(n.axonCollaterals)).toBe(true);
        });
        init.collaterals.forEach(c => {
            expect(typeof c.collateralName).toBe('string');
            expect(typeof c.neuronId).toBe('string');
            expect(c.appId).toBe('test-app');
        });
    });
});
