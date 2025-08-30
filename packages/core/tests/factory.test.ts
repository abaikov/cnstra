import { collateral, neuron } from '../src/factory';

describe('Factory Functions', () => {
    describe('collateral', () => {
        it('should create collateral with string id', () => {
            const testCollateral = collateral('test-id');
            expect(testCollateral.id).toBe('test-id');
        });

        it('should create collateral with typed payload', () => {
            const typedCollateral = collateral<{ message: string }>('typed');
            expect(typedCollateral.id).toBe('typed');

            const signal = typedCollateral.createSignal({ message: 'Hello' });
            expect(signal.type).toBe('typed');
            expect(signal.payload).toEqual({ message: 'Hello' });
        });

        it('should create collateral with undefined payload by default', () => {
            const defaultCollateral = collateral('default');
            const signal = defaultCollateral.createSignal();
            expect(signal.type).toBe('default');
            expect(signal.payload).toBeUndefined();
        });

        it('should handle special characters in id', () => {
            const specialCollateral = collateral('test:collateral:123');
            expect(specialCollateral.id).toBe('test:collateral:123');
        });
    });

    describe('neuron', () => {
        it('should create neuron with id and axon', () => {
            const output = collateral<{ result: string }>('output');
            const testNeuron = neuron('test-neuron', { output });

            expect(testNeuron.id).toBe('test-neuron');
            expect(testNeuron.axon).toEqual({ output });
            expect(testNeuron.dendrites).toEqual([]);
        });

        it('should allow adding dendrites', () => {
            const input = collateral<{ data: string }>('input');
            const output = collateral<{ result: string }>('output');

            const testNeuron = neuron('test-neuron', { output }).dendrite({
                collateral: input,
                reaction: async (payload, axon) => {
                    const data = payload.data;
                    return axon.output.createSignal({
                        result: `Processed: ${data}`,
                    });
                },
            });

            expect(testNeuron.dendrites).toHaveLength(1);
            expect(testNeuron.dendrites[0].collateral.id).toBe('input');
        });

        it('should support chaining dendrites', () => {
            const input1 = collateral<{ data1: string }>('input1');
            const input2 = collateral<{ data2: string }>('input2');
            const output = collateral<{ result: string }>('output');

            const testNeuron = neuron('test-neuron', { output })
                .dendrite({
                    collateral: input1,
                    reaction: async (payload, axon) => {
                        const data = payload.data1;
                        return axon.output.createSignal({
                            result: `From input1: ${data}`,
                        });
                    },
                })
                .dendrite({
                    collateral: input2,
                    reaction: async (payload, axon) => {
                        const data = payload.data2;
                        return axon.output.createSignal({
                            result: `From input2: ${data}`,
                        });
                    },
                });

            expect(testNeuron.dendrites).toHaveLength(2);
            expect(testNeuron.dendrites[0].collateral.id).toBe('input1');
            expect(testNeuron.dendrites[1].collateral.id).toBe('input2');
        });

        it('should handle multiple axon outputs', () => {
            const output1 = collateral<{ result1: string }>('output1');
            const output2 = collateral<{ result2: string }>('output2');

            const testNeuron = neuron('test-neuron', { output1, output2 });

            expect(testNeuron.axon.output1).toBeDefined();
            expect(testNeuron.axon.output2).toBeDefined();
        });

        it('should maintain axon reference after adding dendrites', () => {
            const output = collateral<{ result: string }>('output');
            const testNeuron = neuron('test-neuron', { output });

            const originalAxon = testNeuron.axon;

            const input = collateral<{ data: string }>('input');
            testNeuron.dendrite({
                collateral: input,
                reaction: async (_, axon) => {
                    return axon.output.createSignal({ result: 'test' });
                },
            });

            expect(testNeuron.axon).toBe(originalAxon);
        });
    });

    describe('Integration', () => {
        it('should work together in a simple flow', async () => {
            // Create collaterals
            const input = collateral<{ message: string }>('input');
            const output = collateral<{ processed: string }>('output');

            // Create neuron
            const processor = neuron('processor', { output }).dendrite({
                collateral: input,
                reaction: async (payload, axon) => {
                    const message = payload.message;
                    return axon.output.createSignal({
                        processed: `Processed: ${message}`,
                    });
                },
            });

            // Verify the structure
            expect(processor.id).toBe('processor');
            expect(processor.dendrites).toHaveLength(1);
            expect(processor.axon.output).toBeDefined();

            // Test the dendrite reaction
            const dendrite = processor.dendrites[0];
            const result = await dendrite.reaction(
                { message: 'Hello' },
                processor.axon
            );

            expect(result).toEqual({
                type: 'output',
                payload: { processed: 'Processed: Hello' },
            });
        });
    });
});
