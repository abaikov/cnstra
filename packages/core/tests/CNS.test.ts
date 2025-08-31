import { CNS, collateral, neuron, withCtx } from '../src/index';
import { TCNSStimulationResponse } from '../src/types/TCNSStimulationResponse';

describe('CNS', () => {
    describe('Simple Signal Flow', () => {
        it('should process basic signal flow', async () => {
            // Define collaterals
            const input = collateral<{ message: string }>('input');
            const output = collateral<{ processed: string }>('output');

            // Create neuron
            const processor = neuron('processor', { output }).dendrite({
                collateral: input,
                response: (payload, axon) => {
                    const message = payload.message;
                    return axon.output.createSignal({
                        processed: `Processed: ${message}`,
                    });
                },
            });

            // Create afferent axon that matches the input collateral
            const cns = new CNS([processor]);

            // Track signals
            const traces: TCNSStimulationResponse<string, unknown, unknown>[] =
                [];

            cns.stimulate(
                input.createSignal({
                    message: 'Hello World',
                }),
                {
                    onResponse: trace => {
                        console.log('Trace', trace);
                        traces.push(trace);
                    },
                }
            );

            expect(traces).toHaveLength(2); // input + output
            expect(traces[0].outputSignal?.collateral.id).toBe('input');
            expect(traces[0].outputSignal?.payload).toEqual({
                message: 'Hello World',
            });
            expect(traces[1].inputSignal?.collateral.id).toBe('input');
            expect(traces[1].inputSignal?.payload).toEqual({
                message: 'Hello World',
            });
            expect(traces[1].outputSignal?.collateral.id).toEqual('output');
            expect(traces[1].outputSignal?.payload).toEqual({
                processed: 'Processed: Hello World',
            });
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

            const traces: TCNSStimulationResponse<string, unknown, unknown>[] =
                [];

            await cns.stimulate(input.createSignal(), {
                onResponse: trace => traces.push(trace),
            });

            console.log('Traces', traces);

            expect(traces).toHaveLength(5);
            expect(traces[0].queueLength).not.toBe(0);
            expect(traces[4].outputSignal?.collateral.id).toEqual('output');
            expect(traces[4].queueLength).toBe(0);
        });
    });

    describe('Stack safety on long synchronous chains', () => {
        it('does not blow the stack on a long sync chain (CNS-level)', async () => {
            // Build a long linear chain: input -> n1 -> n2 -> ... -> nK -> output
            const K = 3000; // adjust higher if you want; this should already prove non-recursive pump

            const input = collateral('input');
            const output = collateral('output');

            // Collaterals for the chain
            const mids = Array.from({ length: K }, (_, i) =>
                collateral(`mid_${i}`)
            );

            // Neuron that starts the chain: input -> mid_0
            const startNeuron = neuron('start', { mid_0: mids[0] }).dendrite({
                collateral: input,
                response: (_payload, axon) => axon.mid_0.createSignal(),
            });

            // Middle neurons: mid_i -> mid_{i+1}
            const midNeurons = mids.slice(0, -1).map((c, i) =>
                neuron(`mid_${i}_n`, { next: mids[i + 1] }).dendrite({
                    collateral: c,
                    response: (_payload, axon) => axon.next.createSignal(),
                })
            );

            // Tail neuron: mid_{K-1} -> output
            const tailNeuron = neuron('tail', { output }).dendrite({
                collateral: mids[K - 1],
                response: (_payload, axon) => axon.output.createSignal(),
            });

            const cns = new CNS([startNeuron, ...midNeurons, tailNeuron]);

            const traces: TCNSStimulationResponse<string, unknown, unknown>[] =
                [];

            // Run the synchronous chain
            await cns.stimulate(input.createSignal(), {
                onResponse: trace => traces.push(trace),
            });

            // Basic shape checks
            expect(traces.length).toBe(K + 2);
            // Explanation:
            //  - 1 trace for the initial input.responseToSignal call
            //  - K traces for each hop through mids
            //  - 1 final trace for output

            // First snapshot should reflect pending work (> 0)
            expect(traces[0].queueLength).toBeGreaterThan(0);

            // Final snapshot: correct output + queue drained
            const last = traces[traces.length - 1];
            expect(last.outputSignal?.collateral.id).toBe('output');
            expect(last.queueLength).toBe(0);
        });

        it('does not blow the stack when each sync step enqueues additional work', async () => {
            // Variant: a short branch that does nothing + a long chain;
            // ensures that enqueueing during processing doesn't recurse.
            const input = collateral('input');
            const noop = collateral('noop');
            const output = collateral('output');

            const K = 2000;
            const mids = Array.from({ length: K }, (_, i) =>
                collateral(`mid_${i}`)
            );

            const noopNeuron = neuron('noop', {}).dendrite({
                collateral: noop,
                response: () => {
                    /* no-op */
                },
            });

            const startNeuron = neuron('start', {
                mid_0: mids[0],
                noop,
            }).dendrite({
                collateral: input,
                response: (_payload, axon) => {
                    // Enqueue a no-op branch synchronously alongside the main chain
                    axon.noop.createSignal();
                    return axon.mid_0.createSignal();
                },
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

            const cns = new CNS([
                noopNeuron,
                startNeuron,
                ...midNeurons,
                tailNeuron,
            ]);

            const traces: TCNSStimulationResponse<string, unknown, unknown>[] =
                [];

            await cns.stimulate(input.createSignal(), {
                onResponse: t => traces.push(t),
            });

            // Still finishes cleanly with output and empty queue
            const last = traces[traces.length - 1];
            expect(last.outputSignal?.collateral.id).toBe('output');
            expect(last.queueLength).toBe(0);

            // Ensure we produced at least K+2 traces (as in the first test)
            expect(traces.length).toBeGreaterThanOrEqual(K + 2);
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

            const traces: TCNSStimulationResponse<string, unknown, unknown>[] =
                [];

            await cns.stimulate(input.createSignal({ data: 'test' }), {
                onResponse: trace => traces.push(trace),
            });

            expect(traces).toHaveLength(2); // input + output2 (only returned signal is processed)
            expect(traces[1].outputSignal?.payload).toEqual({
                result: 'Second: test',
            });
        });
    });

    // describe('Conditional Logic', () => {
    //     it('should handle conditional signal routing', async () => {
    //         const request = collateral<{ value: number }>('request');
    //         const success = collateral<{ result: string }>('success');
    //         const error = collateral<{ error: string }>('error');

    //         const router = neuron('router', { success, error }).dendrite({
    //             collateral: request,
    //             response: async (payload, axon) => {
    //                 const value = (payload as { value: number }).value;
    //                 if (value > 0) {
    //                     return axon.success.createSignal({
    //                         result: `Success: ${value}`,
    //                     });
    //                 } else {
    //                     return axon.error.createSignal({
    //                         error: `Error: ${value} is not positive`,
    //                     });
    //                 }
    //             },
    //         });

    //         const cns = new CNS([router]);

    //         // Test success case
    //         const successTraces: Array<{
    //             collateralId: string;
    //             hops: number;
    //             payload: unknown;
    //         }> = [];
    //         await cns.stimulate(
    //             request,
    //             {
    //                 value: 42,
    //             },
    //             {
    //                 onTrace: trace => successTraces.push(trace),
    //             }
    //         );

    //         expect(successTraces).toHaveLength(2); // request + success
    //         expect(successTraces[1].payload).toEqual({ result: 'Success: 42' });

    //         // Test error case
    //         const errorTraces: Array<{
    //             collateralId: string;
    //             hops: number;
    //             payload: unknown;
    //         }> = [];
    //         await cns.stimulate(
    //             request,
    //             {
    //                 value: -5,
    //             },
    //             {
    //                 onTrace: trace => errorTraces.push(trace),
    //             }
    //         );

    //         expect(errorTraces).toHaveLength(2); // request + error
    //         expect(errorTraces[1].payload).toEqual({
    //             error: 'Error: -5 is not positive',
    //         });
    //     });
    // });

    // describe('Async Operations', () => {
    //     it('should handle async reactions', done => {
    //         const input = collateral<{ delay: number }>('input');
    //         const output = collateral<{ result: string }>('output');

    //         const asyncNeuron = neuron('async', { output }).dendrite({
    //             collateral: input,
    //             response: async (payload, axon) => {
    //                 const delay = (payload as { delay: number }).delay;
    //                 await new Promise(resolve => setTimeout(resolve, delay));
    //                 return axon.output.createSignal({
    //                     result: `Delayed by ${delay}ms`,
    //                 });
    //             },
    //         });

    //         const cns = new CNS([asyncNeuron]);

    //         const startTime = Date.now();
    //         const traces: Array<{
    //             collateralId: string;
    //             hops: number;
    //             payload: unknown;
    //         }> = [];

    //         // Fire-and-forget with completion detection via trace
    //         cns.stimulate(
    //             input,
    //             { delay: 50 },
    //             {
    //                 onTrace: trace => {
    //                     traces.push(trace);

    //                     // When we see the output, we know processing is done
    //                     if (trace.collateralId === 'output') {
    //                         const endTime = Date.now();
    //                         const duration = endTime - startTime;

    //                         expect(duration).toBeGreaterThanOrEqual(50);
    //                         expect(traces).toHaveLength(2);
    //                         expect(traces[1].payload).toEqual({
    //                             result: 'Delayed by 50ms',
    //                         });
    //                         done();
    //                     }
    //                 },
    //             }
    //         );
    //     });
    // });

    // describe('Edge Cases', () => {
    //     it('should handle neurons with no dendrites', done => {
    //         const input = collateral<{ data: string }>('input');
    //         const output = collateral<{ result: string }>('output');

    //         const neuronWithNoDendrites = neuron('empty', { output });
    //         const cns = new CNS([neuronWithNoDendrites]);

    //         const traces: Array<{
    //             collateralId: string;
    //             hops: number;
    //             payload: unknown;
    //         }> = [];

    //         // Fire-and-forget
    //         cns.stimulate(
    //             input,
    //             { data: 'test' },
    //             {
    //                 onTrace: trace => {
    //                     traces.push(trace);

    //                     // Check queue length to detect completion
    //                     if (trace.queueLength === 0) {
    //                         expect(traces).toHaveLength(1); // Only input, no reactions
    //                         expect(traces[0].collateralId).toBe('input');
    //                         done();
    //                     }
    //                 },
    //             }
    //         );
    //     });

    //     it('should handle undefined payloads', done => {
    //         const input = collateral('input'); // No payload type
    //         const output = collateral<{ result: string }>('output');

    //         const testNeuron = neuron('test', { output }).dendrite({
    //             collateral: input,
    //             response: async (payload, axon) => {
    //                 return axon.output.createSignal({
    //                     result: 'Processed undefined payload',
    //                 });
    //             },
    //         });

    //         const cns = new CNS([testNeuron]);

    //         const traces: Array<{
    //             collateralId: string;
    //             hops: number;
    //             payload: unknown;
    //         }> = [];

    //         // Fire-and-forget
    //         cns.stimulate(
    //             input,
    //             {}, // No payload
    //             {
    //                 onTrace: trace => {
    //                     traces.push(trace);

    //                     // When we see the output, processing is complete
    //                     if (trace.collateralId === 'output') {
    //                         expect(traces).toHaveLength(2);
    //                         expect(traces[1].payload).toEqual({
    //                             result: 'Processed undefined payload',
    //                         });
    //                         done();
    //                     }
    //                 },
    //             }
    //         );
    //     });
    // });

    // describe('Retry Mechanism with Context', () => {
    //     type MyCtxType = {
    //         tryNumber: number;
    //     };

    //     it('should retry stimulation from failed collateral with context store', done => {
    //         // Define collaterals
    //         const input = collateral<{ data: string }>('input');
    //         const intermediate = collateral<{ processed: string }>(
    //             'intermediate'
    //         );
    //         const output = collateral<{ result: string }>('output');

    //         // First neuron: processes input and passes to intermediate
    //         const firstNeuron = withCtx<MyCtxType>()
    //             .neuron('first', { intermediate })
    //             .dendrite({
    //                 collateral: input,
    //                 response: async (payload, axon) => {
    //                     const data = (payload as { data: string }).data;
    //                     return axon.intermediate.createSignal({
    //                         processed: `First: ${data}`,
    //                     });
    //                 },
    //             });

    //         // Second neuron: increments try counter and conditionally throws error
    //         const secondNeuron = withCtx<MyCtxType>()
    //             .neuron('second', { output })
    //             .dendrite({
    //                 collateral: intermediate,
    //                 response: async (payload, axon, ctx) => {
    //                     const current = ctx.get() || { tryNumber: 0 };
    //                     const newTryNumber = current.tryNumber + 1;

    //                     // Update context with incremented try number
    //                     ctx.set({ tryNumber: newTryNumber });

    //                     if (newTryNumber === 1) {
    //                         // First try: throw an error
    //                         throw new Error('Simulated failure on first try');
    //                     } else {
    //                         // Second try: pass signal to next neuron
    //                         const processedData = (
    //                             payload as { processed: string }
    //                         ).processed;
    //                         return axon.output.createSignal({
    //                             result: `Second (try ${newTryNumber}): ${processedData}`,
    //                         });
    //                     }
    //                 },
    //             });

    //         // Third neuron: final processing (outputs to a different collateral)
    //         const finalOutput = collateral<{ finalResult: string }>(
    //             'finalOutput'
    //         );
    //         const thirdNeuron = withCtx<MyCtxType>()
    //             .neuron('third', { finalOutput })
    //             .dendrite({
    //                 collateral: output,
    //                 response: async (payload, axon) => {
    //                     const result = (payload as { result: string }).result;
    //                     return axon.finalOutput.createSignal({
    //                         finalResult: `Third: ${result}`,
    //                     });
    //                 },
    //             });

    //         const cns = new CNS([firstNeuron, secondNeuron, thirdNeuron]);

    //         let traces: Array<{
    //             collateralId: string;
    //             hops: number;
    //             payload: unknown;
    //             queueLength?: number;
    //             error?: Error;
    //         }> = [];

    //         let hasRetriedAfterError = false;
    //         let contextStore: any = undefined;
    //         let testCompleted = false;

    //         cns.stimulate(
    //             input,
    //             { data: 'test' },
    //             {
    //                 ctx: contextStore,
    //                 onTrace: trace => {
    //                     traces.push(trace);

    //                     // Check if stimulation is finished (queue is empty)
    //                     if (trace.queueLength === 0) {
    //                         const errorTraces = traces.filter(t => t.error);
    //                         const outputTraces = traces.filter(
    //                             t => t.collateralId === 'output' && !t.error
    //                         );

    //                         if (
    //                             errorTraces.length > 0 &&
    //                             !hasRetriedAfterError
    //                         ) {
    //                             // First stimulation failed, retry with preserved context
    //                             hasRetriedAfterError = true;
    //                             contextStore = trace.contextStore;
    //                             traces = []; // Reset traces for retry attempt

    //                             setTimeout(() => {
    //                                 cns.stimulate(
    //                                     input,
    //                                     { data: 'test' },
    //                                     {
    //                                         ctx: contextStore,
    //                                         onTrace: retryTrace => {
    //                                             traces.push(retryTrace);

    //                                             if (
    //                                                 retryTrace.queueLength === 0
    //                                             ) {
    //                                                 const retryOutputTraces =
    //                                                     traces.filter(
    //                                                         t =>
    //                                                             t.collateralId ===
    //                                                                 'output' &&
    //                                                             !t.error
    //                                                     );

    //                                                 if (
    //                                                     retryOutputTraces.length >
    //                                                         0 &&
    //                                                     !testCompleted
    //                                                 ) {
    //                                                     testCompleted = true;
    //                                                     // Verify final successful output contains 'try 2'
    //                                                     expect(
    //                                                         retryOutputTraces[0]
    //                                                             .payload
    //                                                     ).toEqual({
    //                                                         result: expect.stringContaining(
    //                                                             'try 2'
    //                                                         ),
    //                                                     });
    //                                                     done();
    //                                                 }
    //                                             }
    //                                         },
    //                                     }
    //                                 );
    //                             }, 10);
    //                         }
    //                     }
    //                 },
    //             }
    //         );
    //     });
    // });

    // describe('Self-Recursion', () => {
    //     it('should allow neuron to process its own output signal', done => {
    //         const input = collateral<{ message: string }>('input');
    //         const output = collateral<{ result: string; iteration: number }>(
    //             'output'
    //         );

    //         const recursiveNeuron = neuron('recursive', { output })
    //             .dendrite({
    //                 collateral: input,
    //                 response: async (payload, axon) => {
    //                     const message = (payload as { message: string })
    //                         .message;
    //                     return axon.output.createSignal({
    //                         result: `Processed: ${message}`,
    //                         iteration: 1,
    //                     });
    //                 },
    //             })
    //             .dendrite({
    //                 collateral: output as any, // Use any to bypass type checking for self-listening
    //                 response: async (payload, axon) => {
    //                     const data = payload as {
    //                         result: string;
    //                         iteration: number;
    //                     };
    //                     if (data.iteration < 3) {
    //                         // Recursively process own output signal
    //                         return (axon as any).output.createSignal({
    //                             result: `${data.result} (iteration ${
    //                                 data.iteration + 1
    //                             })`,
    //                             iteration: data.iteration + 1,
    //                         });
    //                     }
    //                     // Stop recursion after 3 iterations
    //                     return undefined;
    //                 },
    //             });

    //         const cns = new CNS([recursiveNeuron]);

    //         const traces: Array<{
    //             collateralId: string;
    //             hops: number;
    //             payload: unknown;
    //         }> = [];

    //         cns.stimulate(
    //             input,
    //             { message: 'Hello' },
    //             {
    //                 onTrace: trace => {
    //                     traces.push(trace);

    //                     // Check if we have all expected traces
    //                     if (traces.length >= 4) {
    //                         expect(traces).toHaveLength(4); // input + 3 output iterations
    //                         expect(traces[0].collateralId).toBe('input');
    //                         expect(traces[0].hops).toBe(0);

    //                         // First output (hops: 1)
    //                         expect(traces[1].collateralId).toBe('output');
    //                         expect(traces[1].hops).toBe(1);
    //                         expect(traces[1].payload).toEqual({
    //                             result: 'Processed: Hello',
    //                             iteration: 1,
    //                         });

    //                         // Second output (hops: 2)
    //                         expect(traces[2].collateralId).toBe('output');
    //                         expect(traces[2].hops).toBe(2);
    //                         expect(traces[2].payload).toEqual({
    //                             result: 'Processed: Hello (iteration 2)',
    //                             iteration: 2,
    //                         });

    //                         // Third output (hops: 3)
    //                         expect(traces[3].collateralId).toBe('output');
    //                         expect(traces[3].hops).toBe(3);
    //                         expect(traces[3].payload).toEqual({
    //                             result: 'Processed: Hello (iteration 2) (iteration 3)',
    //                             iteration: 3,
    //                         });

    //                         done();
    //                     }
    //                 },
    //             }
    //         );
    //     });

    //     it('should respect maxHops when neuron processes itself recursively', done => {
    //         const input = collateral<{ data: string }>('input');
    //         const output = collateral<{ value: string; count: number }>(
    //             'output'
    //         );

    //         const infiniteRecursiveNeuron = neuron('infinite', { output })
    //             .dendrite({
    //                 collateral: input,
    //                 response: async (payload, axon) => {
    //                     const data = (payload as { data: string }).data;
    //                     return axon.output.createSignal({
    //                         value: data,
    //                         count: 1,
    //                     });
    //                 },
    //             })
    //             .dendrite({
    //                 collateral: output as any, // Use any to bypass type checking for self-listening
    //                 response: async (payload, axon) => {
    //                     const data = payload as {
    //                         value: string;
    //                         count: number;
    //                     };
    //                     // Always continue recursion
    //                     return (axon as any).output.createSignal({
    //                         value: `${data.value}-${data.count}`,
    //                         count: data.count + 1,
    //                     });
    //                 },
    //             });

    //         const cns = new CNS([infiniteRecursiveNeuron]);

    //         const traces: Array<{
    //             collateralId: string;
    //             hops: number;
    //             payload: unknown;
    //         }> = [];

    //         cns.stimulate(
    //             input,
    //             { data: 'test' },
    //             {
    //                 maxHops: 5, // Limit to 5 hops
    //                 onTrace: trace => {
    //                     traces.push(trace);

    //                     // Check if we've reached maxHops
    //                     if (trace.hops >= 5) {
    //                         // Should have exactly 6 traces: input (hops: 0) + 5 outputs (hops: 1-5)
    //                         expect(traces).toHaveLength(6);
    //                         expect(traces[0].collateralId).toBe('input');
    //                         expect(traces[0].hops).toBe(0);

    //                         // Verify hops progression
    //                         for (let i = 1; i <= 5; i++) {
    //                             expect(traces[i].collateralId).toBe('output');
    //                             expect(traces[i].hops).toBe(i);
    //                             expect(traces[i].payload).toHaveProperty(
    //                                 'count',
    //                                 i
    //                             );
    //                         }

    //                         // Last trace should be at maxHops
    //                         expect(traces[5].hops).toBe(5);

    //                         done();
    //                     }
    //                 },
    //             }
    //         );
    //     });
    // });

    describe('Context Cleanup with SCC Tracking', () => {
        it('should correctly identify when neurons can be safely cleaned up', () => {
            // Create a simple chain: A -> B -> C
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
                    // Terminal neuron - no output
                },
            });

            const cns = new CNS([neuronA, neuronB, neuronC], {
                autoCleanupContexts: true,
            });

            // Verify SCC structure
            expect(cns.stronglyConnectedComponents).toHaveLength(3); // 3 separate SCCs
            expect(cns.getSCCSetByNeuronId('A')?.size).toBe(1);
            expect(cns.getSCCSetByNeuronId('B')?.size).toBe(1);
            expect(cns.getSCCSetByNeuronId('C')?.size).toBe(1);

            // Test reachability logic
            const emptyActiveCounts = new Map<number, number>();

            // All neurons should be considered "done" when nothing is active
            expect(cns.canNeuronBeGuaranteedDone('A', emptyActiveCounts)).toBe(
                true
            );
            expect(cns.canNeuronBeGuaranteedDone('B', emptyActiveCounts)).toBe(
                true
            );
            expect(cns.canNeuronBeGuaranteedDone('C', emptyActiveCounts)).toBe(
                true
            );
        });

        it('should handle cyclic dependencies correctly', () => {
            // Create a cycle: A <-> B
            const signalA = collateral<{ from: string }>('signalA');
            const signalB = collateral<{ from: string }>('signalB');

            const neuronA = neuron('A', { signalA }).dendrite({
                collateral: signalB,
                response: (payload, axon) => {
                    return axon.signalA.createSignal({ from: 'A' });
                },
            });

            const neuronB = neuron('B', { signalB }).dendrite({
                collateral: signalA,
                response: (payload, axon) => {
                    return axon.signalB.createSignal({ from: 'B' });
                },
            });

            const cns = new CNS([neuronA, neuronB], {
                autoCleanupContexts: true,
            });

            // Verify SCC structure - should have one SCC with both neurons
            expect(cns.stronglyConnectedComponents).toHaveLength(1);
            const scc = cns.getSCCSetByNeuronId('A');
            expect(scc).toBeDefined();
            expect(scc?.size).toBe(2);
            expect(scc?.has('A')).toBe(true);
            expect(scc?.has('B')).toBe(true);

            // Test reachability logic
            const emptyActiveCounts = new Map<number, number>();
            const activeCounts = new Map<number, number>();
            activeCounts.set(0, 1); // SCC 0 has 1 active neuron

            // When nothing is active, both neurons can be considered done
            expect(cns.canNeuronBeGuaranteedDone('A', emptyActiveCounts)).toBe(
                true
            );
            expect(cns.canNeuronBeGuaranteedDone('B', emptyActiveCounts)).toBe(
                true
            );

            // When SCC is active, neither neuron can be considered done
            expect(cns.canNeuronBeGuaranteedDone('A', activeCounts)).toBe(
                false
            );
            expect(cns.canNeuronBeGuaranteedDone('B', activeCounts)).toBe(
                false
            );
        });

        it('should build correct SCC DAG', () => {
            // Create a more complex structure: A -> B -> C, where B and C form a cycle
            const start = collateral<{ message: string }>('start');
            const middle = collateral<{ from: string }>('middle');
            const cycle1 = collateral<{ from: string }>('cycle1');
            const cycle2 = collateral<{ from: string }>('cycle2');

            const neuronA = neuron('A', { middle }).dendrite({
                collateral: start,
                response: (payload, axon) => {
                    return axon.middle.createSignal({ from: 'A' });
                },
            });

            const neuronB = neuron('B', { cycle1 }).dendrite({
                collateral: middle,
                response: (payload, axon) => {
                    return axon.cycle1.createSignal({ from: 'B' });
                },
            });

            const neuronC = neuron('C', { cycle2 }).dendrite({
                collateral: cycle1,
                response: (payload, axon) => {
                    return axon.cycle2.createSignal({ from: 'C' });
                },
            });

            const neuronD = neuron('D', {}).dendrite({
                collateral: cycle2,
                response: (payload, axon) => {
                    // Terminal neuron
                },
            });

            const cns = new CNS([neuronA, neuronB, neuronC, neuronD], {
                autoCleanupContexts: true,
            });

            // Should have 4 SCCs: [D], [C], [B], [A] (in reverse topological order)
            expect(cns.stronglyConnectedComponents).toHaveLength(4);

            // Each neuron should be in its own SCC since there are no cycles
            const sccA = cns.getSCCSetByNeuronId('A');
            expect(sccA?.size).toBe(1);
            expect(sccA?.has('A')).toBe(true);

            const sccB = cns.getSCCSetByNeuronId('B');
            expect(sccB?.size).toBe(1);
            expect(sccB?.has('B')).toBe(true);

            const sccC = cns.getSCCSetByNeuronId('C');
            expect(sccC?.size).toBe(1);
            expect(sccC?.has('C')).toBe(true);

            const sccD = cns.getSCCSetByNeuronId('D');
            expect(sccD?.size).toBe(1);
            expect(sccD?.has('D')).toBe(true);
        });

        it('should handle SCC index lookup correctly', () => {
            // Create a simple chain: A -> B
            const start = collateral<{ message: string }>('start');
            const end = collateral<{ from: string }>('end');

            const neuronA = neuron('A', { end }).dendrite({
                collateral: start,
                response: (payload, axon) => {
                    return axon.end.createSignal({ from: 'A' });
                },
            });

            const neuronB = neuron('B', {}).dendrite({
                collateral: end,
                response: (payload, axon) => {
                    // Terminal neuron
                },
            });

            const cns = new CNS([neuronA, neuronB], {
                autoCleanupContexts: true,
            });

            // Test SCC index lookup
            const sccIndexA = cns.getSccIndexByNeuronId('A');
            const sccIndexB = cns.getSccIndexByNeuronId('B');

            expect(sccIndexA).toBeDefined();
            expect(sccIndexB).toBeDefined();
            expect(sccIndexA).not.toBe(sccIndexB);

            // Test that we can get the same SCC set using the index
            const sccSetA = cns.getSCCSetByNeuronId('A');
            const sccSetB = cns.getSCCSetByNeuronId('B');

            expect(sccSetA).toBe(cns.stronglyConnectedComponents[sccIndexA!]);
            expect(sccSetB).toBe(cns.stronglyConnectedComponents[sccIndexB!]);
        });
    });
});
