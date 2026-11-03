import { CNS, cnsCollateral, cnsNeuron } from '../src/index';

describe('an async response that returns a signal on one branch and nothing on another', () => {
    const requested = cnsCollateral<{ skip: boolean; fanOut: boolean }>();
    const handled = cnsCollateral<{ copy: number }>();

    const handler = cnsNeuron({ handled }).dendrite({
        collateral: requested,
        response: async (payload, axon) => {
            await Promise.resolve();
            if (payload.skip) return;
            if (payload.fanOut) return [axon.handled.createSignal({ copy: 1 }), axon.handled.createSignal({ copy: 2 })];
            return axon.handled.createSignal({ copy: 0 });
        },
    });

    const received: number[] = [];
    const sink = cnsNeuron({}).dendrite({
        collateral: handled,
        response: payload => {
            received.push(payload.copy);
        },
    });

    const cns = new CNS([handler, sink]);

    beforeEach(() => {
        received.length = 0;
    });

    it('stops quietly when it returns nothing', async () => {
        const stimulation = cns.stimulate(requested.createSignal({ skip: true, fanOut: false }));
        await stimulation.waitUntilComplete();
        expect(received).toEqual([]);
        expect(stimulation.getFailedTasks()).toEqual([]);
    });

    it('routes the one signal it returns', async () => {
        await cns.stimulate(requested.createSignal({ skip: false, fanOut: false })).waitUntilComplete();
        expect(received).toEqual([0]);
    });

    it('routes every signal of the array it returns', async () => {
        await cns.stimulate(requested.createSignal({ skip: false, fanOut: true })).waitUntilComplete();
        expect(received).toEqual([1, 2]);
    });
});
