import {
    computeFrontier,
    frontierSeverity,
    type ComputeFrontierInput,
} from '../frontier';

const CNS = 'app:main';
// Output frontier keys are nodeKeys `${cnsId}:${name}`.
const API = `${CNS}:api`;
const WORKER = `${CNS}:worker`;

const base = (
    over: Partial<ComputeFrontierInput> = {}
): ComputeFrontierInput => ({
    now: 10_000,
    hops: [],
    stimulations: [
        { stimulationId: 'stim-1', completedAt: null, startedAt: 9_000 },
    ],
    // worker subscribes 'request' (owned by api).
    dendrites: [{ cnsId: CNS, neuronName: 'worker', collateralName: 'request' }],
    collaterals: [
        { cnsId: CNS, name: 'request', ownerNeuronName: 'api' },
        { cnsId: CNS, name: 'done', ownerNeuronName: 'worker' },
    ],
    ...over,
});

describe('frontierSeverity', () => {
    it('buckets age into 1 (fresh) / 2 (waiting) / 3 (stuck)', () => {
        expect(frontierSeverity(0)).toBe(1);
        expect(frontierSeverity(999)).toBe(1);
        expect(frontierSeverity(1000)).toBe(2);
        expect(frontierSeverity(3999)).toBe(2);
        expect(frontierSeverity(4000)).toBe(3);
        expect(frontierSeverity(60_000)).toBe(3);
    });
});

describe('computeFrontier', () => {
    it('marks the subscriber of a just-emitted collateral as the frontier', () => {
        const f = computeFrontier(
            base({
                hops: [
                    {
                        stimulationId: 'stim-1',
                        scopeName: CNS,
                        neuronName: 'api',
                        outputCollateralName: 'request',
                        startedAt: 5_000,
                    },
                ],
            })
        );
        // worker is about to run; its "since" is the pointing hop's startedAt
        expect(f.neurons[WORKER]).toBe(5_000);
        expect(f.edges[`${API}->${WORKER}::request`]).toBe(5_000);
        // the producer that already ran is NOT on the frontier
        expect(f.neurons[API]).toBeUndefined();
    });

    it('ages to a stuck severity given the hop timestamp', () => {
        const f = computeFrontier(
            base({
                now: 10_000,
                hops: [
                    {
                        stimulationId: 'stim-1',
                        scopeName: CNS,
                        neuronName: 'api',
                        outputCollateralName: 'request',
                        startedAt: 5_000, // 5s ago
                    },
                ],
            })
        );
        expect(frontierSeverity(10_000 - f.neurons[WORKER])).toBe(3);
    });

    it('drops a neuron from the frontier once it has produced a hop', () => {
        const f = computeFrontier(
            base({
                hops: [
                    {
                        stimulationId: 'stim-1',
                        scopeName: CNS,
                        neuronName: 'api',
                        outputCollateralName: 'request',
                        startedAt: 5_000,
                    },
                    // worker ran → no longer "about to run"
                    {
                        stimulationId: 'stim-1',
                        scopeName: CNS,
                        neuronName: 'worker',
                        outputCollateralName: 'done',
                        startedAt: 6_000,
                    },
                ],
            })
        );
        expect(f.neurons[WORKER]).toBeUndefined();
    });

    it('ignores completed stimulations', () => {
        const f = computeFrontier(
            base({
                stimulations: [
                    { stimulationId: 'stim-1', completedAt: 9_500, startedAt: 9_000 },
                ],
                hops: [
                    {
                        stimulationId: 'stim-1',
                        scopeName: CNS,
                        neuronName: 'api',
                        outputCollateralName: 'request',
                        startedAt: 5_000,
                    },
                ],
            })
        );
        expect(f.neurons).toEqual({});
        expect(f.edges).toEqual({});
    });

    it('ignores stimulations older than the window', () => {
        const f = computeFrontier(
            base({
                now: 10_000_000,
                windowMs: 1_000,
                stimulations: [
                    { stimulationId: 'stim-1', completedAt: null, startedAt: 0 },
                ],
                hops: [
                    {
                        stimulationId: 'stim-1',
                        scopeName: CNS,
                        neuronName: 'api',
                        outputCollateralName: 'request',
                        startedAt: 0,
                    },
                ],
            })
        );
        expect(f.neurons).toEqual({});
    });

    it('does not put a self-subscribing neuron on its own frontier', () => {
        const f = computeFrontier(
            base({
                // api subscribes its own output
                dendrites: [{ cnsId: CNS, neuronName: 'api', collateralName: 'request' }],
                hops: [
                    {
                        stimulationId: 'stim-1',
                        scopeName: CNS,
                        neuronName: 'api',
                        outputCollateralName: 'request',
                        startedAt: 5_000,
                    },
                ],
            })
        );
        expect(f.neurons[API]).toBeUndefined();
    });
});
