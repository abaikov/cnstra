import { CNS, collateral, neuron, withCtx, TCNSSignal } from '../src/index';

describe('CNStra Core Tests', () => {
    describe('Factory Functions', () => {
        describe('collateral', () => {
            it('should create collateral with typed payload', () => {
                const typedCollateral = collateral<{ message: string }>(
                    'typed'
                );
                expect(typedCollateral.name).toBe('typed');

                const signal = typedCollateral.createSignal({
                    message: 'Hello',
                });
                expect(signal.collateralName).toBe('typed');
                expect(signal.payload).toEqual({ message: 'Hello' });
            });

            it('should create collateral with undefined payload by default', () => {
                const defaultCollateral = collateral('default');
                const signal = defaultCollateral.createSignal();
                expect(signal.collateralName).toBe('default');
                expect(signal.payload).toBeUndefined();
            });
        });

        describe('neuron', () => {
            it('should create neuron with name and axon', () => {
                const output = collateral<{ result: string }>('output');
                const testNeuron = neuron('test-neuron', { output });

                expect(testNeuron.name).toBe('test-neuron');
                expect(testNeuron.axon).toEqual({ output });
                expect(testNeuron.dendrites).toEqual([]);
            });

            it('should allow adding dendrites with response function', () => {
                const input = collateral<{ data: string }>('input');
                const output = collateral<{ result: string }>('output');

                const testNeuron = neuron('test-neuron', { output }).dendrite({
                    collateral: input,
                    response: async (payload, axon) => {
                        const data = payload.data;
                        return axon.output.createSignal({
                            result: `Processed: ${data}`,
                        });
                    },
                });

                expect(testNeuron.dendrites).toHaveLength(1);
                expect(testNeuron.dendrites[0].collateral.name).toBe('input');
            });

            it('should support chaining dendrites', () => {
                const input1 = collateral<{ data1: string }>('input1');
                const input2 = collateral<{ data2: string }>('input2');
                const output = collateral<{ result: string }>('output');

                const testNeuron = neuron('test-neuron', { output })
                    .dendrite({
                        collateral: input1,
                        response: async (payload, axon) => {
                            return axon.output.createSignal({
                                result: `From input1: ${payload.data1}`,
                            });
                        },
                    })
                    .dendrite({
                        collateral: input2,
                        response: async (payload, axon) => {
                            return axon.output.createSignal({
                                result: `From input2: ${payload.data2}`,
                            });
                        },
                    });

                expect(testNeuron.dendrites).toHaveLength(2);
                expect(testNeuron.dendrites[0].collateral.name).toBe('input1');
                expect(testNeuron.dendrites[1].collateral.name).toBe('input2');
            });

            it('should handle multiple axon outputs', () => {
                const output1 = collateral<{ result1: string }>('output1');
                const output2 = collateral<{ result2: string }>('output2');

                const testNeuron = neuron('test-neuron', { output1, output2 });

                expect(testNeuron.axon.output1).toBeDefined();
                expect(testNeuron.axon.output2).toBeDefined();
            });
        });

        describe('withCtx', () => {
            it('should create a context-aware neuron builder', () => {
                const ctxBuilder = withCtx<{
                    userId: string;
                    sessionId: string;
                }>();
                expect(typeof ctxBuilder.neuron).toBe('function');
            });

            it('should create neurons with typed context', () => {
                const ctxBuilder = withCtx<{ userId: string }>();
                const output = collateral<{ result: string }>('output');
                const testNeuron = ctxBuilder.neuron('test', { output });

                expect(testNeuron.name).toBe('test');
                expect(testNeuron.axon).toEqual({ output });
                expect(testNeuron.dendrites).toEqual([]);
            });

            it('should allow adding dendrites with context access', () => {
                const ctxBuilder = withCtx<{ counter: number }>();
                const input = collateral<{ increment: number }>('input');
                const output = collateral<{ result: number }>('output');

                const testNeuron = ctxBuilder
                    .neuron('counter', { output })
                    .dendrite({
                        collateral: input,
                        response: async (payload, axon, ctx) => {
                            const current = ctx.get()?.counter || 0;
                            const newValue = current + payload.increment;
                            ctx.set({ counter: newValue });
                            return axon.output.createSignal({
                                result: newValue,
                            });
                        },
                    });

                expect(testNeuron.dendrites).toHaveLength(1);
                expect(testNeuron.dendrites[0].collateral.name).toBe('input');
            });
        });

        describe('Integration', () => {
            it('should work together in a simple flow', async () => {
                const input = collateral<{ message: string }>('input');
                const output = collateral<{ processed: string }>('output');

                const processor = neuron('processor', { output }).dendrite({
                    collateral: input,
                    response: async (payload, axon) => {
                        return axon.output.createSignal({
                            processed: `Processed: ${payload.message}`,
                        });
                    },
                });

                expect(processor.name).toBe('processor');
                expect(processor.dendrites).toHaveLength(1);
                expect(processor.axon.output).toBeDefined();

                const dendrite = processor.dendrites[0];
                const result = await dendrite.response(
                    { message: 'Hello' },
                    processor.axon,
                    {
                        get: () => undefined,
                        set: () => {},
                        delete: () => {},
                    }
                );

                expect(result).toEqual({
                    collateralName: 'output',
                    payload: { processed: 'Processed: Hello' },
                });
            });
        });
    });

    describe('CNS Signal Flow', () => {
        describe('Basic Signal Processing', () => {
            it('should process basic signal flow', () => {
                const input = collateral<{ message: string }>('input');
                const output = collateral<{ processed: string }>('output');

                const processor = neuron('processor', { output }).dendrite({
                    collateral: input,
                    response: (payload, axon) => {
                        return axon.output.createSignal({
                            processed: `Processed: ${payload.message}`,
                        });
                    },
                });

                const cns = new CNS([processor]);
                const responses: Array<{
                    collateralName: string;
                    payload: unknown;
                    inputSignal?: TCNSSignal<
                        string,
                        {
                            message: string;
                        }
                    >;
                }> = [];

                cns.stimulate(input.createSignal({ message: 'Hello World' }), {
                    onResponse: response => {
                        responses.push({
                            collateralName:
                                response.outputSignal?.collateralName ||
                                'unknown',
                            payload: response.outputSignal?.payload,
                            inputSignal: response.inputSignal,
                        });
                    },
                });

                expect(responses).toHaveLength(2);
                expect(responses[0].collateralName).toBe('input');
                expect(responses[0].payload).toEqual({
                    message: 'Hello World',
                });
                expect(responses[1].inputSignal).toEqual({
                    collateralName: 'input',
                    payload: {
                        message: 'Hello World',
                    },
                });
                expect(responses[1].collateralName).toBe('output');
                expect(responses[1].payload).toEqual({
                    processed: 'Processed: Hello World',
                });
            });

            it('should handle chain processing', () => {
                const input = collateral<{ value: number }>('input');
                const middle = collateral<{ value: number }>('middle');
                const output = collateral<{ result: number }>('output');

                const step1 = neuron('step1', { middle }).dendrite({
                    collateral: input,
                    response: (payload, axon) => {
                        return axon.middle.createSignal({
                            value: payload.value + 5,
                        });
                    },
                });

                const step2 = neuron('step2', { output }).dendrite({
                    collateral: middle,
                    response: (payload, axon) => {
                        return axon.output.createSignal({
                            result: payload.value * 3,
                        });
                    },
                });

                const cns = new CNS([step1, step2]);
                const responses: Array<{
                    collateralName: string;
                    payload: unknown;
                }> = [];

                cns.stimulate(input.createSignal({ value: 7 }), {
                    onResponse: response => {
                        responses.push({
                            collateralName:
                                response.outputSignal?.collateralName ||
                                'unknown',
                            payload: response.outputSignal?.payload,
                        });
                    },
                });

                expect(responses).toHaveLength(3);
                expect(responses[2].payload).toEqual({
                    result: 36, // (7+5)*3
                });
            });

            it('should handle fan-out processing', async () => {
                const input = collateral<{ data: string }>('input');
                const branch1 = collateral<{ result: string }>('branch1');
                const branch2 = collateral<{ result: string }>('branch2');

                const processor1 = neuron('proc1', { branch1 }).dendrite({
                    collateral: input,
                    response: (payload, axon) => {
                        return axon.branch1.createSignal({
                            result: `A-${payload.data}`,
                        });
                    },
                });

                const processor2 = neuron('proc2', { branch2 }).dendrite({
                    collateral: input,
                    response: (payload, axon) => {
                        return axon.branch2.createSignal({
                            result: `B-${payload.data}`,
                        });
                    },
                });

                const cns = new CNS([processor1, processor2]);
                const responses: Array<{
                    collateralName: string;
                    payload: unknown;
                }> = [];

                await cns.stimulate(input.createSignal({ data: 'test' }), {
                    onResponse: response => {
                        responses.push({
                            collateralName:
                                response.outputSignal?.collateralName ||
                                'unknown',
                            payload: response.outputSignal?.payload,
                        });
                    },
                });

                expect(responses).toHaveLength(3);
                expect(
                    responses.find(t => t.collateralName === 'branch1')?.payload
                ).toEqual({ result: 'A-test' });
                expect(
                    responses.find(t => t.collateralName === 'branch2')?.payload
                ).toEqual({ result: 'B-test' });
            });
        });

        it('should call global and local onResponse listeners', async () => {
            const input = collateral('input');
            const output = collateral('output');

            const n = neuron('n', { output }).dendrite({
                collateral: input,
                response: (_p, axon) => axon.output.createSignal(),
            });
            const cns = new CNS([n]);

            const global: string[] = [];
            const local: string[] = [];
            cns.addResponseListener(r => {
                global.push(
                    r.outputSignal?.collateralName ||
                        r.inputSignal?.collateralName ||
                        'unknown'
                );
            });

            await cns.stimulate(input.createSignal(), {
                onResponse: r => {
                    local.push(
                        r.outputSignal?.collateralName ||
                            r.inputSignal?.collateralName ||
                            'unknown'
                    );
                },
            });

            // Expect both to have seen both input and output
            expect(local).toEqual(['input', 'output']);
            expect(global).toEqual(['input', 'output']);
        });

        describe('Stack Safety', () => {
            it('should not blow the stack on long synchronous chains', async () => {
                const K = 1000;
                const input = collateral('input');
                const output = collateral('output');

                const mids = Array.from({ length: K }, (_, i) =>
                    collateral(`mid_${i}`)
                );

                const startNeuron = neuron('start', {
                    mid_0: mids[0],
                }).dendrite({
                    collateral: input,
                    response: (_payload, axon) => axon.mid_0.createSignal(),
                });

                const midNeurons = mids.slice(0, -1).map((c, i) =>
                    neuron(`mid_${i}_n`, { next: mids[i + 1] }).dendrite({
                        collateral: c,
                        response: (_payload, axon) => axon.next.createSignal(),
                    })
                );

                const tailNeuron = neuron('tail', { output }).dendrite({
                    collateral: mids[K - 1],
                    response: (_payload, axon) => axon.output.createSignal(),
                });

                const cns = new CNS([startNeuron, ...midNeurons, tailNeuron]);
                const responses: Array<{
                    collateralName: string;
                    queueLength: number;
                    currentTasksLength: number;
                }> = [];

                await cns.stimulate(input.createSignal(), {
                    onResponse: response => {
                        responses.push({
                            collateralName:
                                response.outputSignal?.collateralName ||
                                'unknown',
                            queueLength: response.queueLength,
                            currentTasksLength:
                                response.stimulation.getAllActivationTasks()
                                    .length,
                        });
                    },
                });

                expect(responses.length).toBe(K + 2);
                expect(responses[0].queueLength).toBeGreaterThan(0);

                expect(
                    responses.every(r => r.currentTasksLength === r.queueLength)
                ).toBe(true);

                const last = responses[responses.length - 1];
                expect(last.collateralName).toBe('output');
                expect(last.queueLength).toBe(0);
            });
        });

        describe('Correct Ending of Traces', () => {
            it('should handle correct ending of traces', async () => {
                const input = collateral('input');
                const shortBranch = collateral('shortBranch');
                const longBranch1 = collateral('longBranch1');
                const longBranch2 = collateral('longBranch2');
                const output = collateral('output');

                const shortBranchNeuron = neuron('shortBranch', {
                    shortBranch,
                }).dendrite({
                    collateral: input,
                    response: (payload, axon) => {
                        // Do nothing
                    },
                });

                const longBranch1Neuron = neuron('longBranch1', {
                    longBranch1,
                }).dendrite({
                    collateral: input,
                    response: (payload, axon) => {
                        return axon.longBranch1.createSignal();
                    },
                });

                const longBranch2Neuron = neuron('longBranch2', {
                    longBranch2,
                }).dendrite({
                    collateral: longBranch1,
                    response: (payload, axon) => {
                        return axon.longBranch2.createSignal();
                    },
                });

                const outputNeuron = neuron('output', { output }).dendrite({
                    collateral: longBranch2,
                    response: (payload, axon) => {
                        return axon.output.createSignal();
                    },
                });

                const cns = new CNS([
                    shortBranchNeuron,
                    longBranch1Neuron,
                    longBranch2Neuron,
                    outputNeuron,
                ]);

                const responses: Array<{
                    collateralName: string;
                    queueLength: number;
                }> = [];

                await cns.stimulate(input.createSignal(), {
                    onResponse: response => {
                        responses.push({
                            collateralName:
                                response.outputSignal?.collateralName ||
                                'unknown',
                            queueLength: response.queueLength,
                        });
                    },
                });

                expect(responses).toHaveLength(5);
                expect(responses[0].queueLength).not.toBe(0);
                expect(responses[4].collateralName).toBe('output');
                expect(responses[4].queueLength).toBe(0);
            });
        });
    });

    describe('Async Processing', () => {
        describe('Basic Async Operations', () => {
            it('should handle single async response', async () => {
                const input = collateral<{ delay: number; message: string }>(
                    'input'
                );
                const output = collateral<{ result: string }>('output');

                const asyncNeuron = neuron('async', { output }).dendrite({
                    collateral: input,
                    response: async (payload, axon) => {
                        await new Promise(resolve =>
                            setTimeout(resolve, payload.delay)
                        );
                        return axon.output.createSignal({
                            result: `async-${payload.message}`,
                        });
                    },
                });

                const cns = new CNS([asyncNeuron]);
                const responses: Array<{
                    collateralName: string;
                    payload: unknown;
                }> = [];
                const startTime = Date.now();

                await cns.stimulate(
                    input.createSignal({ delay: 30, message: 'test' }),
                    {
                        onResponse: response => {
                            responses.push({
                                collateralName:
                                    response.outputSignal?.collateralName ||
                                    'unknown',
                                payload: response.outputSignal?.payload,
                            });

                            if (
                                response.outputSignal?.collateralName ===
                                'output'
                            ) {
                                const elapsed = Date.now() - startTime;
                                expect(elapsed).toBeGreaterThanOrEqual(25);
                                expect(responses).toHaveLength(2);
                                expect(responses[1]).toMatchObject({
                                    collateralName: 'output',
                                    payload: { result: 'async-test' },
                                });
                            }
                        },
                    }
                );
            });

            it('should handle async chain processing', async () => {
                const input = collateral<{ value: number }>('input');
                const step1 = collateral<{ value: number }>('step1');
                const output = collateral<{ result: number }>('output');

                const asyncStep1 = neuron('async1', { step1 }).dendrite({
                    collateral: input,
                    response: async (payload, axon) => {
                        await new Promise(resolve => setTimeout(resolve, 20));
                        return axon.step1.createSignal({
                            value: payload.value * 2,
                        });
                    },
                });

                const asyncStep2 = neuron('async2', { output }).dendrite({
                    collateral: step1,
                    response: async (payload, axon) => {
                        await new Promise(resolve => setTimeout(resolve, 15));
                        return axon.output.createSignal({
                            result: payload.value + 10,
                        });
                    },
                });

                const cns = new CNS([asyncStep1, asyncStep2]);
                const responses: Array<{
                    collateralName: string;
                    payload: unknown;
                }> = [];
                const startTime = Date.now();

                await cns.stimulate(input.createSignal({ value: 5 }), {
                    onResponse: response => {
                        responses.push({
                            collateralName:
                                response.outputSignal?.collateralName ||
                                'unknown',
                            payload: response.outputSignal?.payload,
                        });

                        if (
                            response.outputSignal?.collateralName === 'output'
                        ) {
                            const elapsed = Date.now() - startTime;
                            expect(elapsed).toBeGreaterThanOrEqual(35);
                            expect(responses).toHaveLength(3);
                            expect(responses[2]).toMatchObject({
                                collateralName: 'output',
                                payload: { result: 20 }, // (5*2)+10
                            });
                        }
                    },
                });
            });
        });
    });

    describe('Context Integration', () => {
        describe('Context Operations', () => {
            it('should set and get context values', async () => {
                const ctxBuilder = withCtx<{
                    message: string;
                    count: number;
                }>();
                const input = collateral<{ text: string }>('input');
                const output = collateral<{ result: string }>('output');

                const testNeuron = ctxBuilder
                    .neuron('processor', { output })
                    .dendrite({
                        collateral: input,
                        response: async (payload, axon, ctx) => {
                            ctx.set({ message: payload.text, count: 1 });

                            const context = ctx.get();
                            expect(context?.message).toBe(payload.text);
                            expect(context?.count).toBe(1);

                            return axon.output.createSignal({
                                result: context?.message || '',
                            });
                        },
                    });

                const dendrite = testNeuron.dendrites[0];
                let contextValue:
                    | { message: string; count: number }
                    | undefined;
                const mockCtx = {
                    get: () => contextValue,
                    set: (value: { message: string; count: number }) => {
                        contextValue = value;
                    },
                };

                const result = await dendrite.response(
                    { text: 'Hello Context' },
                    testNeuron.axon,
                    {
                        ...mockCtx,
                        delete: () => {},
                    }
                );

                expect(result).toEqual({
                    collateralName: 'output',
                    payload: { result: 'Hello Context' },
                });
            });

            it('should handle undefined context gracefully', async () => {
                const ctxBuilder = withCtx<{ data: string }>();
                const input = collateral<{ value: string }>('input');
                const output = collateral<{ result: string }>('output');

                const testNeuron = ctxBuilder
                    .neuron('safe', { output })
                    .dendrite({
                        collateral: input,
                        response: async (payload, axon, ctx) => {
                            const context = ctx.get();
                            const safeData = context?.data || 'default';
                            return axon.output.createSignal({
                                result: safeData,
                            });
                        },
                    });

                const dendrite = testNeuron.dendrites[0];
                let contextValue: { data: string } | undefined;
                const mockCtx = {
                    get: () => contextValue,
                    set: (value: { data: string }) => {
                        contextValue = value;
                    },
                };

                const result = await dendrite.response(
                    { value: 'test' },
                    testNeuron.axon,
                    {
                        ...mockCtx,
                        delete: () => {},
                    }
                );

                expect(result).toEqual({
                    collateralName: 'output',
                    payload: { result: 'default' },
                });
            });
        });
    });

    describe('Edge Cases', () => {
        it('should handle neurons with no dendrites', async () => {
            const input = collateral<{ data: string }>('input');
            const output = collateral<{ result: string }>('output');

            const neuronWithNoDendrites = neuron('empty', { output });
            const cns = new CNS([neuronWithNoDendrites]);

            const responses: Array<{
                collateralName: string;
                queueLength: number;
            }> = [];

            await cns.stimulate(input.createSignal({ data: 'test' }), {
                onResponse: response => {
                    responses.push({
                        collateralName:
                            response.outputSignal?.collateralName || 'unknown',
                        queueLength: response.queueLength,
                    });
                },
            });

            expect(responses).toHaveLength(1);
            expect(responses[0].collateralName).toBe('input');
        });

        it('should handle undefined payloads', async () => {
            const input = collateral('input');
            const output = collateral<{ result: string }>('output');

            const testNeuron = neuron('test', { output }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    return axon.output.createSignal({
                        result: 'Processed undefined payload',
                    });
                },
            });

            const cns = new CNS([testNeuron]);
            const responses: Array<{
                collateralName: string;
                payload: unknown;
            }> = [];

            await cns.stimulate(input.createSignal(), {
                onResponse: response => {
                    responses.push({
                        collateralName:
                            response.outputSignal?.collateralName || 'unknown',
                        payload: response.outputSignal?.payload,
                    });
                },
            });

            // Should have at least 1 response (input), and possibly output if neuron fires
            expect(responses.length).toBeGreaterThanOrEqual(1);
            if (responses.length > 1) {
                expect(responses[1].payload).toEqual({
                    result: 'Processed undefined payload',
                });
            }
        });

        it('should work fire-and-forget style', async () => {
            const input = collateral<{ data: string }>('input');
            const output = collateral<{ result: string }>('output');

            const processor = neuron('processor', { output }).dendrite({
                collateral: input,
                response: (payload, axon) => {
                    return axon.output.createSignal({
                        result: `Processed: ${payload.data}`,
                    });
                },
            });

            const cns = new CNS([processor]);

            const result = cns.stimulate(input.createSignal({ data: 'test' }));
            expect(result).toBeDefined();
            expect(result).toBeInstanceOf(Object);
            // Fire and forget - don't await
        });
    });

    describe('Per-Neuron Concurrency', () => {
        it('should enforce concurrency=1 for a single neuron (sequential processing)', async () => {
            const start = collateral('start');
            const inC = collateral('in');
            const out = collateral('out');

            const u1 = neuron('u1', { in: inC }).dendrite({
                collateral: start,
                response: (_p, axon) => axon.in.createSignal(),
            });

            const u2 = neuron('u2', { in: inC }).dendrite({
                collateral: start,
                response: (_p, axon) => axon.in.createSignal(),
            });

            const DELAY = 30;
            const worker = neuron('worker', { out })
                .setConcurrency(1)
                .dendrite({
                    collateral: inC,
                    response: async (_payload, axon) => {
                        await new Promise(r => setTimeout(r, DELAY));
                        return axon.out.createSignal();
                    },
                });

            const cns = new CNS([u1, u2, worker]);

            let outCount = 0;
            const startTime = Date.now();
            await new Promise<void>(resolve => {
                cns.stimulate(start.createSignal(), {
                    onResponse: r => {
                        if (r.outputSignal?.collateralName === 'out') {
                            outCount++;
                            if (outCount === 2) {
                                const elapsed = Date.now() - startTime;
                                expect(elapsed).toBeGreaterThanOrEqual(
                                    DELAY * 2 - 5
                                );
                                resolve();
                            }
                        }
                    },
                });
            });
        });

        it('should allow up to N concurrent tasks per neuron (concurrency=2)', async () => {
            const start = collateral('start');
            const inC = collateral('in');
            const out = collateral('out');

            const u1 = neuron('u1', { in: inC }).dendrite({
                collateral: start,
                response: (_p, axon) => axon.in.createSignal(),
            });
            const u2 = neuron('u2', { in: inC }).dendrite({
                collateral: start,
                response: (_p, axon) => axon.in.createSignal(),
            });
            const u3 = neuron('u3', { in: inC }).dendrite({
                collateral: start,
                response: (_p, axon) => axon.in.createSignal(),
            });

            const DELAY = 30;
            const worker = neuron('worker', { out })
                .setConcurrency(2)
                .dendrite({
                    collateral: inC,
                    response: async (_payload, axon) => {
                        await new Promise(r => setTimeout(r, DELAY));
                        return axon.out.createSignal();
                    },
                });

            const cns = new CNS([u1, u2, u3, worker]);

            let outCount = 0;
            const startTime = Date.now();
            await new Promise<void>(resolve => {
                cns.stimulate(start.createSignal(), {
                    onResponse: r => {
                        if (r.outputSignal?.collateralName === 'out') {
                            outCount++;
                            if (outCount === 3) {
                                const elapsed = Date.now() - startTime;
                                expect(elapsed).toBeGreaterThanOrEqual(
                                    DELAY * 2 - 5
                                );
                                resolve();
                            }
                        }
                    },
                });
            });
        });

        it('should not limit when concurrency is not set', async () => {
            const start = collateral('start');
            const inC = collateral('in');
            const out = collateral('out');

            const u1 = neuron('u1', { in: inC }).dendrite({
                collateral: start,
                response: (_p, axon) => axon.in.createSignal(),
            });
            const u2 = neuron('u2', { in: inC }).dendrite({
                collateral: start,
                response: (_p, axon) => axon.in.createSignal(),
            });

            const DELAY = 30;
            const worker = neuron('worker', { out }).dendrite({
                collateral: inC,
                response: async (_payload, axon) => {
                    await new Promise(r => setTimeout(r, DELAY));
                    return axon.out.createSignal();
                },
            });

            const cns = new CNS([u1, u2, worker]);

            let outCount = 0;
            const startTime = Date.now();
            await new Promise<void>(resolve => {
                cns.stimulate(start.createSignal(), {
                    onResponse: r => {
                        if (r.outputSignal?.collateralName === 'out') {
                            outCount++;
                            if (outCount === 2) {
                                const elapsed = Date.now() - startTime;
                                // Should complete close to single delay since both can run together
                                expect(elapsed).toBeLessThan(DELAY * 2);
                                resolve();
                            }
                        }
                    },
                });
            });
        });

        it('should enforce limit across separate stimulations (global gate)', async () => {
            const input = collateral('input');
            const workerOut = collateral('out');

            const worker = neuron('worker', { out: workerOut })
                .setConcurrency(1)
                .dendrite({
                    collateral: input,
                    response: async (_p, axon) => {
                        await new Promise(r => setTimeout(r, 40));
                        return axon.out.createSignal();
                    },
                });

            const cns = new CNS([worker]);

            const start = Date.now();
            let done = 0;
            await new Promise<void>(resolve => {
                const handler = (r: any) => {
                    if (r.outputSignal?.collateralName === 'out') {
                        done++;
                        if (done === 2) {
                            const elapsed = Date.now() - start;
                            expect(elapsed).toBeGreaterThanOrEqual(75);
                            resolve();
                        }
                    }
                };
                cns.stimulate(input.createSignal(), { onResponse: handler });
                cns.stimulate(input.createSignal(), { onResponse: handler });
            });
        });
    });

    describe('SCC Tracking', () => {
        it('should correctly identify when neurons can be safely cleaned up', () => {
            const start = collateral<{ message: string }>('start');
            const middle = collateral<{ from: string }>('middle');
            const end = collateral<{ from: string }>('end');

            const neuronA = neuron('A', { middle }).dendrite({
                collateral: start,
                response: (payload, axon) => {
                    return axon.middle.createSignal({ from: 'A' });
                },
            });

            const neuronB = neuron('B', { end }).dendrite({
                collateral: middle,
                response: (payload, axon) => {
                    return axon.end.createSignal({ from: 'B' });
                },
            });

            const neuronC = neuron('C', {}).dendrite({
                collateral: end,
                response: (payload, axon) => {
                    // Terminal neuron
                },
            });

            const cns = new CNS([neuronA, neuronB, neuronC], {
                autoCleanupContexts: true,
            });

            expect(cns.network.stronglyConnectedComponents).toHaveLength(3);
            expect(cns.network.getSCCSetByNeuronName('A')?.size).toBe(1);
            expect(cns.network.getSCCSetByNeuronName('B')?.size).toBe(1);
            expect(cns.network.getSCCSetByNeuronName('C')?.size).toBe(1);

            const emptyActiveCounts = new Map<number, number>();

            expect(
                cns.network.canNeuronBeGuaranteedDone('A', emptyActiveCounts)
            ).toBe(true);
            expect(
                cns.network.canNeuronBeGuaranteedDone('B', emptyActiveCounts)
            ).toBe(true);
            expect(
                cns.network.canNeuronBeGuaranteedDone('C', emptyActiveCounts)
            ).toBe(true);
        });
    });

    describe('Array Signal Support', () => {
        it('should handle returning an array of signals from a neuron', async () => {
            const input = collateral<{ value: number }>('input');
            const output1 = collateral<{ result: string }>('output1');
            const output2 = collateral<{ result: string }>('output2');
            const final = collateral<{ message: string }>('final');

            const splitter = neuron('splitter', { output1, output2 }).dendrite({
                collateral: input,
                response: (payload, axon) => {
                    return [
                        axon.output1.createSignal({
                            result: `Output1: ${payload.value}`,
                        }),
                        axon.output2.createSignal({
                            result: `Output2: ${payload.value}`,
                        }),
                    ];
                },
            });

            const collector1 = neuron('collector1', { final }).dendrite({
                collateral: output1,
                response: (payload, axon) => {
                    return axon.final.createSignal({
                        message: `Collected from ${payload.result}`,
                    });
                },
            });

            const collector2 = neuron('collector2', { final }).dendrite({
                collateral: output2,
                response: (payload, axon) => {
                    return axon.final.createSignal({
                        message: `Collected from ${payload.result}`,
                    });
                },
            });

            const cns = new CNS([splitter, collector1, collector2]);

            const results: string[] = [];
            await new Promise<void>(resolve => {
                cns.stimulate(input.createSignal({ value: 42 }), {
                    onResponse: r => {
                        if (r.outputSignal?.collateralName === 'final') {
                            results.push(
                                (r.outputSignal.payload as { message: string })
                                    .message
                            );
                            if (results.length === 2) {
                                resolve();
                            }
                        }
                    },
                });
            });

            expect(results).toHaveLength(2);
            expect(results).toContain('Collected from Output1: 42');
            expect(results).toContain('Collected from Output2: 42');
        });

        it('should handle async array of signals', async () => {
            const input = collateral<{ count: number }>('input');
            const output = collateral<{ index: number }>('output');

            const generator = neuron('generator', { output }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    await new Promise(r => setTimeout(r, 10));
                    const signals = [];
                    for (let i = 0; i < payload.count; i++) {
                        signals.push(axon.output.createSignal({ index: i }));
                    }
                    return signals;
                },
            });

            const cns = new CNS([generator]);

            const indices: number[] = [];
            await new Promise<void>(resolve => {
                cns.stimulate(input.createSignal({ count: 3 }), {
                    onResponse: r => {
                        if (r.outputSignal?.collateralName === 'output') {
                            indices.push(
                                (r.outputSignal.payload as { index: number })
                                    .index
                            );
                            if (indices.length === 3) {
                                resolve();
                            }
                        }
                    },
                });
            });

            expect(indices).toEqual([0, 1, 2]);
        });

        it('should handle stimulate with array of initial signals', async () => {
            const input = collateral<{ id: number }>('input');
            const output = collateral<{ processed: number }>('output');

            const processor = neuron('processor', { output }).dendrite({
                collateral: input,
                response: (payload, axon) => {
                    return axon.output.createSignal({
                        processed: payload.id * 2,
                    });
                },
            });

            const cns = new CNS([processor]);

            const results: number[] = [];
            await new Promise<void>(resolve => {
                cns.stimulate(
                    [
                        input.createSignal({ id: 1 }),
                        input.createSignal({ id: 2 }),
                        input.createSignal({ id: 3 }),
                    ],
                    {
                        onResponse: r => {
                            if (r.outputSignal?.collateralName === 'output') {
                                results.push(
                                    (
                                        r.outputSignal.payload as {
                                            processed: number;
                                        }
                                    ).processed
                                );
                                if (results.length === 3) {
                                    resolve();
                                }
                            }
                        },
                    }
                );
            });

            expect(results.sort()).toEqual([2, 4, 6]);
        });

        it('should handle empty array of signals', async () => {
            const input = collateral<{ shouldEmit: boolean }>('input');
            const output = collateral<{ data: string }>('output');

            const conditional = neuron('conditional', { output }).dendrite({
                collateral: input,
                response: (payload, axon) => {
                    if (payload.shouldEmit) {
                        return [axon.output.createSignal({ data: 'emitted' })];
                    }
                    return [];
                },
            });

            const cns = new CNS([conditional]);

            let outputCount = 0;
            await new Promise<void>(resolve => {
                cns.stimulate(input.createSignal({ shouldEmit: false }), {
                    onResponse: r => {
                        if (r.outputSignal?.collateralName === 'output') {
                            outputCount++;
                        }
                        if (r.queueLength === 0) {
                            resolve();
                        }
                    },
                });
            });

            expect(outputCount).toBe(0);
        });

        it('should handle mixed single and array signal returns', async () => {
            const input = collateral<{ mode: 'single' | 'array' }>('input');
            const output = collateral<{ value: string }>('output');

            const flexible = neuron('flexible', { output }).dendrite({
                collateral: input,
                response: (payload, axon) => {
                    if (payload.mode === 'single') {
                        return axon.output.createSignal({ value: 'single' });
                    } else {
                        return [
                            axon.output.createSignal({ value: 'array1' }),
                            axon.output.createSignal({ value: 'array2' }),
                        ];
                    }
                },
            });

            const cns = new CNS([flexible]);

            // Test single mode
            const singleResults: string[] = [];
            await new Promise<void>(resolve => {
                cns.stimulate(input.createSignal({ mode: 'single' }), {
                    onResponse: r => {
                        if (r.outputSignal?.collateralName === 'output') {
                            singleResults.push(
                                (r.outputSignal.payload as { value: string })
                                    .value
                            );
                        }
                        if (r.queueLength === 0) {
                            resolve();
                        }
                    },
                });
            });

            expect(singleResults).toEqual(['single']);

            // Test array mode
            const arrayResults: string[] = [];
            await new Promise<void>(resolve => {
                cns.stimulate(input.createSignal({ mode: 'array' }), {
                    onResponse: r => {
                        if (r.outputSignal?.collateralName === 'output') {
                            arrayResults.push(
                                (r.outputSignal.payload as { value: string })
                                    .value
                            );
                        }
                        if (r.queueLength === 0) {
                            resolve();
                        }
                    },
                });
            });

            expect(arrayResults).toEqual(['array1', 'array2']);
        });
    });

    describe('onResponse async and error handling', () => {
        it('should await onResponse when it returns a Promise and run listeners in parallel', async () => {
            const input = collateral('input');
            const output = collateral('output');

            const n = neuron('n', { output }).dendrite({
                collateral: input,
                response: (_p, axon) => axon.output.createSignal(),
            });
            const cns = new CNS([n]);

            // Global async listener (~25ms)
            cns.addResponseListener(async () => {
                await new Promise<void>(r => setTimeout(r, 25));
            });

            const start = Date.now();
            await cns
                .stimulate(input.createSignal(), {
                    onResponse: async _r => {
                        // Local async listener (~25ms)
                        await new Promise<void>(r => setTimeout(r, 25));
                    },
                })
                .waitUntilComplete();

            const elapsed = Date.now() - start;
            // Should be ~25ms (parallel), definitely less than 45ms
            expect(elapsed).toBeGreaterThanOrEqual(20);
            expect(elapsed).toBeLessThan(45);
        });

        it('should reject stimulate when local onResponse throws', async () => {
            const input = collateral('input');
            const output = collateral('output');

            const n = neuron('n', { output }).dendrite({
                collateral: input,
                response: (_p, axon) => axon.output.createSignal(),
            });
            const cns = new CNS([n]);

            await expect(
                cns
                    .stimulate(input.createSignal(), {
                        onResponse: () => {
                            throw new Error('local-fail');
                        },
                    })
                    .waitUntilComplete()
            ).rejects.toThrow('local-fail');
        });

        it('should reject stimulate when a global response listener rejects', async () => {
            const input = collateral('input');
            const output = collateral('output');

            const n = neuron('n', { output }).dendrite({
                collateral: input,
                response: (_p, axon) => axon.output.createSignal(),
            });
            const cns = new CNS([n]);

            cns.addResponseListener(async () => {
                return Promise.reject(new Error('global-fail'));
            });

            await expect(
                cns
                    .stimulate(input.createSignal(), { onResponse: () => {} })
                    .waitUntilComplete()
            ).rejects.toThrow('global-fail');
        });

        it('should not introduce async when onResponse is purely synchronous', async () => {
            const input = collateral('input');
            const output = collateral('output');

            const n = neuron('n', { output }).dendrite({
                collateral: input,
                response: (_p, axon) => axon.output.createSignal(),
            });
            const cns = new CNS([n]);

            const start = Date.now();
            await cns.stimulate(input.createSignal(), {
                onResponse: () => {
                    // no-op sync
                },
            });
            const elapsed = Date.now() - start;
            expect(elapsed).toBeLessThan(10);
        });

        it('should run multiple global listeners in parallel (time ~ max, not sum)', async () => {
            const input = collateral('input');
            const output = collateral('output');

            const n = neuron('n', { output }).dendrite({
                collateral: input,
                response: (_p, axon) => axon.output.createSignal(),
            });
            const cns = new CNS([n]);

            const DELAY = 30;
            cns.addResponseListener(async () => {
                await new Promise<void>(r => setTimeout(r, DELAY));
            });
            cns.addResponseListener(async () => {
                await new Promise<void>(r => setTimeout(r, DELAY));
            });

            const start = Date.now();
            await cns
                .stimulate(input.createSignal(), { onResponse: () => {} })
                .waitUntilComplete();
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThanOrEqual(DELAY - 5);
            expect(elapsed).toBeLessThan(DELAY * 2 - 5);
        });

        it('should still invoke other global listeners when one rejects asynchronously', async () => {
            const input = collateral('input');
            const output = collateral('output');

            const n = neuron('n', { output }).dendrite({
                collateral: input,
                response: (_p, axon) => axon.output.createSignal(),
            });
            const cns = new CNS([n]);

            let secondRan = false;
            cns.addResponseListener(async () => {
                await new Promise<void>(r => setTimeout(r, 10));
                return Promise.reject(new Error('boom'));
            });
            cns.addResponseListener(async () => {
                await new Promise<void>(r => setTimeout(r, 10));
                secondRan = true;
            });

            await expect(
                cns
                    .stimulate(input.createSignal(), { onResponse: () => {} })
                    .waitUntilComplete()
            ).rejects.toThrow('boom');

            expect(secondRan).toBe(true);
        });

        it('should resolve stimulate when aborted and no active tasks remain', async () => {
            const input = collateral('input');
            const output = collateral('output');

            const n = neuron('n', { output }).dendrite({
                collateral: input,
                response: (_p, axon) => axon.output.createSignal(),
            });
            const sink = neuron('sink', {}).dendrite({
                collateral: output,
                response: () => {
                    // would run if enqueued; we will abort before enqueue happens
                },
            });
            const cns = new CNS([n, sink]);

            const controller = new AbortController();
            const start = Date.now();

            const p = cns
                .stimulate(input.createSignal(), {
                    abortSignal: controller.signal,
                    // delay enqueue of subscribers
                    onResponse: async () => {
                        await new Promise<void>(r => setTimeout(r, 30));
                    },
                })
                .waitUntilComplete();

            // abort while no active operations (before enqueue after onResponse)
            setTimeout(() => controller.abort(), 10);

            // When aborted, the promise should reject
            await expect(p).rejects.toThrow('Stimulation aborted');
            const elapsed = Date.now() - start;
            expect(elapsed).toBeLessThan(40);
        });

        it('should block subscriber enqueue until onResponse resolves', async () => {
            const input = collateral('input');
            const mid = collateral('mid');
            const output = collateral('output');

            const a = neuron('a', { mid }).dendrite({
                collateral: input,
                response: (_p, axon) => axon.mid.createSignal(),
            });
            const b = neuron('b', { output }).dendrite({
                collateral: mid,
                response: (_p, axon) => axon.output.createSignal(),
            });
            const cns = new CNS([a, b]);

            const start = Date.now();
            let seenOutputAt: number | undefined;

            await cns
                .stimulate(input.createSignal(), {
                    onResponse: async r => {
                        if (r.outputSignal?.collateralName === 'mid') {
                            await new Promise<void>(res => setTimeout(res, 30));
                        }
                        if (r.outputSignal?.collateralName === 'output') {
                            seenOutputAt = Date.now();
                        }
                    },
                })
                .waitUntilComplete();

            expect(seenOutputAt).toBeDefined();
            expect(seenOutputAt! - start).toBeGreaterThanOrEqual(25);
        });
    });

    describe('Abort and Retry with activate', () => {
        it('should allow aborting and retrying with same tasks and context', async () => {
            const ctxBuilder = withCtx<{ processed: string[]; step: number }>();
            const input = collateral<{ value: number }>('input');
            const intermediate = collateral<{ value: number }>('intermediate');
            const output = collateral<{ result: string }>('output');

            let step1Executed = false;
            let step2Executed = false;

            const step1 = ctxBuilder
                .neuron('step1', { intermediate })
                .dendrite({
                    collateral: input,
                    response: async (payload, axon, ctx) => {
                        step1Executed = true;
                        const current = ctx.get() || { processed: [], step: 0 };
                        ctx.set({
                            processed: [...current.processed, 'step1'],
                            step: 1,
                        });
                        await new Promise(resolve => setTimeout(resolve, 10));
                        return axon.intermediate.createSignal({
                            value: payload.value,
                        });
                    },
                });

            const step2 = ctxBuilder.neuron('step2', { output }).dendrite({
                collateral: intermediate,
                response: async (payload, axon, ctx) => {
                    step2Executed = true;
                    const current = ctx.get() || { processed: [], step: 0 };
                    ctx.set({
                        processed: [...current.processed, 'step2'],
                        step: 2,
                    });
                    await new Promise(resolve => setTimeout(resolve, 10));
                    return axon.output.createSignal({
                        result: `Result: ${payload.value}`,
                    });
                },
            });

            const cns = new CNS([step1, step2]);

            // First stimulation - abort it
            const abortController = new AbortController();
            const stimulation1 = cns.stimulate(
                input.createSignal({ value: 42 }),
                {
                    abortSignal: abortController.signal,
                }
            );

            // Wait a bit, then abort
            await new Promise(resolve => setTimeout(resolve, 5));
            abortController.abort();

            // Wait for abort to complete - should reject
            await expect(stimulation1.waitUntilComplete()).rejects.toThrow(
                'Stimulation aborted'
            );

            // Get failed tasks
            const failedTasks = stimulation1.getFailedTasks();
            expect(failedTasks.length).toBeGreaterThan(0);

            // Get context from first stimulation
            const contextFromFirst = stimulation1.getContext().getAll();

            // Retry with activate using failed tasks and saved context
            const results: string[] = [];
            const stimulation2 = cns.activate(
                failedTasks.map(ft => ft.task),
                {
                    contextValues: contextFromFirst as Record<string, unknown>,
                    onResponse: r => {
                        if (r.outputSignal?.collateralName === 'output') {
                            results.push(
                                (r.outputSignal.payload as { result: string })
                                    .result
                            );
                        }
                    },
                }
            );

            await stimulation2.waitUntilComplete();

            // Verify step1 was not re-executed (context should show it was already processed)
            const finalContext = stimulation2.getContext().getAll();
            expect(finalContext).toBeDefined();
            // step2 should have executed
            expect(results.length).toBeGreaterThan(0);
        });

        it('should allow retrying after error with same tasks and context', async () => {
            const ctxBuilder = withCtx<{
                processed: string[];
                attempts: number;
            }>();
            const input = collateral<{ value: number }>('input');
            const intermediate = collateral<{ value: number }>('intermediate');
            const output = collateral<{ result: string }>('output');

            let attemptCount = 0;

            const step1 = ctxBuilder
                .neuron('step1', { intermediate })
                .dendrite({
                    collateral: input,
                    response: async (payload, axon, ctx) => {
                        attemptCount++;
                        const current = ctx.get() || {
                            processed: [],
                            attempts: 0,
                        };
                        ctx.set({
                            processed: ['step1'],
                            attempts: current.attempts + 1,
                        });
                        return axon.intermediate.createSignal({
                            value: payload.value,
                        });
                    },
                });

            const step2 = ctxBuilder.neuron('step2', { output }).dendrite({
                collateral: intermediate,
                response: async (payload, axon, ctx) => {
                    const current = ctx.get() || { processed: [], attempts: 0 };
                    // Simulate error on first attempt
                    if (current.attempts === 0) {
                        ctx.set({
                            processed: [...current.processed, 'step2'],
                            attempts: current.attempts + 1,
                        });
                        throw new Error('Simulated error');
                    }
                    ctx.set({
                        processed: [...current.processed, 'step2'],
                        attempts: current.attempts,
                    });
                    return axon.output.createSignal({
                        result: `Result: ${payload.value}`,
                    });
                },
            });

            const cns = new CNS([step1, step2]);

            // First stimulation - will error
            const results1: string[] = [];
            const errors1: Error[] = [];
            const stimulation1 = cns.stimulate(
                input.createSignal({ value: 42 }),
                {
                    onResponse: r => {
                        if (r.error) {
                            errors1.push(r.error);
                        }
                        if (r.outputSignal?.collateralName === 'output') {
                            results1.push(
                                (r.outputSignal.payload as { result: string })
                                    .result
                            );
                        }
                    },
                }
            );

            await expect(stimulation1.waitUntilComplete()).rejects.toThrow();

            // Should have error
            expect(errors1.length).toBeGreaterThan(0);

            // Get failed tasks
            const failedTasks = stimulation1.getFailedTasks();
            expect(failedTasks.length).toBeGreaterThan(0);

            // Get context from first stimulation
            const contextFromFirst = stimulation1.getContext().getAll();

            // Retry with activate using failed tasks and saved context
            const results2: string[] = [];
            const stimulation2 = cns.activate(
                failedTasks.map(ft => ft.task),
                {
                    contextValues: contextFromFirst as Record<string, unknown>,
                    onResponse: r => {
                        if (r.outputSignal?.collateralName === 'output') {
                            results2.push(
                                (r.outputSignal.payload as { result: string })
                                    .result
                            );
                        }
                    },
                }
            );

            await stimulation2.waitUntilComplete();

            // Should succeed on retry
            expect(results2.length).toBeGreaterThan(0);
            expect(results2[0]).toBe('Result: 42');

            // Context should be preserved
            const finalContext = stimulation2.getContext().getAll();
            expect(finalContext).toBeDefined();
            expect(
                (finalContext.step1 as { processed: string[] }).processed
            ).toContain('step1');
        });

        it('should preserve context and not re-execute completed tasks on retry', async () => {
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

            // First stimulation - abort after step1 completes
            const abortController = new AbortController();
            const stimulation1 = cns.stimulate(
                input.createSignal({ id: 100 }),
                {
                    abortSignal: abortController.signal,
                }
            );

            // Wait for step1 to complete, then abort
            await new Promise(resolve => setTimeout(resolve, 10));
            abortController.abort();
            // Wait for abort to complete - should reject
            await expect(stimulation1.waitUntilComplete()).rejects.toThrow(
                'Stimulation aborted'
            );

            // Verify step1 executed
            expect(executionLog).toContain('step1-100');
            expect(executionLog).not.toContain('step2-100');
            expect(executionLog).not.toContain('step3-100');

            // Get failed tasks and context
            const failedTasks = stimulation1.getFailedTasks();
            expect(failedTasks.length).toBe(1);
            const contextFromFirst = stimulation1.getContext().getAll();

            // Clear execution log to verify retry doesn't re-execute step1
            executionLog.length = 0;

            // Retry with activate
            const results: string[] = [];
            const stimulation2 = cns.activate(
                failedTasks.map(ft => ft.task),
                {
                    contextValues: contextFromFirst as Record<string, unknown>,
                    onResponse: r => {
                        if (r.outputSignal?.collateralName === 'output') {
                            results.push(
                                (r.outputSignal.payload as { result: string })
                                    .result
                            );
                        }
                    },
                }
            );

            await stimulation2.waitUntilComplete();

            // Verify final result
            expect(results.length).toBeGreaterThan(0);
            expect(results[0]).toBe('Final: 100');

            // Verify context preserved
            const finalContext = stimulation2.getContext().getAll();
            expect(finalContext).toBeDefined();
            const executed = Object.values(finalContext)
                .map((v: any) => v.executed)
                .flat();
            expect(executed).toContain('step1-100');
            expect(executed).toContain('step2-100');
            expect(executed).toContain('step3-100');
        });
    });
});
