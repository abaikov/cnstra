import { collateral, neuron, createCNS } from '../src/index';

type TStore = { seen: string[] };

const ping = collateral<{ id: string }>();
const done = collateral<{ id: string }>();

const createWorkerNeuron = (store: TStore) =>
    neuron({ done }).dendrite({
        collateral: ping,
        response: ({ id }, axon) => {
            store.seen.push(`worker:${id}`);
            return axon.done.createSignal({ id });
        },
    });

const createAuditNeuron = (store: TStore) =>
    neuron({}).dendrite({
        collateral: done,
        response: ({ id }) => {
            store.seen.push(`audit:${id}`);
            return undefined;
        },
    });

const neuronFactories = [createWorkerNeuron, createAuditNeuron];

describe('createCNS: dependencies through neuron factories', () => {
    it('gives each CNS its own dependency while the collaterals stay shared module values', async () => {
        const storeA: TStore = { seen: [] };
        const storeB: TStore = { seen: [] };
        const cnsA = createCNS(neuronFactories, storeA);
        const cnsB = createCNS(neuronFactories, storeB);

        await cnsA.stimulate(ping.createSignal({ id: 'x' })).waitUntilComplete();
        await cnsB.stimulate(ping.createSignal({ id: 'y' })).waitUntilComplete();

        expect(storeA.seen).toEqual(['worker:x', 'audit:x']);
        expect(storeB.seen).toEqual(['worker:y', 'audit:y']);
    });

    it('refuses at compile time dependencies a neuron factory does not take', () => {
        const refused = () => {
            // @ts-expect-error
            createCNS(neuronFactories, { seen: 'not a list' });
            // @ts-expect-error
            createCNS([createWorkerNeuron, (clock: { nowMs: number }) => neuron({}).dendrite({ collateral: ping, response: () => { void clock.nowMs; } })], { seen: [] });
        };

        expect(refused).toBeInstanceOf(Function);
    });

    it('takes a literal the factory narrows, and refuses a neuron factory listed twice', () => {
        const createLevelNeuron = (dependencies: { level: 'info' | 'debug' }) =>
            neuron({}).dendrite({ collateral: done, response: () => { void dependencies.level; } });

        expect(createCNS([createLevelNeuron], { level: 'info' })).toBeDefined();
        expect(() => createCNS([createAuditNeuron, createAuditNeuron], { seen: [] }))
            .toThrow('createCNS: a neuron factory is listed twice; every dendrite of its neuron would run twice');
    });
});
