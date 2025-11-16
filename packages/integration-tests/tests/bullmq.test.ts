import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { CNS } from '@cnstra/core';
import { withCtx, collateral } from '@cnstra/core';

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
        const input = collateral<{ id: number }>('input');
        const step1Out = collateral<{ id: number }>('step1Out');
        const step2Out = collateral<{ id: number }>('step2Out');
        const output = collateral<{ result: string }>('output');

        const executionLog: string[] = [];

        const step1 = ctxBuilder.neuron('step1', { step1Out }).dendrite({
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

        const step2 = ctxBuilder.neuron('step2', { step2Out }).dendrite({
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

        const step3 = ctxBuilder.neuron('step3', { output }).dendrite({
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

        // BullMQ infra
        const queueName = `test-queue-${Date.now()}`;
        queue = new Queue(queueName, { connection: redis });
        queueEvents = new QueueEvents(queueName, { connection: redis });

        type SavedProgress = {
            context: Record<string, unknown>;
            failedTasks: Array<{
                task: {
                    stimulationId: string;
                    neuronId: string;
                    dendriteCollateralName: string;
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
            async (job: Job<{ signal: any }, { results: string[] }>) => {
                const { signal } = job.data;
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
                    const contextValues = savedProgress.context;
                    const failedTasksToRetry = savedProgress.failedTasks.map(
                        ft => ft.task
                    );

                    const stimulation = cns.activate(failedTasksToRetry, {
                        contextValues: contextValues as Record<string, unknown>,
                        onResponse: r => {
                            if (r.outputSignal?.collateralName === 'output') {
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
                    const progress: SavedProgress = {
                        context: stimulation.getContext().getAll(),
                        failedTasks: stimulation.getFailedTasks().map(ft => ({
                            task: ft.task,
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
                signal: input.createSignal({ id: 100 }),
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
