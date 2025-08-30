import { CNS, collateral, neuron, withCtx } from '../src/index';

describe('CNS', () => {
    describe('Basic Functionality', () => {
        it('should create CNS instance', () => {
            const cns = new CNS([]);
            expect(cns).toBeInstanceOf(CNS);
        });

        it('should handle empty neuron array', async () => {
            const cns = new CNS([]);
            // This should not throw even with empty neurons
            expect(cns).toBeDefined();
        });
    });

    describe('Simple Signal Flow', () => {
        it('should process basic signal flow', async () => {
            // Define collaterals
            const input = collateral<{ message: string }>('input');
            const output = collateral<{ processed: string }>('output');

            // Create neuron
            const processor = neuron('processor', { output }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    const message = (payload as { message: string }).message;
                    return axon.output.createSignal({
                        processed: `Processed: ${message}`,
                    });
                },
            });

            // Create afferent axon that matches the input collateral
            const cns = new CNS([processor]);

            // Track signals
            const traces: Array<{
                collateralId: string;
                hops: number;
                payload: unknown;
            }> = [];

            await cns.stimulate(
                input,
                {
                    message: 'Hello World',
                },
                {
                    onTrace: trace => traces.push(trace),
                }
            );

            expect(traces).toHaveLength(2); // input + output
            expect(traces[0].collateralId).toBe('input');
            expect(traces[1].collateralId).toBe('output');
            expect(traces[1].payload).toEqual({
                processed: 'Processed: Hello World',
            });
        });
    });

    describe('Fan-Out Pattern', () => {
        it('should handle multiple outputs from single input', async () => {
            const input = collateral<{ data: string }>('input');
            const output1 = collateral<{ result: string }>('output1');
            const output2 = collateral<{ result: string }>('output2');

            const multiOutputNeuron = neuron('multi', {
                output1,
                output2,
            }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    const data = (payload as { data: string }).data;
                    axon.output1.createSignal({ result: `First: ${data}` });
                    return axon.output2.createSignal({
                        result: `Second: ${data}`,
                    });
                },
            });

            const cns = new CNS([multiOutputNeuron]);

            const traces: Array<{
                collateralId: string;
                hops: number;
                payload: unknown;
            }> = [];

            await cns.stimulate(
                input,
                {
                    data: 'test',
                },
                {
                    onTrace: trace => traces.push(trace),
                }
            );

            expect(traces).toHaveLength(2); // input + output2 (only returned signal is processed)
            expect(traces[1].payload).toEqual({ result: 'Second: test' });
        });
    });

    describe('Conditional Logic', () => {
        it('should handle conditional signal routing', async () => {
            const request = collateral<{ value: number }>('request');
            const success = collateral<{ result: string }>('success');
            const error = collateral<{ error: string }>('error');

            const router = neuron('router', { success, error }).dendrite({
                collateral: request,
                response: async (payload, axon) => {
                    const value = (payload as { value: number }).value;
                    if (value > 0) {
                        return axon.success.createSignal({
                            result: `Success: ${value}`,
                        });
                    } else {
                        return axon.error.createSignal({
                            error: `Error: ${value} is not positive`,
                        });
                    }
                },
            });

            const cns = new CNS([router]);

            // Test success case
            const successTraces: Array<{
                collateralId: string;
                hops: number;
                payload: unknown;
            }> = [];
            await cns.stimulate(
                request,
                {
                    value: 42,
                },
                {
                    onTrace: trace => successTraces.push(trace),
                }
            );

            expect(successTraces).toHaveLength(2); // request + success
            expect(successTraces[1].payload).toEqual({ result: 'Success: 42' });

            // Test error case
            const errorTraces: Array<{
                collateralId: string;
                hops: number;
                payload: unknown;
            }> = [];
            await cns.stimulate(
                request,
                {
                    value: -5,
                },
                {
                    onTrace: trace => errorTraces.push(trace),
                }
            );

            expect(errorTraces).toHaveLength(2); // request + error
            expect(errorTraces[1].payload).toEqual({
                error: 'Error: -5 is not positive',
            });
        });
    });

    describe('Async Operations', () => {
        it('should handle async reactions', done => {
            const input = collateral<{ delay: number }>('input');
            const output = collateral<{ result: string }>('output');

            const asyncNeuron = neuron('async', { output }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    const delay = (payload as { delay: number }).delay;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return axon.output.createSignal({
                        result: `Delayed by ${delay}ms`,
                    });
                },
            });

            const cns = new CNS([asyncNeuron]);

            const startTime = Date.now();
            const traces: Array<{
                collateralId: string;
                hops: number;
                payload: unknown;
            }> = [];

            // Fire-and-forget with completion detection via trace
            cns.stimulate(
                input,
                { delay: 50 },
                {
                    onTrace: trace => {
                        traces.push(trace);

                        // When we see the output, we know processing is done
                        if (trace.collateralId === 'output') {
                            const endTime = Date.now();
                            const duration = endTime - startTime;

                            expect(duration).toBeGreaterThanOrEqual(50);
                            expect(traces).toHaveLength(2);
                            expect(traces[1].payload).toEqual({
                                result: 'Delayed by 50ms',
                            });
                            done();
                        }
                    },
                }
            );
        });
    });

    describe('Edge Cases', () => {
        it('should handle neurons with no dendrites', done => {
            const input = collateral<{ data: string }>('input');
            const output = collateral<{ result: string }>('output');

            const neuronWithNoDendrites = neuron('empty', { output });
            const cns = new CNS([neuronWithNoDendrites]);

            const traces: Array<{
                collateralId: string;
                hops: number;
                payload: unknown;
            }> = [];

            // Fire-and-forget
            cns.stimulate(
                input,
                { data: 'test' },
                {
                    onTrace: trace => {
                        traces.push(trace);

                        // Check queue length to detect completion
                        if (trace.queueLength === 0) {
                            expect(traces).toHaveLength(1); // Only input, no reactions
                            expect(traces[0].collateralId).toBe('input');
                            done();
                        }
                    },
                }
            );
        });

        it('should handle undefined payloads', done => {
            const input = collateral('input'); // No payload type
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

            const traces: Array<{
                collateralId: string;
                hops: number;
                payload: unknown;
            }> = [];

            // Fire-and-forget
            cns.stimulate(
                input,
                {}, // No payload
                {
                    onTrace: trace => {
                        traces.push(trace);

                        // When we see the output, processing is complete
                        if (trace.collateralId === 'output') {
                            expect(traces).toHaveLength(2);
                            expect(traces[1].payload).toEqual({
                                result: 'Processed undefined payload',
                            });
                            done();
                        }
                    },
                }
            );
        });
    });

    describe('Retry Mechanism with Context', () => {
        type MyCtxType = {
            tryNumber: number;
        };

        it('should retry stimulation from failed collateral with context store', done => {
            // Define collaterals
            const input = collateral<{ data: string }>('input');
            const intermediate = collateral<{ processed: string }>('intermediate');
            const output = collateral<{ result: string }>('output');

            // First neuron: processes input and passes to intermediate
            const firstNeuron = withCtx<MyCtxType>().neuron('first', { intermediate }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    const data = (payload as { data: string }).data;
                    return axon.intermediate.createSignal({
                        processed: `First: ${data}`,
                    });
                },
            });

            // Second neuron: increments try counter and conditionally throws error
            const secondNeuron = withCtx<MyCtxType>().neuron('second', { output }).dendrite({
                collateral: intermediate,
                response: async (payload, axon, ctx) => {
                    const current = ctx.get() || { tryNumber: 0 };
                    const newTryNumber = current.tryNumber + 1;
                    
                    // Update context with incremented try number
                    ctx.set({ tryNumber: newTryNumber });

                    if (newTryNumber === 1) {
                        // First try: throw an error
                        throw new Error('Simulated failure on first try');
                    } else {
                        // Second try: pass signal to next neuron
                        const processedData = (payload as { processed: string }).processed;
                        return axon.output.createSignal({
                            result: `Second (try ${newTryNumber}): ${processedData}`,
                        });
                    }
                },
            });

            // Third neuron: final processing (outputs to a different collateral)
            const finalOutput = collateral<{ finalResult: string }>('finalOutput');
            const thirdNeuron = withCtx<MyCtxType>().neuron('third', { finalOutput }).dendrite({
                collateral: output,
                response: async (payload, axon) => {
                    const result = (payload as { result: string }).result;
                    return axon.finalOutput.createSignal({
                        finalResult: `Third: ${result}`,
                    });
                },
            });

            const cns = new CNS([firstNeuron, secondNeuron, thirdNeuron]);

            let traces: Array<{
                collateralId: string;
                hops: number;
                payload: unknown;
                queueLength?: number;
                error?: Error;
            }> = [];

            let hasRetriedAfterError = false;
            let contextStore: any = undefined;
            let testCompleted = false;

            cns.stimulate(
                input,
                { data: 'test' },
                {
                    ctx: contextStore,
                    onTrace: trace => {
                        traces.push(trace);

                        // Check if stimulation is finished (queue is empty)
                        if (trace.queueLength === 0) {
                            const errorTraces = traces.filter(t => t.error);
                            const outputTraces = traces.filter(t => t.collateralId === 'output' && !t.error);

                            if (errorTraces.length > 0 && !hasRetriedAfterError) {
                                // First stimulation failed, retry with preserved context
                                hasRetriedAfterError = true;
                                contextStore = trace.contextStore;
                                traces = []; // Reset traces for retry attempt
                                
                                setTimeout(() => {
                                    cns.stimulate(
                                        input,
                                        { data: 'test' },
                                        {
                                            ctx: contextStore,
                                            onTrace: retryTrace => {
                                                traces.push(retryTrace);
                                                
                                                if (retryTrace.queueLength === 0) {
                                                    const retryOutputTraces = traces.filter(t => t.collateralId === 'output' && !t.error);
                                                    
                                                    if (retryOutputTraces.length > 0 && !testCompleted) {
                                                        testCompleted = true;
                                                        // Verify final successful output contains 'try 2'
                                                        expect(retryOutputTraces[0].payload).toEqual({
                                                            result: expect.stringContaining('try 2'),
                                                        });
                                                        done();
                                                    }
                                                }
                                            },
                                        }
                                    );
                                }, 10);
                            }
                        }
                    },
                }
            );
        });
    });

    describe('Self-Recursion', () => {
        it('should allow neuron to process its own output signal', done => {
            const input = collateral<{ message: string }>('input');
            const output = collateral<{ result: string; iteration: number }>(
                'output'
            );

            const recursiveNeuron = neuron('recursive', { output })
                .dendrite({
                    collateral: input,
                    response: async (payload, axon) => {
                        const message = (payload as { message: string })
                            .message;
                        return axon.output.createSignal({
                            result: `Processed: ${message}`,
                            iteration: 1,
                        });
                    },
                })
                .dendrite({
                    collateral: output as any, // Use any to bypass type checking for self-listening
                    response: async (payload, axon) => {
                        const data = payload as {
                            result: string;
                            iteration: number;
                        };
                        if (data.iteration < 3) {
                            // Recursively process own output signal
                            return (axon as any).output.createSignal({
                                result: `${data.result} (iteration ${
                                    data.iteration + 1
                                })`,
                                iteration: data.iteration + 1,
                            });
                        }
                        // Stop recursion after 3 iterations
                        return undefined;
                    },
                });

            const cns = new CNS([recursiveNeuron]);

            const traces: Array<{
                collateralId: string;
                hops: number;
                payload: unknown;
            }> = [];

            cns.stimulate(
                input,
                { message: 'Hello' },
                {
                    onTrace: trace => {
                        traces.push(trace);

                        // Check if we have all expected traces
                        if (traces.length >= 4) {
                            expect(traces).toHaveLength(4); // input + 3 output iterations
                            expect(traces[0].collateralId).toBe('input');
                            expect(traces[0].hops).toBe(0);

                            // First output (hops: 1)
                            expect(traces[1].collateralId).toBe('output');
                            expect(traces[1].hops).toBe(1);
                            expect(traces[1].payload).toEqual({
                                result: 'Processed: Hello',
                                iteration: 1,
                            });

                            // Second output (hops: 2)
                            expect(traces[2].collateralId).toBe('output');
                            expect(traces[2].hops).toBe(2);
                            expect(traces[2].payload).toEqual({
                                result: 'Processed: Hello (iteration 2)',
                                iteration: 2,
                            });

                            // Third output (hops: 3)
                            expect(traces[3].collateralId).toBe('output');
                            expect(traces[3].hops).toBe(3);
                            expect(traces[3].payload).toEqual({
                                result: 'Processed: Hello (iteration 2) (iteration 3)',
                                iteration: 3,
                            });

                            done();
                        }
                    },
                }
            );
        });

        it('should respect maxHops when neuron processes itself recursively', done => {
            const input = collateral<{ data: string }>('input');
            const output = collateral<{ value: string; count: number }>(
                'output'
            );

            const infiniteRecursiveNeuron = neuron('infinite', { output })
                .dendrite({
                    collateral: input,
                    response: async (payload, axon) => {
                        const data = (payload as { data: string }).data;
                        return axon.output.createSignal({
                            value: data,
                            count: 1,
                        });
                    },
                })
                .dendrite({
                    collateral: output as any, // Use any to bypass type checking for self-listening
                    response: async (payload, axon) => {
                        const data = payload as {
                            value: string;
                            count: number;
                        };
                        // Always continue recursion
                        return (axon as any).output.createSignal({
                            value: `${data.value}-${data.count}`,
                            count: data.count + 1,
                        });
                    },
                });

            const cns = new CNS([infiniteRecursiveNeuron]);

            const traces: Array<{
                collateralId: string;
                hops: number;
                payload: unknown;
            }> = [];

            cns.stimulate(
                input,
                { data: 'test' },
                {
                    maxHops: 5, // Limit to 5 hops
                    onTrace: trace => {
                        traces.push(trace);

                        // Check if we've reached maxHops
                        if (trace.hops >= 5) {
                            // Should have exactly 6 traces: input (hops: 0) + 5 outputs (hops: 1-5)
                            expect(traces).toHaveLength(6);
                            expect(traces[0].collateralId).toBe('input');
                            expect(traces[0].hops).toBe(0);

                            // Verify hops progression
                            for (let i = 1; i <= 5; i++) {
                                expect(traces[i].collateralId).toBe('output');
                                expect(traces[i].hops).toBe(i);
                                expect(traces[i].payload).toHaveProperty(
                                    'count',
                                    i
                                );
                            }

                            // Last trace should be at maxHops
                            expect(traces[5].hops).toBe(5);

                            done();
                        }
                    },
                }
            );
        });
    });
});
