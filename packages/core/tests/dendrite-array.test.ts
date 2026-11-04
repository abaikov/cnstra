import { CNS, collateral, neuron } from '../src/index';

const ping = collateral<{ id: string }>();
const pong = collateral<{ id: string }>();
const done = collateral<{ id: string }>();

describe('neuron.dendrite with a list of dendrites', () => {
    it('attaches every dendrite of the list, in order, and chains on', async () => {
        const seen: string[] = [];
        const pieces = neuron({ done })
            .dendrite({ collateral: ping, response: ({ id }, axon) => axon.done.createSignal({ id: `ping:${id}` }) })
            .dendrite({ collateral: pong, response: ({ id }, axon) => axon.done.createSignal({ id: `pong:${id}` }) })
            .dendrites;
        const owner = neuron({ done })
            .dendrite(pieces)
            .dendrite({ collateral: ping, response: ({ id }) => { seen.push(`own:${id}`); } });
        const audit = neuron({}).dendrite({ collateral: done, response: ({ id }) => { seen.push(id); } });
        const cns = new CNS([owner, audit]);

        await cns.stimulate([ping.createSignal({ id: 'a' }), pong.createSignal({ id: 'b' })]).waitUntilComplete();

        expect(owner.dendrites).toHaveLength(3);
        expect(owner.dendrites[0]).toBe(pieces[0]);
        expect(owner.dendrites[1]).toBe(pieces[1]);
        expect([...seen].sort()).toEqual(['own:a', 'ping:a', 'pong:b']);
    });

    it('puts the list beside a dendrite of the array-collateral form', () => {
        const response = () => undefined;
        const owner = neuron({}).dendrite([{ collateral: ping, response }]).dendrite({ collateral: [ping, pong], response });

        expect(owner.dendrites.map(dendrite => dendrite.collateral)).toEqual([ping, ping, pong]);
    });

    it('refuses at compile time a list made for another axon', () => {
        const pieces = neuron({ done }).dendrite({ collateral: ping, response: ({ id }, axon) => axon.done.createSignal({ id }) }).dendrites;
        const refused = () => {
            // @ts-expect-error
            neuron({ pong }).dendrite(pieces);
        };

        expect(refused).toBeInstanceOf(Function);
    });
});
