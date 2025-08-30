import { CNS, collateral, neuron } from '../src/index';

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
            const afferentAxon = { input };
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
                    type: 'input',
                    message: 'Hello World',
                } as any,
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

            const afferentAxon = { input };
            const cns = new CNS([multiOutputNeuron]);

            const traces: Array<{
                collateralId: string;
                hops: number;
                payload: unknown;
            }> = [];

            await cns.stimulate(
                input,
                {
                    type: 'input',
                    data: 'test',
                } as any,
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

            const afferentAxon = { request };
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
                    type: 'request',
                    value: 42,
                } as any,
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
                    type: 'request',
                    value: -5,
                } as any,
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
        it('should handle async reactions', async () => {
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

            const afferentAxon = { input };
            const cns = new CNS([asyncNeuron]);

            const startTime = Date.now();
            const traces: Array<{
                collateralId: string;
                hops: number;
                payload: unknown;
            }> = [];

            await cns.stimulate(
                input,
                {
                    type: 'input',
                    delay: 50,
                } as any,
                {
                    onTrace: trace => traces.push(trace),
                }
            );

            const endTime = Date.now();
            const duration = endTime - startTime;

            expect(duration).toBeGreaterThanOrEqual(50);
            expect(traces).toHaveLength(2);
            expect(traces[1].payload).toEqual({ result: 'Delayed by 50ms' });
        });
    });

    describe('Edge Cases', () => {
        it('should handle neurons with no dendrites', async () => {
            const input = collateral<{ data: string }>('input');
            const output = collateral<{ result: string }>('output');

            const neuronWithNoDendrites = neuron('empty', { output });
            const afferentAxon = { input };
            const cns = new CNS([neuronWithNoDendrites]);

            const traces: Array<{
                collateralId: string;
                hops: number;
                payload: unknown;
            }> = [];

            await cns.stimulate(
                input,
                {
                    type: 'input',
                    data: 'test',
                } as any,
                {
                    onTrace: trace => traces.push(trace),
                }
            );

            expect(traces).toHaveLength(1); // Only input, no reactions
            expect(traces[0].collateralId).toBe('input');
        });

        it('should handle undefined payloads', async () => {
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

            const afferentAxon = { input };
            const cns = new CNS([testNeuron]);

            const traces: Array<{
                collateralId: string;
                hops: number;
                payload: unknown;
            }> = [];

            await cns.stimulate(
                input,
                {
                    type: 'input',
                    // No payload
                } as any,
                {
                    onTrace: trace => traces.push(trace),
                }
            );

            expect(traces).toHaveLength(2);
            expect(traces[1].payload).toEqual({
                result: 'Processed undefined payload',
            });
        });
    });
});
