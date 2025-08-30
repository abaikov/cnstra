import { collateral, neuron, withCtx } from '../src/factory';

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
                response: async (payload, axon) => {
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
                    response: async (payload, axon) => {
                        const data = payload.data1;
                        return axon.output.createSignal({
                            result: `From input1: ${data}`,
                        });
                    },
                })
                .dendrite({
                    collateral: input2,
                    response: async (payload, axon) => {
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
                response: async (_, axon) => {
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
                response: async (payload, axon) => {
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
            const result = await dendrite.response(
                { message: 'Hello' },
                processor.axon,
                {
                    get: () => undefined,
                    set: () => {},
                }
            );

            expect(result).toEqual({
                type: 'output',
                payload: { processed: 'Processed: Hello' },
            });
        });
    });
});

describe('Context Integration', () => {
    describe('withCtx', () => {
        it('should create a context-aware neuron builder', () => {
            const ctxBuilder = withCtx<{ userId: string; sessionId: string }>();
            expect(typeof ctxBuilder.neuron).toBe('function');
        });

        it('should create neurons with typed context', () => {
            const ctxBuilder = withCtx<{ userId: string }>();
            const output = collateral<{ result: string }>('output');
            const testNeuron = ctxBuilder.neuron('test', { output });

            expect(testNeuron.id).toBe('test');
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
                        return axon.output.createSignal({ result: newValue });
                    },
                });

            expect(testNeuron.dendrites).toHaveLength(1);
            expect(testNeuron.dendrites[0].collateral.id).toBe('input');
        });
    });

    describe('Context Operations', () => {
        it('should set and get context values', async () => {
            const ctxBuilder = withCtx<{ message: string; count: number }>();
            const input = collateral<{ text: string }>('input');
            const output = collateral<{ result: string }>('output');

            const testNeuron = ctxBuilder
                .neuron('processor', { output })
                .dendrite({
                    collateral: input,
                    response: async (payload, axon, ctx) => {
                        // Set context
                        ctx.set({ message: payload.text, count: 1 });

                        // Get context
                        const context = ctx.get();
                        expect(context?.message).toBe(payload.text);
                        expect(context?.count).toBe(1);

                        return axon.output.createSignal({
                            result: context?.message || '',
                        });
                    },
                });

            const dendrite = testNeuron.dendrites[0];
            let contextValue: { message: string; count: number } | undefined;
            const mockCtx = {
                get: () => contextValue,
                set: (value: { message: string; count: number }) => {
                    contextValue = value;
                },
            };

            const result = await dendrite.response(
                { text: 'Hello Context' },
                testNeuron.axon,
                mockCtx
            );

            expect(result).toEqual({
                type: 'output',
                payload: { result: 'Hello Context' },
            });
        });

        it('should handle undefined context gracefully', async () => {
            const ctxBuilder = withCtx<{ data: string }>();
            const input = collateral<{ value: string }>('input');
            const output = collateral<{ result: string }>('output');

            const testNeuron = ctxBuilder.neuron('safe', { output }).dendrite({
                collateral: input,
                response: async (payload, axon, ctx) => {
                    const context = ctx.get();
                    const safeData = context?.data || 'default';

                    return axon.output.createSignal({ result: safeData });
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
                mockCtx
            );

            expect(result).toEqual({
                type: 'output',
                payload: { result: 'default' },
            });
        });

        it('should update context values in dendrite responses', async () => {
            const ctxBuilder = withCtx<{ step: number; history: string[] }>();
            const input = collateral<{ action: string }>('input');
            const output = collateral<{ step: number; history: string[] }>(
                'output'
            );

            const testNeuron = ctxBuilder
                .neuron('workflow', { output })
                .dendrite({
                    collateral: input,
                    response: async (payload, axon, ctx) => {
                        const current = ctx.get() || { step: 0, history: [] };
                        const newStep = current.step + 1;
                        const newHistory = [...current.history, payload.action];

                        ctx.set({ step: newStep, history: newHistory });

                        return axon.output.createSignal({
                            step: newStep,
                            history: newHistory,
                        });
                    },
                });

            const dendrite = testNeuron.dendrites[0];
            let contextValue: { step: number; history: string[] } = {
                step: 0,
                history: [],
            };
            const mockCtx = {
                get: () => contextValue,
                set: (value: { step: number; history: string[] }) => {
                    contextValue = value;
                },
            };

            const result = await dendrite.response(
                { action: 'start' },
                testNeuron.axon,
                mockCtx
            );

            expect(result).toEqual({
                type: 'output',
                payload: { step: 1, history: ['start'] },
            });
        });
    });

    describe('Context with Multiple Dendrites', () => {
        it('should maintain context across multiple dendrites', async () => {
            const ctxBuilder = withCtx<{ session: string; user: string }>();
            const input1 = collateral<{ sessionId: string }>('input1');
            const input2 = collateral<{ username: string }>('input2');
            const output = collateral<{ status: string }>('output');

            const testNeuron = ctxBuilder
                .neuron('session', { output })
                .dendrite({
                    collateral: input1,
                    response: async (payload, axon, ctx) => {
                        ctx.set({ session: payload.sessionId, user: '' });
                        return axon.output.createSignal({
                            status: 'session_set',
                        });
                    },
                })
                .dendrite({
                    collateral: input2,
                    response: async (payload, axon, ctx) => {
                        const current = ctx.get() || { session: '', user: '' };
                        ctx.set({ ...current, user: payload.username });
                        return axon.output.createSignal({ status: 'user_set' });
                    },
                });

            expect(testNeuron.dendrites).toHaveLength(2);

            let contextValue: { session: string; user: string } | undefined;
            const mockCtx = {
                get: () => contextValue,
                set: (value: { session: string; user: string }) => {
                    contextValue = value;
                },
            };

            // Test first dendrite
            const result1 = await testNeuron.dendrites[0].response(
                { sessionId: 'sess_123' },
                testNeuron.axon,
                mockCtx
            );

            expect(result1).toEqual({
                type: 'output',
                payload: { status: 'session_set' },
            });

            // Test second dendrite
            const result2 = await testNeuron.dendrites[1].response(
                { username: 'john_doe' },
                testNeuron.axon,
                mockCtx
            );

            expect(result2).toEqual({
                type: 'output',
                payload: { status: 'user_set' },
            });
        });
    });

    describe('Context Type Safety', () => {
        it('should enforce context type constraints', () => {
            const ctxBuilder = withCtx<{
                readonly id: string;
                mutable: number;
            }>();
            const output = collateral<{ result: string }>('output');

            // This should compile without type errors
            const testNeuron = ctxBuilder.neuron('typed', { output }).dendrite({
                collateral: collateral<{ value: string }>('input'),
                response: async (payload, axon, ctx) => {
                    const context = ctx.get();
                    if (context) {
                        // TypeScript should know the shape of context
                        const id = context.id;
                        const mutable = context.mutable;

                        ctx.set({ id, mutable: mutable + 1 });
                    }

                    return axon.output.createSignal({ result: payload.value });
                },
            });

            expect(testNeuron.id).toBe('typed');
        });
    });

    describe('Context Integration with Existing Features', () => {
        it('should work with chained dendrites and context', async () => {
            const ctxBuilder = withCtx<{ chain: number[] }>();
            const input = collateral<{ value: number }>('input');
            const output = collateral<{ chain: number[] }>('output');

            const testNeuron = ctxBuilder
                .neuron('chain', { output })
                .dendrite({
                    collateral: input,
                    response: async (payload, axon, ctx) => {
                        const current = ctx.get() || { chain: [] };
                        const newChain = [...current.chain, payload.value];
                        ctx.set({ chain: newChain });
                        return axon.output.createSignal({ chain: newChain });
                    },
                })
                .dendrite({
                    collateral: input,
                    response: async (payload, axon, ctx) => {
                        const current = ctx.get() || { chain: [] };
                        const newChain = [...current.chain, payload.value * 2];
                        ctx.set({ chain: newChain });
                        return axon.output.createSignal({ chain: newChain });
                    },
                });

            expect(testNeuron.dendrites).toHaveLength(2);

            let contextValue: { chain: number[] } = { chain: [1, 2] };
            const mockCtx = {
                get: () => contextValue,
                set: (value: { chain: number[] }) => {
                    contextValue = value;
                },
            };

            const result = await testNeuron.dendrites[1].response(
                { value: 3 },
                testNeuron.axon,
                mockCtx
            );

            expect(result).toEqual({
                type: 'output',
                payload: { chain: [1, 2, 6] },
            });
        });
    });
});
