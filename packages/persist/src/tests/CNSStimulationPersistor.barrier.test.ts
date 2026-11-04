import { CNS, collateral, neuron } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '.././CNSPersistOptionsRegistry';
import { CNSStimulationPersistor } from '.././CNSStimulationPersistor';
import type { ICNSStimulationWriter } from '.././interfaces/ICNSStimulationRepository';

/**
 * The guarantee the docs call "per-hop barrier (exactly-resumable)": no
 * activation runs ahead of a checkpoint that has not been stored.
 *
 * These tests pin the GUARANTEE, not the implementation — the interleaving of
 * hops and writes, and what happens when a write fails. The engine has always
 * been able to provide it (an async response listener parks the hop's
 * subscribers); what was missing was a recorder willing to return a promise.
 */

const ENTRY = [{ collateralName: 'input', payload: { id: 1 } }];

/** Records the order of hops and writes, with a controllable write delay. */
const slowWriter = (delayMs: number) => {
    const log: string[] = [];
    let writes = 0;

    const writer: ICNSStimulationWriter = {
        async saveStimulation() {
            const n = ++writes;
            log.push(`write${n}:start`);
            await new Promise(r => setTimeout(r, delayMs));
            log.push(`write${n}:done`);
        },
        async saveAttempt() {},
        async appendTask() {},
        async getStimulation() {
            return undefined;
        },
    };

    return { writer, log };
};

const buildFlow = (log: string[]) => {
    const input = collateral<{ id: number }>();
    const mid = collateral<{ id: number }>();
    const out = collateral<{ result: string }>();

    const first = neuron({ mid }).dendrite({
        collateral: input,
        response: (p, axon) => {
            log.push('hop:first');
            return axon.mid.createSignal({ id: p!.id });
        },
    });
    const second = neuron({ out }).dendrite({
        collateral: mid,
        response: (p, axon) => {
            log.push('hop:second');
            return axon.out.createSignal({ result: `ok-${p!.id}` });
        },
    });

    const cns = new CNS([first, second]);
    const registry = new CNSPersistOptionsRegistry();
    registry.register('first', first);
    registry.register('second', second);
    registry.registerCollateral('input', input);
    return { cns, registry, input };
};

const run = async (barrier: boolean) => {
    const sink = slowWriter(30);
    const { cns, registry, input } = buildFlow(sink.log);

    const persistor = new CNSStimulationPersistor({
        repository: sink.writer,
        registry,
        stimulationId: 'run-1',
        stimulationAttemptId: 'run-1#1',
        attemptNumber: 1,
        entry: ENTRY,
        volume: 'full',
        barrier,
    });

    const stimulation = cns.stimulate(input.createSignal({ id: 1 }), {
        onResponse: persistor.onResponse,
    });
    await stimulation.waitUntilComplete().catch(() => {});
    await new Promise(r => setTimeout(r, 80));
    persistor.dispose();

    return sink.log;
};

describe('barrier', () => {
    it('holds the next hop until the previous checkpoint has landed', async () => {
        const log = await run(true);

        const secondHop = log.indexOf('hop:second');
        const firstWriteDone = log.indexOf('write1:done');

        expect(secondHop).toBeGreaterThan(-1);
        expect(firstWriteDone).toBeGreaterThan(-1);
        // The whole guarantee, in one comparison.
        expect(firstWriteDone).toBeLessThan(secondHop);
    });

    it('without it, the run races ahead of its own writes', async () => {
        // Not a defect — the default trades the guarantee for throughput. Pinned
        // so the difference between the two modes stays visible.
        const log = await run(false);

        const secondHop = log.indexOf('hop:second');
        const firstWriteDone = log.indexOf('write1:done');

        expect(secondHop).toBeLessThan(firstWriteDone);
    });

    it('fails the run when a checkpoint cannot be stored', async () => {
        // Under a barrier, continuing past an unstored checkpoint is exactly what
        // the caller asked not to happen — so the write failure must reach them.
        const log: string[] = [];
        const { cns, registry, input } = buildFlow(log);

        const persistor = new CNSStimulationPersistor({
            repository: {
                async saveStimulation() {
                    throw new Error('store is down');
                },
                async saveAttempt() {},
                async appendTask() {},
                async getStimulation() {
                    return undefined;
                },
            },
            registry,
            stimulationId: 'run-1',
            stimulationAttemptId: 'run-1#1',
            attemptNumber: 1,
            entry: ENTRY,
            volume: 'full',
            barrier: true,
        });

        await expect(
            cns
                .stimulate(input.createSignal({ id: 1 }), {
                    onResponse: persistor.onResponse,
                })
                .waitUntilComplete()
        ).rejects.toThrow(/store is down/);

        persistor.dispose();
    });

    it('a failing write is reported and does not take the host process down', async () => {
        // Without a barrier nobody awaits the write, and an unobserved rejection
        // terminates the process under Node's default — a store hiccup must not
        // kill the application. It is reported and dropped; retrying it properly
        // belongs in the writer, not here.
        const log: string[] = [];
        const { cns, registry, input } = buildFlow(log);

        const persistor = new CNSStimulationPersistor({
            repository: {
                async saveStimulation() {
                    throw new Error('store is down');
                },
                async saveAttempt() {},
                async appendTask() {},
                async getStimulation() {
                    return undefined;
                },
            },
            registry,
            stimulationId: 'run-1',
            stimulationAttemptId: 'run-1#1',
            attemptNumber: 1,
            entry: ENTRY,
            volume: 'full',
        });

        const errors: unknown[][] = [];
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation((...args: unknown[]) => void errors.push(args));

        try {
            await expect(
                cns
                    .stimulate(input.createSignal({ id: 1 }), {
                        onResponse: persistor.onResponse,
                    })
                    .waitUntilComplete()
            ).resolves.toBeUndefined();
            await new Promise(r => setTimeout(r, 20));
        } finally {
            consoleError.mockRestore();
            persistor.dispose();
        }

        // Reported, not swallowed.
        expect(
            errors.filter(
                e =>
                    typeof e[0] === 'string' &&
                    e[0].includes('a stimulation write failed')
            ).length
        ).toBeGreaterThan(0);
    });
});
