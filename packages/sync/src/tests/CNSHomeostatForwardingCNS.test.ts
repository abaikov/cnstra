import { CNS, collateral, neuron } from '@cnstra/core';
import { CNSHomeostatForwardingCNS } from '@cnstra/sync';

describe('CNSHomeostatForwardingCNS: the CNS a homeostat environment gets before the CNS exists', () => {
    it('refuses to stimulate and to batch before it is bound', () => {
        const forwardingCNS = new CNSHomeostatForwardingCNS();
        const ping = collateral();
        const message = 'CNSHomeostatForwardingCNS: the CNS is not assembled yet; a homeostat stimulates only after assembleCNSHomeostatSchema returns';

        expect(() => forwardingCNS.stimulate(ping.createSignal(), {})).toThrow(message);
        expect(() => forwardingCNS.batch(() => 1)).toThrow(message);
    });

    it('forwards stimulate and batch to the bound CNS', async () => {
        const forwardingCNS = new CNSHomeostatForwardingCNS();
        const ping = collateral<{ id: string }>();
        const heard: string[] = [];
        const cns = new CNS([neuron({}).dendrite({ collateral: ping, response: ({ id }) => { heard.push(id); } })]);
        forwardingCNS.bind(cns);

        await forwardingCNS.stimulate(ping.createSignal({ id: 'p1' }), {}).waitUntilComplete();

        expect(heard).toEqual(['p1']);
        expect(forwardingCNS.batch(() => 'batched')).toBe('batched');
    });

    it('adds to the bound CNS a drain listener it was given before and after it was bound', async () => {
        const forwardingCNS = new CNSHomeostatForwardingCNS();
        const ping = collateral();
        const drains: string[] = [];
        forwardingCNS.addDrainListener(() => { drains.push('before'); });
        const cns = new CNS([neuron({}).dendrite({ collateral: ping, response: () => undefined })]);
        forwardingCNS.bind(cns);
        forwardingCNS.addDrainListener(() => { drains.push('after'); });

        await forwardingCNS.stimulate(ping.createSignal(), {}).waitUntilComplete();

        expect(drains).toEqual(['before', 'after']);
    });
});
