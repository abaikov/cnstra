import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import {
    CNSPersistOptionsRegistry,
    CNSProgressSerializer,
} from '@cnstra/persist';
import type {
    ICNSProgressRepository,
    ICNSStimulationWriter,
} from '@cnstra/persist';
import type {
    TCNSProgress,
    TCNSStimulationAttempt,
    TCNSStimulationState,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';
import type { ICNSStimulation } from '@cnstra/types';

import { runCNSStimulationJob } from '.././runCNSStimulationJob';
import type { TCNSRunStimulationJobParams } from '.././runCNSStimulationJob';

/**
 * One job = one stimulation. These pin the behaviour every broker adapter
 * inherits: what reaches the observability store, what reaches the resume store,
 * and what a retry of the same job id actually re-runs.
 */

const recordingObserve = () => {
    const attempts: TCNSStimulationAttempt[] = [];
    const tasks: TCNSStimulationTask[] = [];
    const stimulations: TCNSStimulationState[] = [];

    const writer: ICNSStimulationWriter = {
        async saveStimulation(stimulation) {
            stimulations.push(stimulation);
        },
        async saveAttempt(attempt) {
            attempts.push(attempt);
        },
        async appendTask(task) {
            tasks.push(task);
        },
        async getStimulation() {
            return undefined;
        },
    };

    return { writer, attempts, tasks, stimulations };
};

const memoryProgress = () => {
    const store = new Map<string, TCNSProgress>();
    const repo: ICNSProgressRepository = {
        async save(key, progress) {
            store.set(key, progress);
        },
        async load(key) {
            return store.get(key);
        },
        async delete(key) {
            store.delete(key);
        },
    };
    return { repo, store };
};

/** input → step → done; `control.fail` makes `step` throw on the current pass. */
const buildFlow = () => {
    const input = cnsCollateral<{ id: number }>();
    const stepped = cnsCollateral<{ id: number }>();
    const done = cnsCollateral<{ ok: true }>();
    const control = { fail: true, stepCalls: 0, doneCalls: 0 };

    const step = cnsNeuron({ stepped }).dendrite({
        collateral: input,
        response: (p, axon) => {
            control.stepCalls += 1;
            return axon.stepped.createSignal({ id: p!.id });
        },
    });
    const finish = cnsNeuron({ done }).dendrite({
        collateral: stepped,
        response: (_p, axon) => {
            control.doneCalls += 1;
            if (control.fail) throw new Error('downstream is down');
            return axon.done.createSignal({ ok: true });
        },
    });

    const cns = new CNS([step, finish]);
    const registry = new CNSPersistOptionsRegistry();
    registry.register('step', step);
    registry.register('finish', finish);
    registry.registerCollateral('input', input);

    return { cns, registry, control };
};

const params = (
    over: Partial<TCNSRunStimulationJobParams> & Pick<TCNSRunStimulationJobParams, 'cns' | 'registry'>
): TCNSRunStimulationJobParams => ({
    pkgName: '@cnstra/test',
    stopping: false,
    jobId: 'job-1',
    collateralName: 'input',
    payload: { id: 1 },
    attemptNumber: 1,
    abort: new AbortController(),
    active: new Set<ICNSStimulation<any>>(),
    ...over,
});

describe('runCNSStimulationJob', () => {
    it('refuses the job while the worker is shutting down so it retries later', async () => {
        const { cns, registry } = buildFlow();

        await expect(
            runCNSStimulationJob(params({ cns, registry, stopping: true }))
        ).rejects.toThrow(/shutting down/);
    });

    it('rejects an unregistered collateral by name instead of running nothing', async () => {
        const { cns, registry } = buildFlow();

        await expect(
            runCNSStimulationJob(
                params({ cns, registry, collateralName: 'not-registered' })
            )
        ).rejects.toThrow(/Unknown collateral/);
    });

    it('rethrows a flow failure so the broker applies its own retry policy', async () => {
        const { cns, registry } = buildFlow();

        await expect(runCNSStimulationJob(params({ cns, registry }))).rejects.toThrow();
    });

    it('records the run under the job id, one attempt per broker attempt', async () => {
        const { cns, registry, control } = buildFlow();
        control.fail = false;
        const observe = recordingObserve();

        await runCNSStimulationJob(
            params({ cns, registry, observe: observe.writer, attemptNumber: 2 })
        );
        await new Promise(r => setTimeout(r, 20));

        const last = observe.attempts[observe.attempts.length - 1];
        expect(last.stimulationId).toBe('job-1');
        expect(last.stimulationAttemptId).toBe('job-1#2');
        expect(last.attemptNumber).toBe(2);
    });

    it('drops the resume checkpoint once the job succeeds', async () => {
        const { cns, registry, control } = buildFlow();
        control.fail = false;
        const progress = memoryProgress();
        await progress.repo.save('job-1', { tasks: [] });

        await runCNSStimulationJob(
            params({
                cns,
                registry,
                serializer: new CNSProgressSerializer(registry),
                resumeRepo: progress.repo,
            })
        );

        expect(progress.store.has('job-1')).toBe(false);
    });

    it('saves the exact final frontier when the job fails', async () => {
        const { cns, registry } = buildFlow();
        const progress = memoryProgress();

        await runCNSStimulationJob(
            params({
                cns,
                registry,
                serializer: new CNSProgressSerializer(registry),
                resumeRepo: progress.repo,
            })
        ).catch(() => {});

        const saved = progress.store.get('job-1');
        expect(saved).toBeDefined();
        expect(saved!.tasks.length).toBeGreaterThan(0);
    });

    it('resumes the frontier on the retry instead of re-running the whole flow', async () => {
        const { cns, registry, control } = buildFlow();
        const progress = memoryProgress();
        const serializer = new CNSProgressSerializer(registry);

        // Attempt 1 fails at `finish`; `step` has already succeeded.
        await runCNSStimulationJob(
            params({ cns, registry, serializer, resumeRepo: progress.repo })
        ).catch(() => {});
        expect(control.stepCalls).toBe(1);
        expect(control.doneCalls).toBe(1);

        // Attempt 2 of the SAME job id, with the fault cleared.
        control.fail = false;
        await runCNSStimulationJob(
            params({
                cns,
                registry,
                serializer,
                resumeRepo: progress.repo,
                attemptNumber: 2,
            })
        );

        // The already-done hop must NOT run again — that is the whole point of resume.
        expect(control.stepCalls).toBe(1);
        expect(control.doneCalls).toBe(2);
    });

    it('leaves nothing in the in-flight set once the job settles', async () => {
        const { cns, registry, control } = buildFlow();
        control.fail = false;
        const active = new Set<ICNSStimulation<any>>();

        await runCNSStimulationJob(params({ cns, registry, active }));

        expect(active.size).toBe(0);
    });

    it('clears the in-flight set on the failure path too', async () => {
        const { cns, registry } = buildFlow();
        const active = new Set<ICNSStimulation<any>>();

        await runCNSStimulationJob(params({ cns, registry, active })).catch(() => {});

        expect(active.size).toBe(0);
    });

    /**
     * The two stores must agree on what is left to do. The broker's retry reads
     * `resumeRepo`; the DevTools Retry button reads `observe`. If they disagree,
     * the same run resumes from two different points depending on who retried it.
     */
    const frontierNames = (progress: TCNSProgress) =>
        progress.tasks.map(t => t.neuronName).sort();

    it('both stores end up with the SAME frontier when the job fails', async () => {
        const { cns, registry } = buildFlow();
        const observe = recordingObserve();
        const progress = memoryProgress();

        await runCNSStimulationJob(
            params({
                cns,
                registry,
                observe: observe.writer,
                serializer: new CNSProgressSerializer(registry),
                resumeRepo: progress.repo,
            })
        ).catch(() => {});
        await new Promise(r => setTimeout(r, 30));

        const resumeFrontier = progress.store.get('job-1')!;
        const observed = observe.stimulations[observe.stimulations.length - 1];

        expect(resumeFrontier.tasks.length).toBeGreaterThan(0);
        expect(observed).toBeDefined();
        expect(frontierNames(observed.progress)).toEqual(
            frontierNames(resumeFrontier)
        );
    });

    it('both stores agree when the run is ABORTED mid-flight, too', async () => {
        // The shutdown-drain path: the worker aborts in-flight runs. Until the
        // engine announced the ending, no terminal flush reached `observe` at all
        // and the run stayed `running` with a stale frontier.
        // Aborting does not cancel a body already running — it stops what has not
        // started. So the flow needs a second hop still queued when the abort lands.
        const input = cnsCollateral<{ id: number }>();
        const stepped = cnsCollateral<{ id: number }>();
        const done = cnsCollateral<{ ok: true }>();

        const slow = cnsNeuron({ stepped }).dendrite({
            collateral: input,
            response: async (p, axon) => {
                await new Promise(r => setTimeout(r, 50));
                return axon.stepped.createSignal({ id: p!.id });
            },
        });
        const never = cnsNeuron({ done }).dendrite({
            collateral: stepped,
            response: (_p, axon) => axon.done.createSignal({ ok: true }),
        });

        const cns = new CNS([slow, never]);
        const registry = new CNSPersistOptionsRegistry();
        registry.register('slow', slow);
        registry.register('never', never);
        registry.registerCollateral('input', input);

        const observe = recordingObserve();
        const progress = memoryProgress();
        const abort = new AbortController();

        const running = runCNSStimulationJob(
            params({
                cns,
                registry,
                observe: observe.writer,
                serializer: new CNSProgressSerializer(registry),
                resumeRepo: progress.repo,
                abort,
            })
        ).catch(() => {});

        await new Promise(r => setTimeout(r, 10));
        abort.abort();
        await running;
        await new Promise(r => setTimeout(r, 30));

        const observed = observe.stimulations[observe.stimulations.length - 1];
        expect(observed).toBeDefined();
        expect(observed.status).toBe('aborted');
        expect(frontierNames(observed.progress)).toEqual(
            frontierNames(progress.store.get('job-1')!)
        );
    });
});
