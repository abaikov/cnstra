import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import {
    CNS,
    CNSStimulationContextStore,
    withCtx,
    collateral,
    type TCNSNeuronActivationTask,
} from '@cnstra/core';

describe('BullMQ Integration Tests', () => {
    let redis: Redis;
    let queue: Queue;
    let worker: Worker;
    let queueEvents: QueueEvents;

    beforeAll(() => {
        redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
            maxRetriesPerRequest: null,
        });
    });

    afterEach(async () => {
        if (worker) {
            await worker.close();
        }
        if (queueEvents) {
            await queueEvents.close();
        }
        if (queue) {
            await queue.drain(true);
            await queue.close();
        }
    });

    afterAll(async () => {
        await redis.quit();
    });

    it('should preserve context and not re-execute completed tasks on retry (BullMQ)', async () => {
        const ctxBuilder = withCtx<{ executed: string[] }>();
        const input = collateral<{ id: number }>();
        const step1Out = collateral<{ id: number }>();
        const step2Out = collateral<{ id: number }>();
        const output = collateral<{ result: string }>();

        const executionLog: string[] = [];

        const step1 = ctxBuilder.neuron({ step1Out }).dendrite({
            collateral: input,
            response: async (payload, axon, ctx) => {
                executionLog.push(`step1-${payload.id}`);
                ctx.set({
                    executed: [
                        ...(ctx.get()?.executed || []),
                        `step1-${payload.id}`,
                    ],
                });
                await new Promise(resolve => setTimeout(resolve, 30));
                return axon.step1Out.createSignal({ id: payload.id });
            },
        });

        const step2 = ctxBuilder.neuron({ step2Out }).dendrite({
            collateral: step1Out,
            response: async (payload, axon, ctx) => {
                executionLog.push(`step2-${payload.id}`);
                ctx.set({
                    executed: [
                        ...(ctx.get()?.executed || []),
                        `step2-${payload.id}`,
                    ],
                });
                await new Promise(resolve => setTimeout(resolve, 15));
                return axon.step2Out.createSignal({ id: payload.id });
            },
        });

        const step3 = ctxBuilder.neuron({ output }).dendrite({
            collateral: step2Out,
            response: async (payload, axon, ctx) => {
                executionLog.push(`step3-${payload.id}`);
                ctx.set({
                    executed: [
                        ...(ctx.get()?.executed || []),
                        `step3-${payload.id}`,
                    ],
                });
                return axon.output.createSignal({
                    result: `Final: ${payload.id}`,
                });
            },
        });

        const cns = new CNS([step1, step2, step3]);

        // Persist/restore for BullMQ progress payloads (JSON only)
        type TestNeuron = typeof step1 | typeof step2 | typeof step3;
        type PersistedSignal = { collateralId: string; payload?: unknown };
        type PersistedTask = {
            neuronId: string;
            dendriteCollateralId: string;
            input?: PersistedSignal;
        };

        const neuronId = new Map<TestNeuron, string>([
            [step1, 'step1'],
            [step2, 'step2'],
            [step3, 'step3'],
        ]);
        const neuronById = new Map<string, TestNeuron>(
            Array.from(neuronId.entries()).map(([n, id]) => [id, n])
        );

        type TestCollateral = typeof input | typeof step1Out | typeof step2Out | typeof output;

        const collateralId = new Map<TestCollateral, string>([
            [input, 'input'],
            [step1Out, 'step1Out'],
            [step2Out, 'step2Out'],
            [output, 'output'],
        ]);
        const collateralById = new Map<string, TestCollateral>(
            Array.from(collateralId.entries()).map(([c, id]) => [id, c])
        );

        const persistTask = (task: TCNSNeuronActivationTask<TestNeuron>): PersistedTask => {
            const nId = neuronId.get(task.neuron);
            if (!nId) throw new Error('Unknown neuron in task');

            const dId = collateralId.get(task.dendriteCollateral);
            if (!dId) throw new Error('Unknown dendriteCollateral in task');

            const inSignal = task.input;
            const persistedInput =
                inSignal !== undefined
                    ? (() => {
                          const cId = collateralId.get(inSignal.collateral);
                          if (!cId) throw new Error('Unknown input collateral in task');
                          return { collateralId: cId, payload: inSignal.payload } satisfies PersistedSignal;
                      })()
                    : undefined;

            return { neuronId: nId, dendriteCollateralId: dId, input: persistedInput };
        };

        const restoreTask = (t: PersistedTask): TCNSNeuronActivationTask<TestNeuron> => {
            const neuron = neuronById.get(t.neuronId);
            if (!neuron) throw new Error(`Unknown neuronId "${t.neuronId}"`);

            const dendriteCollateral = collateralById.get(t.dendriteCollateralId);
            if (!dendriteCollateral) {
                throw new Error(`Unknown dendriteCollateralId "${t.dendriteCollateralId}"`);
            }

            const inputSignal =
                t.input !== undefined
                    ? (() => {
                          const c = collateralById.get(t.input.collateralId);
                          if (!c) throw new Error(`Unknown collateralId "${t.input.collateralId}"`);
                          return { collateral: c, payload: t.input.payload };
                      })()
                    : undefined;

            return {
                neuron,
                dendriteCollateral,
                input: inputSignal,
            };
        };

        // BullMQ infra
        const queueName = `test-queue-${Date.now()}`;
        queue = new Queue(queueName, { connection: redis });
        queueEvents = new QueueEvents(queueName, { connection: redis });

        type SavedProgress = {
            // JSON-friendly representation of Map<object, unknown>
            // We persist it as [neuronId, value] pairs.
            context: Array<[string, unknown]>;
            failedTasks: Array<{
                task: {
                    neuronId: string;
                    dendriteCollateralId: string;
                    input?: {
                        collateralId: string;
                        payload?: unknown;
                    };
                };
                error: {
                    message: string;
                    name: string;
                    stack?: string;
                };
                aborted: boolean;
            }>;
        };

        worker = new Worker(
            queueName,
            async (job: Job<{ signal: PersistedSignal }, { results: string[] }>) => {
                const persistedSignal = job.data.signal;
                const startCollateral = collateralById.get(
                    persistedSignal.collateralId
                );
                if (!startCollateral) {
                    throw new Error(
                        `Unknown start collateralId "${persistedSignal.collateralId}"`
                    );
                }
                const signal = {
                    collateral: startCollateral,
                    payload: persistedSignal.payload,
                };
                const results: string[] = [];

                const savedProgress = job.progress as
                    | SavedProgress
                    | number
                    | undefined;

                if (
                    savedProgress &&
                    typeof savedProgress === 'object' &&
                    job.attemptsMade > 0
                ) {
                    const ctxMap = new Map<object, unknown>();
                    for (const [nId, value] of savedProgress.context) {
                        const n = neuronById.get(nId);
                        if (n) ctxMap.set(n, value);
                    }
                    const ctxStore = new CNSStimulationContextStore(ctxMap);

                    const failedTasksToRetry = savedProgress.failedTasks.map(ft =>
                        restoreTask(ft.task)
                    );

                    const stimulation = cns.activate(failedTasksToRetry, {
                        ctx: ctxStore,
                        onResponse: r => {
                            if (r.outputSignal?.collateral === output) {
                                results.push(
                                    (
                                        r.outputSignal.payload as {
                                            result: string;
                                        }
                                    ).result
                                );
                            }
                        },
                    });

                    await stimulation.waitUntilComplete();
                    return { results };
                }

                const abortController = new AbortController();
                const stimulation = cns.stimulate(signal, {
                    abortSignal: abortController.signal,
                });

                await new Promise(resolve => setTimeout(resolve, 10));
                abortController.abort();

                try {
                    await stimulation.waitUntilComplete();
                    return { results };
                } catch (error: any) {
                    const ctxEntries: Array<[string, unknown]> = [];
                    for (const [key, value] of stimulation.getContext().getAll().entries()) {
                        const nId = neuronId.get(key as TestNeuron);
                        if (nId) ctxEntries.push([nId, value]);
                    }

                    const progress: SavedProgress = {
                        context: ctxEntries,
                        failedTasks: stimulation.getFailedTasks().map(ft => ({
                            task: persistTask(ft.task as TCNSNeuronActivationTask<TestNeuron>),
                            error: {
                                message: ft.error.message,
                                name: ft.error.name,
                                stack: ft.error.stack,
                            },
                            aborted: ft.aborted,
                        })),
                    };

                    await job.updateProgress(progress);

                    throw error;
                }
            },
            { connection: redis, concurrency: 1 }
        );

        const job = await queue.add(
            'stimulation-job',
            {
                signal: {
                    collateralId: collateralId.get(input)!,
                    payload: { id: 100 },
                },
            },
            {
                attempts: 2,
                removeOnComplete: true,
                removeOnFail: true,
            }
        );

        const retryResult = await job.waitUntilFinished(queueEvents);

        const step1Executions = executionLog.filter(e => e === 'step1-100');
        expect(step1Executions.length).toBe(1);

        expect(executionLog).toContain('step2-100');
        expect(executionLog).toContain('step3-100');

        expect(retryResult.results.length).toBeGreaterThan(0);
        expect(retryResult.results[0]).toBe('Final: 100');
    });
});
