import { CNS, collateral, withCtx } from '@cnstra/core';
import { CNSDevTools } from '../src';
import { FakeTransport } from './fakeTransport';

describe('CNSDevTools stimulate', () => {
    it('calls cns.stimulate via transport command', async () => {
        const ping = collateral<'payload', 'ping'>('ping');
        const A = withCtx<unknown>()
            .neuron('A', { ping })
            .dendrite({ collateral: ping, response: () => undefined });
        const cns = new CNS<any, any, any, any>([A as any]);

        const transport = new FakeTransport();
        // eslint-disable-next-line no-new
        new CNSDevTools(cns as any, transport as any, {
            devToolsInstanceId: 'test-app',
            devToolsInstanceName: 'Test App',
        });

        let called = false;
        const orig = (cns as any).stimulate.bind(cns);
        (cns as any).stimulate = (...args: any[]) => {
            called = true;
            return orig(...args);
        };

        // register handler
        transport.onStimulateCommand?.(() => () => {});
        // trigger command
        transport.triggerStimulate({
            type: 'stimulate',
            stimulationCommandId: 's-1',
            collateralName: 'ping',
        } as any);

        await new Promise(r => setTimeout(r, 0));
        expect(called).toBe(true);
    });
});
