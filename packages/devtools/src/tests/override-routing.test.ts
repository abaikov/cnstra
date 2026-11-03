import { CNSDevTools } from '../index';
import type { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import { CNS, cnsCollateral, cnsNeuronFactory } from '@cnstra/core';
import {
    CNSInMemoryStimulationRepository,
    CNSPersistOptionsRegistry,
} from '@cnstra/persist';
import type {
    TCNSAppBatchMessageDTO,
    TCNSAppCommandDTO,
} from '@cnstra/devtools-dto';

/**
 * WHO wears the identity a server-forwarded retry assigned.
 *
 * The identity (stimulationId + attempt id + attempt number) belongs to the run
 * the server asked for, and to nothing else. A resume whose first frontier neuron
 * is async returns from `cns.activate` having reported nothing at all — and an
 * app is a live process: an HTTP handler or a queue worker can start a completely
 * unrelated run inside that window. That run must keep its own identity, and the
 * retried run must still get the assigned one.
 */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type TDeferred = { promise: Promise<void>; release: () => void };
const deferred = (): TDeferred => {
    let release!: () => void;
    const promise = new Promise<void>(resolve => {
        release = resolve;
    });
    return { promise, release };
};

let shouldFail = true;
/** While set, persistUser parks on it — the async window a resume runs into. */
let persistUserGate: TDeferred | undefined;

/** importUser (sync, always ok) → persistUser (ASYNC, throws while `shouldFail`). */
function buildCNS() {
    const entryCol = cnsCollateral<{ id: string }>();
    const importedCol = cnsCollateral<{ id: string; name: string }>();

    const importUser = cnsNeuronFactory()
        .neuron({ importedCol })
        .bind(
            { entryCol },
            {
                entryCol: ({ id }, axon) =>
                    axon.importedCol.createSignal({ id, name: 'Neo' }),
            }
        );

    const persistUser = cnsNeuronFactory()
        .neuron({})
        .bind(
            { importedCol },
            {
                importedCol: async () => {
                    // Async on purpose: a resumed frontier that starts here reports
                    // NOTHING until this settles.
                    if (persistUserGate) await persistUserGate.promise;
                    if (shouldFail) throw new Error('db timeout');
                },
            }
        );

    const cns = new CNS([importUser, persistUser]);

    const registry = new CNSPersistOptionsRegistry();
    registry
        .register('importUser', importUser, { importedCol: 'imported-col' })
        .register('persistUser', persistUser)
        .registerCollateral('entry-col', entryCol);

    return { cns, registry, entryCol };
}

/** The loopback the other resume tests use: batches land in a real store, and
 *  the test can push a server→app command back. */
class LoopbackTransport implements ICNSDevToolsTransport {
    private cmdHandler?: (cmd: TCNSAppCommandDTO) => void;

    constructor(private readonly repo: CNSInMemoryStimulationRepository) {}

    async sendBatch(message: TCNSAppBatchMessageDTO): Promise<void> {
        for (const item of message.items ?? []) {
            const any = item as any;
            if (any.type === 'cns.stimulation')
                await this.repo.saveStimulation(any.data);
            else if (any.type === 'cns.stimulation.attempt')
                await this.repo.saveAttempt(any.data);
            else if (any.type === 'cns.stimulation.task')
                await this.repo.appendTask(any.data);
        }
    }

    onStimulationCommand(handler: (cmd: TCNSAppCommandDTO) => void): () => void {
        this.cmdHandler = handler;
        return () => {
            this.cmdHandler = undefined;
        };
    }

    pushCommand(cmd: TCNSAppCommandDTO): void {
        this.cmdHandler?.(cmd);
    }
}

/** A wired app with one failed run in the store, ready to be retried. */
async function appWithAFailedRun() {
    const { cns, registry, entryCol } = buildCNS();
    const repo = new CNSInMemoryStimulationRepository();
    const transport = new LoopbackTransport(repo);
    const devtools = new CNSDevTools('test-app', transport, {
        cnsId: 'test-cns',
        trackStimulations: true,
    });
    devtools.registerCNS(cns as any, registry);

    await cns
        .stimulate(entryCol.createSignal({ id: '42' }))
        .waitUntilComplete()
        .catch(() => {});
    await sleep(50);

    const [failed] = await repo.listStimulations();
    return { cns, entryCol, repo, transport, failed };
}

const neuronNames = async (
    repo: CNSInMemoryStimulationRepository,
    attemptId: string
) => (await repo.getTasks(attemptId)).map(t => t.neuronName);

describe('a forwarded retry’s identity belongs to the run it was assigned for', () => {
    beforeEach(() => {
        shouldFail = true;
        persistUserGate = undefined;
    });

    it('a run started by someone else while the resume is still async is not recorded as the retry', async () => {
        const { cns, entryCol, repo, transport, failed } =
            await appWithAFailedRun();
        expect(failed.status).toBe('failed');
        expect(failed.progress.tasks.map(t => t.neuronName)).toEqual([
            'persistUser',
        ]);

        const retryAttemptId = `${failed.stimulationId}#2`;
        shouldFail = false;
        // The resumed frontier starts at persistUser, which now parks: `activate`
        // returns with the retry having reported nothing.
        persistUserGate = deferred();

        transport.pushCommand({
            type: 'cns.stimulation.resume',
            requestId: 'req-1',
            scopeName: failed.scopeName,
            stimulationId: failed.stimulationId,
            stimulationAttemptId: retryAttemptId,
            attemptNumber: 2,
            entry: failed.entry,
            progress: failed.progress,
        });

        // Same process, same tick, nothing to do with the retry: an HTTP handler.
        // Its entry response is emitted synchronously, i.e. it is the first run to
        // report after the retry was launched.
        const unrelated = cns.stimulate(
            entryCol.createSignal({ id: 'unrelated' })
        );

        persistUserGate.release();
        await unrelated.waitUntilComplete().catch(() => {});
        await sleep(50);

        // The retry wears the identity the server assigned — and it is a FRONTIER
        // resume, so only persistUser ran under it.
        const attempts = await repo.getAttempts(failed.stimulationId);
        expect(attempts.map(a => a.attemptNumber)).toEqual([1, 2]);
        expect(await neuronNames(repo, retryAttemptId)).toEqual(['persistUser']);

        // The unrelated run kept an identity of its own: a separate stimulation,
        // a full run from the entry.
        const others = (await repo.listStimulations()).filter(
            s => s.stimulationId !== failed.stimulationId
        );
        expect(others).toHaveLength(1);
        const [otherAttempt] = await repo.getAttempts(others[0].stimulationId);
        expect(otherAttempt.stimulationAttemptId).not.toBe(retryAttemptId);
        expect(await neuronNames(repo, otherAttempt.stimulationAttemptId)).toEqual(
            ['importUser', 'persistUser']
        );
    });

    it('an activate that throws leaves no identity behind for the next run to pick up', async () => {
        const { cns, entryCol, repo, transport, failed } =
            await appWithAFailedRun();
        const retryAttemptId = `${failed.stimulationId}#2`;
        shouldFail = false;

        const realActivate = (cns as any).activate.bind(cns);
        (cns as any).activate = () => {
            throw new Error('frontier hydration exploded');
        };
        expect(() =>
            transport.pushCommand({
                type: 'cns.stimulation.resume',
                requestId: 'req-1',
                scopeName: failed.scopeName,
                stimulationId: failed.stimulationId,
                stimulationAttemptId: retryAttemptId,
                attemptNumber: 2,
                entry: failed.entry,
                progress: failed.progress,
            })
        ).toThrow('frontier hydration exploded');
        (cns as any).activate = realActivate;

        // The very next run in this process is an ordinary app-initiated one.
        await cns
            .stimulate(entryCol.createSignal({ id: 'unrelated' }))
            .waitUntilComplete()
            .catch(() => {});
        await sleep(50);

        // The retry never ran, so its identity was never used by anything.
        expect(
            (await repo.getAttempts(failed.stimulationId)).map(
                a => a.attemptNumber
            )
        ).toEqual([1]);
        expect(await repo.getTasks(retryAttemptId)).toEqual([]);

        // ...and the unrelated run was recorded under an identity of its own.
        const others = (await repo.listStimulations()).filter(
            s => s.stimulationId !== failed.stimulationId
        );
        expect(others).toHaveLength(1);
        const [otherAttempt] = await repo.getAttempts(others[0].stimulationId);
        expect(otherAttempt.attemptNumber).toBe(1);
        expect(await neuronNames(repo, otherAttempt.stimulationAttemptId)).toEqual(
            ['importUser', 'persistUser']
        );
    });
});
