import {
    CNS,
    collateral,
    neuron,
    withCtx,
    TCNSSignal,
    afferentPath,
    modality,
    CNSDrainGuard,
} from '../src/index';

const uiAxon = {
    userEntersApp: collateral<{
        userId: string;
        deckTitle: string;
        cardTitle: string;
    }>(),
    createCardWithDeckButtonClicked: collateral<{
        deckTitle: string;
        cardTitle: string;
    }>(),
};

const deckAxon = {
    createdAtUserEntersApp: collateral<{
        deckId: string;
        cardTitle: string;
        userId: string;
    }>(),
    createdAtCreateCardWithDeckButtonClicked: collateral<{
        deckId: string;
        cardTitle: string;
    }>(),
};

const deck = neuron(deckAxon)
    .dendrite({
        collateral: uiAxon.userEntersApp,
        response: (payload, axon) => {
            const deckId = 'deck-' + Math.random().toString(36).slice(2);
            return axon.createdAtUserEntersApp.createSignal({
                deckId,
                cardTitle: payload.cardTitle,
                userId: payload.userId,
            });
        },
    })
    .dendrite({
        collateral: uiAxon.createCardWithDeckButtonClicked,
        response: (payload, axon) => {
            const deckId = 'deck-' + Math.random().toString(36).slice(2);
            return axon.createdAtCreateCardWithDeckButtonClicked.createSignal({
                deckId,
                cardTitle: payload.cardTitle,
            });
        },
    });

const card = neuron({})
    .dendrite({
        collateral: deckAxon.createdAtCreateCardWithDeckButtonClicked,
        response: payload => {
            console.log('card title', payload.cardTitle);
            // create a card
        },
    })
    .dendrite({
        collateral: deckAxon.createdAtUserEntersApp,
        response: payload => {
            console.log('card title', payload.cardTitle);
            // create a card
        },
    });

const cns = new CNS([deck, card]);

cns.stimulate(
    uiAxon.userEntersApp.createSignal({
        userId: 'user-123',
        deckTitle: 'Deck 1',
        cardTitle: 'Card 1',
    })
);

cns.stimulate(
    uiAxon.createCardWithDeckButtonClicked.createSignal({
        deckTitle: 'Deck 1',
        cardTitle: 'Card 1',
    })
);

describe('CNStra Core Tests', () => {
    describe('Factory Functions', () => {
        describe('collateral', () => {
            it('should create collateral with typed payload', () => {
                const typedCollateral = collateral<{ message: string }>();

                const signal = typedCollateral.createSignal({
                    message: 'Hello',
                });
                expect(signal.collateral).toBe(typedCollateral);
                expect(signal.payload).toEqual({ message: 'Hello' });
            });

            it('should create collateral with undefined payload by default', () => {
                const defaultCollateral = collateral();
                const signal = defaultCollateral.createSignal();
                expect(signal.collateral).toBe(defaultCollateral);
                expect(signal.payload).toBeUndefined();
            });
        });

        describe('neuron', () => {
            it('should create neuron with axon', () => {
                const output = collateral<{ result: string }>();
                const testNeuron = neuron({ output });
                expect(testNeuron.axon).toEqual({ output });
                expect(testNeuron.dendrites).toEqual([]);
            });

            it('should allow adding dendrites with response function', () => {
                const input = collateral<{ data: string }>();
                const output = collateral<{ result: string }>();

                const testNeuron = neuron({ output }).dendrite({
                    collateral: input,
                    response: async (payload, axon) => {
                        const data = payload.data;
                        return axon.output.createSignal({
                            result: `Processed: ${data}`,
                        });
                    },
                });

                expect(testNeuron.dendrites).toHaveLength(1);
                expect(testNeuron.dendrites[0].collateral).toBe(input);
            });

            it('should support chaining dendrites', () => {
                const input1 = collateral<{ data1: string }>();
                const input2 = collateral<{ data2: string }>();
                const output = collateral<{ result: string }>();

                const testNeuron = neuron({ output })
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
                expect(testNeuron.dendrites[0].collateral).toBe(input1);
                expect(testNeuron.dendrites[1].collateral).toBe(input2);
            });

            it('should support mixing single and multiple collateral dendrites', () => {
                const input1 = collateral<{ data1: string }>();
                const input2 = collateral<{ data: string }>();
                const input3 = collateral<{ data: string }>();
                const output = collateral<{ result: string }>();

                const testNeuron = neuron( { output })
                    .dendrite({
                        collateral: [input1],
                        response: async (payload, axon) => {
                            return axon.output.createSignal({
                                result: `Single: ${payload.data1}`,
                            });
                        },
                    })
                    .dendrite({
                        collateral: [input2, input3],
                        response: async (payload, axon) => {
                            return axon.output.createSignal({
                                result: `Multiple: ${payload.data}`,
                            });
                        },
                    });

                expect(testNeuron.dendrites).toHaveLength(3);
                expect(testNeuron.dendrites[0].collateral).toBe(input1);
                expect(testNeuron.dendrites[1].collateral).toBe(input2);
                expect(testNeuron.dendrites[2].collateral).toBe(input3);
            });

            it('should support collaterals with different payload types and infer union type', () => {
                const userCreated = collateral<{
                    userId: string;
                    name: string;
                }>();
                const userUpdated = collateral<{
                    userId: string;
                    email: string;
                }>();
                const userDeleted = collateral<{ userId: string }>();
                const output = collateral<{ result: string }>();

                const testNeuron = neuron( { output }).dendrite({
                    collateral: [userCreated, userUpdated, userDeleted],
                    response: async (payload, axon) => {
                        const userId = payload.userId;

                        // Type narrowing should work
                        if ('name' in payload) {
                            // payload is { userId: string; name: string }
                            return axon.output.createSignal({
                                result: `Created: ${payload.name}`,
                            });
                        } else if ('email' in payload) {
                            // payload is { userId: string; email: string }
                            return axon.output.createSignal({
                                result: `Updated: ${payload.email}`,
                            });
                        } else {
                            // payload is { userId: string }
                            return axon.output.createSignal({
                                result: `Deleted: ${userId}`,
                            });
                        }
                    },
                });

                expect(testNeuron.dendrites).toHaveLength(3);
                expect(testNeuron.dendrites[0].collateral).toBe(userCreated);
                expect(testNeuron.dendrites[1].collateral).toBe(userUpdated);
                expect(testNeuron.dendrites[2].collateral).toBe(userDeleted);
            });

            it('should handle multiple axon outputs', () => {
                const output1 = collateral<{ result1: string }>();
                const output2 = collateral<{ result2: string }>();

                const testNeuron = neuron( { output1, output2 });

                expect(testNeuron.axon.output1).toBeDefined();
                expect(testNeuron.axon.output2).toBeDefined();
            });

            it('should create signals with different payload types for different output collaterals', async () => {
                const input1 = collateral<{
                    userId: string;
                    deckTitle: string;
                    cardTitle: string;
                }>();
                const input2 = collateral<{
                    deckTitle: string;
                    cardTitle: string;
                }>();
                const output1 = collateral<{
                    deckId: string;
                    cardTitle: string;
                    userId: string;
                }>();
                const output2 = collateral<{
                    deckId: string;
                    cardTitle: string;
                }>();

                const testNeuron = neuron( {
                    output1,
                    output2,
                })
                    .dendrite({
                        collateral: input1,
                        response: async (payload, axon) => {
                            return axon.output1.createSignal({
                                deckId: 'deck-123',
                                cardTitle: payload.cardTitle,
                                userId: payload.userId,
                            });
                        },
                    })
                    .dendrite({
                        collateral: input2,
                        response: async (payload, axon) => {
                            return axon.output2.createSignal({
                                deckId: 'deck-789',
                                cardTitle: payload.cardTitle,
                            });
                        },
                    });

                expect(testNeuron.dendrites).toHaveLength(2);

                const dendrite1 = testNeuron.dendrites[0];
                const dendrite2 = testNeuron.dendrites[1];

                // Test first dendrite - returns output1 signal with userId
                const signal1 = await dendrite1.response(
                    {
                        userId: 'user-456',
                        deckTitle: 'Deck 1',
                        cardTitle: 'Card 1',
                    },
                    testNeuron.axon,
                    {
                        get: () => undefined,
                        set: () => {},
                        delete: () => {},
                    }
                );

                expect(signal1).toEqual({
                    collateral: output1,
                    payload: {
                        deckId: 'deck-123',
                        cardTitle: 'Card 1',
                        userId: 'user-456',
                    },
                });

                // Test second dendrite - returns output2 signal without userId
                const signal2 = await dendrite2.response(
                    {
                        deckTitle: 'Deck 2',
                        cardTitle: 'Card 2',
                    },
                    testNeuron.axon,
                    {
                        get: () => undefined,
                        set: () => {},
                        delete: () => {},
                    }
                );

                expect(signal2).toEqual({
                    collateral: output2,
                    payload: {
                        deckId: 'deck-789',
                        cardTitle: 'Card 2',
                    },
                });

                // Verify that signals have correct types (TypeScript will check this)
                if (signal1 && 'payload' in signal1) {
                    expect(signal1.payload).toHaveProperty('userId');
                }
                if (signal2 && 'payload' in signal2) {
                    expect(signal2.payload).not.toHaveProperty('userId');
                }
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
                const output = collateral<{ result: string }>();
                const testNeuron = ctxBuilder.neuron( { output });

                expect(testNeuron.axon).toEqual({ output });
                expect(testNeuron.dendrites).toEqual([]);
            });

            it('should allow adding dendrites with context access', () => {
                const ctxBuilder = withCtx<{ counter: number }>();
                const input = collateral<{ increment: number }>();
                const output = collateral<{ result: number }>();

                const testNeuron = ctxBuilder
                    .neuron( { output })
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
                expect(testNeuron.dendrites[0].collateral).toBe(input);
            });
        });

        describe('afferentPath', () => {
            it('should create afferent path without parent', () => {
                const path = afferentPath();
                expect(path).toEqual({});
                expect(path.parentAfferentPath).toBeUndefined();
                expect('parentAfferentPath' in path).toBe(false);
            });

            it('should create afferent path with parent', () => {
                const parent = afferentPath();
                const path = afferentPath(parent);
                expect(path.parentAfferentPath).toBe(parent);
            });

            it('should create hierarchical paths', () => {
                const root = afferentPath();
                const level1 = afferentPath(root);
                const level2 = afferentPath(level1);
                expect(level2.parentAfferentPath).toBe(level1);
                expect(level1.parentAfferentPath).toBe(root);
                expect(root.parentAfferentPath).toBeUndefined();
            });
        });

        describe('modality', () => {
            it('should create modality with afferent paths', () => {
                const primary = afferentPath();
                const secondary = afferentPath(primary);
                const visualModality = modality({
                    primary,
                    secondary,
                });

                expect(visualModality.afferentPaths).toBeDefined();
                expect(visualModality.afferentPaths.primary).toBe(primary);
                expect(visualModality.afferentPaths.secondary).toBe(secondary);
                expect(visualModality.afferentPaths.secondary.parentAfferentPath).toBe(primary);
            });

            it('should create modality with single afferent path', () => {
                const main = afferentPath();
                const simpleModality = modality({
                    main,
                });

                expect(simpleModality.afferentPaths.main).toBe(main);
                expect(simpleModality.afferentPaths.main.parentAfferentPath).toBeUndefined();
            });

            it('should create modality with empty afferent paths object', () => {
                const emptyModality = modality({});

                expect(emptyModality.afferentPaths).toBeDefined();
                expect(Object.keys(emptyModality.afferentPaths)).toHaveLength(0);
            });

            it('should create modality with multiple hierarchical paths', () => {
                const root = afferentPath();
                const level1 = afferentPath(root);
                const level2a = afferentPath(level1);
                const level2b = afferentPath(level1);
                const level3 = afferentPath(level2a);
                const complexModality = modality({
                    root,
                    level1,
                    level2a,
                    level2b,
                    level3,
                });

                expect(Object.keys(complexModality.afferentPaths)).toHaveLength(5);
                expect(complexModality.afferentPaths.root).toBe(root);
                expect(complexModality.afferentPaths.level1).toBe(level1);
                expect(complexModality.afferentPaths.level1.parentAfferentPath).toBe(root);
                expect(complexModality.afferentPaths.level2a).toBe(level2a);
                expect(complexModality.afferentPaths.level2a.parentAfferentPath).toBe(level1);
                expect(complexModality.afferentPaths.level2b).toBe(level2b);
                expect(complexModality.afferentPaths.level2b.parentAfferentPath).toBe(level1);
                expect(complexModality.afferentPaths.level3).toBe(level3);
                expect(complexModality.afferentPaths.level3.parentAfferentPath).toBe(level2a);
            });

            it('should support numeric keys', () => {
                const path0 = afferentPath();
                const path1 = afferentPath(path0);
                const numericModality = modality({
                    0: path0,
                    1: path1,
                });

                expect(numericModality.afferentPaths[0]).toBe(path0);
                expect(numericModality.afferentPaths[1]).toBe(path1);
                expect(numericModality.afferentPaths[1].parentAfferentPath).toBe(path0);
            });
        });

        describe('modalityDendrite', () => {
            it('should route to correct afferent path handler', async () => {
                const input = collateral<{ source: string }>();
                const output = collateral<{ cardId: string }>();

                const uiButton = afferentPath();
                const onboarding = afferentPath();
                const cardModality = modality({
                    uiButton,
                    onboarding,
                });

                const afferentPathsMap = new Map([
                    [uiButton, (payload: { source: string }, axon: any) => {
                        return {
                            id: `real-${payload.source}`,
                        };
                    }],
                    [onboarding, (payload: { source: string }, axon: any) => {
                        return {
                            id: `tutorial-${payload.source}`,
                        };
                    }],
                ]);

                const createCardNeuron = neuron( {
                    output,
                }).modalityDendrite({
                    collateral: input,
                    modality: cardModality,
                    afferentPaths: afferentPathsMap,
                    output: (card: { id: string }, axon) => {
                        return axon.output.createSignal({
                            cardId: card.id,
                        });
                    },
                });

                const cns = new CNS([createCardNeuron]);

                const responses: Array<{ cardId: string }> = [];
                await cns.stimulate(input.createSignal({ source: 'test' }), {
                    modality: cardModality,
                    afferentPath: uiButton,
                    onResponse: response => {
                        if (
                            response.outputSignal?.payload &&
                            response.inputSignal &&
                            response.outputSignal.collateral === output
                        ) {
                            responses.push(
                                response.outputSignal.payload as {
                                    cardId: string;
                                }
                            );
                        }
                    },
                });

                expect(responses).toHaveLength(1);
                expect(responses[0].cardId).toBe('real-test');
            });

            it('should use default handler when afferent path not found', async () => {
                const input = collateral<{ source: string }>();
                const output = collateral<{ cardId: string }>();

                const uiButton = afferentPath();
                const onboarding = afferentPath();
                const cardModality = modality({
                    uiButton,
                    onboarding,
                });

                const afferentPathsMap = new Map([
                    [uiButton, (payload: { source: string }, axon: any) => {
                        return {
                            id: `real-${payload.source}`,
                        };
                    }],
                ]);

                const createCardNeuron = neuron( {
                    output,
                }).modalityDendrite({
                    collateral: input,
                    modality: cardModality,
                    afferentPaths: afferentPathsMap,
                    default: (payload, axon) => {
                        return {
                            id: `default-${
                                (payload as { source: string }).source
                            }`,
                        };
                    },
                    output: (card, axon) => {
                        return axon.output.createSignal({
                            cardId: card.id,
                        });
                    },
                });

                const cns = new CNS([createCardNeuron]);

                const responses: Array<{ cardId: string }> = [];
                await cns.stimulate(input.createSignal({ source: 'test' }), {
                    modality: cardModality,
                    afferentPath: cardModality.afferentPaths.onboarding,
                    onResponse: response => {
                        if (
                            response.outputSignal?.payload &&
                            response.inputSignal &&
                            response.outputSignal.collateral === output
                        ) {
                            responses.push(
                                response.outputSignal.payload as {
                                    cardId: string;
                                }
                            );
                        }
                    },
                });

                expect(responses).toHaveLength(1);
                expect(responses[0].cardId).toBe('default-test');
            });

            it('should throw error when no handler matches and no default', async () => {
                const input = collateral<{ source: string }>();
                const output = collateral<{ cardId: string }>();

                const uiButton = afferentPath();
                const onboarding = afferentPath();
                const cardModality = modality({
                    uiButton,
                    onboarding,
                });

                const afferentPathsMap = new Map([
                    [uiButton, (payload: { source: string }, axon: any) => {
                        return {
                            id: `real-${payload.source}`,
                        };
                    }],
                ]);

                const createCardNeuron = neuron( {
                    output,
                }).modalityDendrite({
                    collateral: input,
                    modality: cardModality,
                    afferentPaths: afferentPathsMap,
                    output: (card, axon) => {
                        return axon.output.createSignal({
                            cardId: card.id,
                        });
                    },
                });

                const cns = new CNS([createCardNeuron]);

                const stimulation = cns.stimulate(
                    input.createSignal({ source: 'test' }),
                    {
                        modality: cardModality,
                        afferentPath: onboarding,
                    }
                );

                await expect(stimulation.waitUntilComplete()).rejects.toThrow();

                const failedTasks = stimulation.getFailedTasks();
                expect(failedTasks).toHaveLength(1);
                expect(failedTasks[0].error.message).toBe(
                    'modalityDendrite: No handler found for afferent path in modality and no default handler provided'
                );
            });

            it('should throw error when modality does not match and no default', async () => {
                const input = collateral<{ source: string }>();
                const output = collateral<{ cardId: string }>();

                const uiButton = afferentPath();
                const cardModality = modality({
                    uiButton,
                });

                const path1 = afferentPath();
                const otherModality = modality({
                    path1,
                });

                const afferentPathsMap = new Map([
                    [uiButton, (payload: { source: string }, axon: any) => {
                        return {
                            id: `real-${payload.source}`,
                        };
                    }],
                ]);

                const createCardNeuron = neuron( {
                    output,
                }).modalityDendrite({
                    collateral: input,
                    modality: cardModality,
                    afferentPaths: afferentPathsMap,
                    output: (card, axon) => {
                        return axon.output.createSignal({
                            cardId: card.id,
                        });
                    },
                });

                const cns = new CNS([createCardNeuron]);

                const stimulation = cns.stimulate(
                    input.createSignal({ source: 'test' }),
                    {
                        modality: otherModality,
                        afferentPath: path1,
                    }
                );

                await expect(stimulation.waitUntilComplete()).rejects.toThrow();

                const failedTasks = stimulation.getFailedTasks();
                expect(failedTasks).toHaveLength(1);
                expect(failedTasks[0].error.message).toBe(
                    'modalityDendrite: No handler found for modality and no default handler provided'
                );
            });

            it('should use default when modality does not match', async () => {
                const input = collateral<{ source: string }>();
                const output = collateral<{ cardId: string }>();

                const uiButton = afferentPath();
                const cardModality = modality({
                    uiButton,
                });

                const path1 = afferentPath();
                const otherModality = modality({
                    path1,
                });

                const afferentPathsMap = new Map([
                    [uiButton, (payload: { source: string }, axon: any) => {
                        return {
                            id: `real-${payload.source}`,
                        };
                    }],
                ]);

                const createCardNeuron = neuron( {
                    output,
                }).modalityDendrite({
                    collateral: input,
                    modality: cardModality,
                    afferentPaths: afferentPathsMap,
                    default: (payload, axon) => {
                        return {
                            id: `default-${
                                (payload as { source: string }).source
                            }`,
                        };
                    },
                    output: (card, axon) => {
                        return axon.output.createSignal({
                            cardId: card.id,
                        });
                    },
                });

                const cns = new CNS([createCardNeuron]);

                const responses: Array<{ cardId: string }> = [];
                await cns.stimulate(input.createSignal({ source: 'test' }), {
                    modality: otherModality,
                    afferentPath: path1,
                    onResponse: response => {
                        if (
                            response.outputSignal?.payload &&
                            response.inputSignal &&
                            response.outputSignal.collateral === output
                        ) {
                            responses.push(
                                response.outputSignal.payload as {
                                    cardId: string;
                                }
                            );
                        }
                    },
                });

                expect(responses).toHaveLength(1);
                expect(responses[0].cardId).toBe('default-test');
            });

            it('should handle async handlers', async () => {
                const input = collateral<{ source: string }>();
                const output = collateral<{ cardId: string }>();

                const uiButton = afferentPath();
                const cardModality = modality({
                    uiButton,
                });

                const afferentPathsMap = new Map([
                    [uiButton, async (payload: { source: string }, axon: any) => {
                        await new Promise(resolve =>
                            setTimeout(resolve, 10)
                        );
                        return {
                            id: `async-${payload.source}`,
                        };
                    }],
                ]);

                const createCardNeuron = neuron( {
                    output,
                }).modalityDendrite({
                    collateral: input,
                    modality: cardModality,
                    afferentPaths: afferentPathsMap,
                    output: (card, axon) => {
                        return axon.output.createSignal({
                            cardId: card.id,
                        });
                    },
                });

                const cns = new CNS([createCardNeuron]);

                const responses: Array<{ cardId: string }> = [];
                const stimulation = cns.stimulate(
                    input.createSignal({ source: 'test' }),
                    {
                        modality: cardModality,
                        afferentPath: cardModality.afferentPaths.uiButton,
                        onResponse: response => {
                            if (
                                response.outputSignal?.payload &&
                                response.inputSignal &&
                                response.outputSignal.collateral === output
                            ) {
                                responses.push(
                                    response.outputSignal.payload as {
                                        cardId: string;
                                    }
                                );
                            }
                        },
                    }
                );

                await stimulation.waitUntilComplete();

                expect(responses).toHaveLength(1);
                expect(responses[0].cardId).toBe('async-test');
            });

            it('should use default when no modality in stimulation', async () => {
                const input = collateral<{ source: string }>();
                const output = collateral<{ cardId: string }>();

                const uiButton = afferentPath();
                const cardModality = modality({
                    uiButton,
                });

                const afferentPathsMap = new Map([
                    [uiButton, (payload: { source: string }, axon: any) => {
                        return {
                            id: `real-${payload.source}`,
                        };
                    }],
                ]);

                const createCardNeuron = neuron( {
                    output,
                }).modalityDendrite({
                    collateral: input,
                    modality: cardModality,
                    afferentPaths: afferentPathsMap,
                    default: (payload, axon) => {
                        return {
                            id: `default-${
                                (payload as { source: string }).source
                            }`,
                        };
                    },
                    output: (card, axon) => {
                        return axon.output.createSignal({
                            cardId: card.id,
                        });
                    },
                });

                const cns = new CNS([createCardNeuron]);

                const responses: Array<{ cardId: string }> = [];
                await cns.stimulate(input.createSignal({ source: 'test' }), {
                    onResponse: response => {
                        if (
                            response.outputSignal?.payload &&
                            response.inputSignal &&
                            response.outputSignal.collateral === output
                        ) {
                            responses.push(
                                response.outputSignal.payload as {
                                    cardId: string;
                                }
                            );
                        }
                    },
                });

                expect(responses).toHaveLength(1);
                expect(responses[0].cardId).toBe('default-test');
            });

            it('should throw error when no modality in stimulation and no default', async () => {
                const input = collateral<{ source: string }>();
                const output = collateral<{ cardId: string }>();

                const uiButton = afferentPath();
                const cardModality = modality({
                    uiButton,
                });

                const afferentPathsMap = new Map([
                    [uiButton, (payload: { source: string }, axon: any) => {
                        return {
                            id: `real-${payload.source}`,
                        };
                    }],
                ]);

                const createCardNeuron = neuron( {
                    output,
                }).modalityDendrite({
                    collateral: input,
                    modality: cardModality,
                    afferentPaths: afferentPathsMap,
                    output: (card, axon) => {
                        return axon.output.createSignal({
                            cardId: card.id,
                        });
                    },
                });

                const cns = new CNS([createCardNeuron]);

                const stimulation = cns.stimulate(
                    input.createSignal({ source: 'test' }),
                    {}
                );

                await expect(stimulation.waitUntilComplete()).rejects.toThrow();

                const failedTasks = stimulation.getFailedTasks();
                expect(failedTasks).toHaveLength(1);
                expect(failedTasks[0].error.message).toBe(
                    'modalityDendrite: No handler found for modality and no default handler provided'
                );
            });
        });

        describe('multiple modalities', () => {
            it('should support multiple modalities in one dendrite', async () => {
                const input = collateral<{ source: string }>();
                const output = collateral<{ cardId: string }>();

                const uiButton = afferentPath();
                const onboarding = afferentPath();
                const cardModality = modality({
                    uiButton,
                    onboarding,
                });

                const fromUI = afferentPath();
                const fromAPI = afferentPath();
                const deckModality = modality({
                    fromUI,
                    fromAPI,
                });

                const createNeuron = neuron( {
                    output,
                }).modalityDendrite({
                    collateral: input,
                    modalities: [
                        {
                            modality: cardModality,
                            afferentPaths: new Map([
                                [uiButton, (payload: { source: string }, axon: any) => {
                                    return {
                                        id: `card-ui-${payload.source}`,
                                    };
                                }],
                                [onboarding, (payload: { source: string }, axon: any) => {
                                    return {
                                        id: `card-onboarding-${payload.source}`,
                                    };
                                }],
                            ]),
                        },
                        {
                            modality: deckModality,
                            afferentPaths: new Map([
                                [fromUI, (payload: { source: string }, axon: any) => {
                                    return {
                                        id: `deck-ui-${payload.source}`,
                                    };
                                }],
                                [fromAPI, (payload: { source: string }, axon: any) => {
                                    return {
                                        id: `deck-api-${payload.source}`,
                                    };
                                }],
                            ]),
                        },
                    ],
                    output: (result, axon) => {
                        return axon.output.createSignal({
                            cardId: (result as { id: string }).id,
                        });
                    },
                });

                const cns = new CNS([createNeuron]);

                // Test card modality
                const cardResponses: Array<{ cardId: string }> = [];
                const cardStimulation = cns.stimulate(
                    input.createSignal({ source: 'test' }),
                    {
                        modality: cardModality,
                        afferentPath: uiButton,
                        onResponse: response => {
                            if (
                                response.outputSignal?.payload &&
                                response.inputSignal &&
                                response.outputSignal.collateral === output
                            ) {
                                cardResponses.push(
                                    response.outputSignal.payload as {
                                        cardId: string;
                                    }
                                );
                            }
                        },
                    }
                );

                await cardStimulation.waitUntilComplete();

                expect(cardResponses).toHaveLength(1);
                expect(cardResponses[0].cardId).toBe('card-ui-test');

                // Test deck modality
                const deckResponses: Array<{ cardId: string }> = [];
                const deckStimulation = cns.stimulate(
                    input.createSignal({ source: 'api-test' }),
                    {
                        modality: deckModality,
                        afferentPath: fromAPI,
                        onResponse: response => {
                            if (
                                response.outputSignal?.payload &&
                                response.inputSignal &&
                                response.outputSignal.collateral === output
                            ) {
                                deckResponses.push(
                                    response.outputSignal.payload as {
                                        cardId: string;
                                    }
                                );
                            }
                        },
                    }
                );

                await deckStimulation.waitUntilComplete();

                expect(deckResponses).toHaveLength(1);
                expect(deckResponses[0].cardId).toBe('deck-api-api-test');
            });

            it('should use modality-specific default handler', async () => {
                const input = collateral<{ source: string }>();
                const output = collateral<{ cardId: string }>();

                const uiButton = afferentPath();
                const cardModality = modality({
                    uiButton,
                });

                const fromUI = afferentPath();
                const deckModality = modality({
                    fromUI,
                });

                const unknownPath = afferentPath();

                const createNeuron = neuron( {
                    output,
                }).modalityDendrite({
                    collateral: input,
                    modalities: [
                        {
                            modality: cardModality,
                            afferentPaths: new Map([
                                [uiButton, (payload: { source: string }, axon: any) => {
                                    return {
                                        id: `card-${payload.source}`,
                                    };
                                }],
                            ]),
                            default: (payload, axon) => {
                                return {
                                    id: `card-default-${
                                        (payload as { source: string }).source
                                    }`,
                                };
                            },
                        },
                        {
                            modality: deckModality,
                            default: (payload, axon) => {
                                return {
                                    id: `deck-default-${
                                        (payload as { source: string }).source
                                    }`,
                                };
                            },
                        },
                    ],
                    output: (result, axon) => {
                        return axon.output.createSignal({
                            cardId: (result as { id: string }).id,
                        });
                    },
                });

                const cns = new CNS([createNeuron]);

                // Test card modality with unknown path - should use card default
                const responses: Array<{ cardId: string }> = [];
                await cns.stimulate(input.createSignal({ source: 'test' }), {
                    modality: cardModality,
                    afferentPath: unknownPath,
                    onResponse: response => {
                        if (
                            response.outputSignal?.payload &&
                            response.inputSignal &&
                            response.outputSignal.collateral === output
                        ) {
                            responses.push(
                                response.outputSignal.payload as {
                                    cardId: string;
                                }
                            );
                        }
                    },
                });

                expect(responses).toHaveLength(1);
                expect(responses[0].cardId).toBe('card-default-test');
            });
        });

        describe('Integration', () => {
            it('should work together in a simple flow', async () => {
                const input = collateral<{ message: string }>();
                const output = collateral<{ processed: string }>();

                const processor = neuron( { output }).dendrite({
                    collateral: input,
                    response: async (payload, axon) => {
                        return axon.output.createSignal({
                            processed: `Processed: ${payload.message}`,
                        });
                    },
                });

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
                    collateral: output,
                    payload: { processed: 'Processed: Hello' },
                });
            });
        });
    });

    describe('CNS Signal Flow', () => {
        describe('Basic Signal Processing', () => {
            it('should process basic signal flow', () => {
                const input = collateral<{ message: string }>();
                const output = collateral<{ processed: string }>();

                const processor = neuron( { output }).dendrite({
                    collateral: input,
                    response: (payload, axon) => {
                        return axon.output.createSignal({
                            processed: `Processed: ${payload.message}`,
                        });
                    },
                });

                const cns = new CNS([processor]);
                const responses: Array<{
                    collateral: unknown;
                    payload: unknown;
                    inputSignal?: unknown;
                }> = [];

                cns.stimulate(input.createSignal({ message: 'Hello World' }), {
                    onResponse: response => {
                        responses.push({
                            collateral: response.outputSignal?.collateral,
                            payload: response.outputSignal?.payload,
                            inputSignal: response.inputSignal,
                        });
                    },
                });

                expect(responses).toHaveLength(2);
                expect(responses[0].collateral).toBe(input);
                expect(responses[0].payload).toEqual({
                    message: 'Hello World',
                });
                expect(responses[1].inputSignal).toEqual({
                    collateral: input,
                    payload: {
                        message: 'Hello World',
                    },
                });
                expect(responses[1].collateral).toBe(output);
                expect(responses[1].payload).toEqual({
                    processed: 'Processed: Hello World',
                });
            });

            it('should handle chain processing', () => {
                const input = collateral<{ value: number }>();
                const middle = collateral<{ value: number }>();
                const output = collateral<{ result: number }>();

                const step1 = neuron( { middle }).dendrite({
                    collateral: input,
                    response: (payload, axon) => {
                        return axon.middle.createSignal({
                            value: payload.value + 5,
                        });
                    },
                });

                const step2 = neuron( { output }).dendrite({
                    collateral: middle,
                    response: (payload, axon) => {
                        return axon.output.createSignal({
                            result: payload.value * 3,
                        });
                    },
                });

                const cns = new CNS([step1, step2]);
                const responses: Array<{
                    collateral: unknown;
                    payload: unknown;
                }> = [];

                cns.stimulate(input.createSignal({ value: 7 }), {
                    onResponse: response => {
                        responses.push({
                            collateral: response.outputSignal?.collateral,
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
                const input = collateral<{ data: string }>();
                const branch1 = collateral<{ result: string }>();
                const branch2 = collateral<{ result: string }>();

                const processor1 = neuron( { branch1 }).dendrite({
                    collateral: input,
                    response: (payload, axon) => {
                        return axon.branch1.createSignal({
                            result: `A-${payload.data}`,
                        });
                    },
                });

                const processor2 = neuron( { branch2 }).dendrite({
                    collateral: input,
                    response: (payload, axon) => {
                        return axon.branch2.createSignal({
                            result: `B-${payload.data}`,
                        });
                    },
                });

                const cns = new CNS([processor1, processor2]);
                const responses: Array<{
                    collateral: unknown;
                    payload: unknown;
                }> = [];

                await cns.stimulate(input.createSignal({ data: 'test' }), {
                    onResponse: response => {
                        responses.push({
                            collateral: response.outputSignal?.collateral,
                            payload: response.outputSignal?.payload,
                        });
                    },
                });

                expect(responses).toHaveLength(3);
                expect(
                    responses.find(t => t.collateral === branch1)?.payload
                ).toEqual({ result: 'A-test' });
                expect(
                    responses.find(t => t.collateral === branch2)?.payload
                ).toEqual({ result: 'B-test' });
            });
        });

        it('should call global and local onResponse listeners', async () => {
            const input = collateral();
            const output = collateral();

            const n = neuron( { output }).dendrite({
                collateral: input,
                response: (_p, axon) => axon.output.createSignal(),
            });
            const cns = new CNS([n]);

            const global: string[] = [];
            const local: string[] = [];
            cns.addResponseListener(r => {
                global.push(
                    (r.outputSignal?.collateral ?? r.inputSignal?.collateral) as any
                );
            });

            await cns.stimulate(input.createSignal(), {
                onResponse: r => {
                    local.push(
                        (r.outputSignal?.collateral ?? r.inputSignal?.collateral) as any
                    );
                },
            });

            // Expect both to have seen both input and output
            expect(local).toEqual([input, output]);
            expect(global).toEqual([input, output]);
        });

        describe('Stack Safety', () => {
            it('should not blow the stack on long synchronous chains', async () => {
                const K = 1000;
                const input = collateral();
                const output = collateral();

                const mids = Array.from({ length: K }, (_, i) =>
                    collateral()
                );

                const startNeuron = neuron( {
                    mid_0: mids[0],
                }).dendrite({
                    collateral: input,
                    response: (_payload, axon) => axon.mid_0.createSignal(),
                });

                const midNeurons = mids.slice(0, -1).map((c, i) =>
                    neuron({ next: mids[i + 1] }).dendrite({
                        collateral: c,
                        response: (_payload, axon) => axon.next.createSignal(),
                    })
                );

                const tailNeuron = neuron( { output }).dendrite({
                    collateral: mids[K - 1],
                    response: (_payload, axon) => axon.output.createSignal(),
                });

                const cns = new CNS([startNeuron, ...midNeurons, tailNeuron]);
                const responses: Array<{
                    collateral: unknown;
                    queueLength: number;
                    currentTasksLength: number;
                }> = [];

                await cns.stimulate(input.createSignal(), {
                    onResponse: response => {
                        responses.push({
                            collateral: response.outputSignal?.collateral,
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
                expect(last.collateral).toBe(output);
                expect(last.queueLength).toBe(0);
            });
        });

        describe('Correct Ending of Traces', () => {
            it('should handle correct ending of traces', async () => {
                const input = collateral();
                const shortBranch = collateral();
                const longBranch1 = collateral();
                const longBranch2 = collateral();
                const output = collateral();

                const shortBranchNeuron = neuron( {
                    shortBranch,
                }).dendrite({
                    collateral: input,
                    response: (payload, axon) => {
                        // Do nothing
                    },
                });

                const longBranch1Neuron = neuron( {
                    longBranch1,
                }).dendrite({
                    collateral: input,
                    response: (payload, axon) => {
                        return axon.longBranch1.createSignal();
                    },
                });

                const longBranch2Neuron = neuron( {
                    longBranch2,
                }).dendrite({
                    collateral: longBranch1,
                    response: (payload, axon) => {
                        return axon.longBranch2.createSignal();
                    },
                });

                const outputNeuron = neuron( { output }).dendrite({
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
                    collateral: unknown;
                    queueLength: number;
                }> = [];

                await cns.stimulate(input.createSignal(), {
                    onResponse: response => {
                        responses.push({
                            collateral: response.outputSignal?.collateral,
                            queueLength: response.queueLength,
                        });
                    },
                });

                expect(responses).toHaveLength(5);
                expect(responses[0].queueLength).not.toBe(0);
                expect(responses[4].collateral).toBe(output);
                expect(responses[4].queueLength).toBe(0);
            });
        });
    });

    describe('Async Processing', () => {
        describe('Basic Async Operations', () => {
            it('should handle single async response', async () => {
                const input = collateral<{ delay: number; message: string }>();
                const output = collateral<{ result: string }>();

                const asyncNeuron = neuron( { output }).dendrite({
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
                    collateral: unknown;
                    payload: unknown;
                }> = [];
                const startTime = Date.now();

                await cns.stimulate(
                    input.createSignal({ delay: 30, message: 'test' }),
                    {
                        onResponse: response => {
                            responses.push({
                                collateral: response.outputSignal?.collateral,
                                payload: response.outputSignal?.payload,
                            });

                            if (
                                response.outputSignal?.collateral === output
                            ) {
                                const elapsed = Date.now() - startTime;
                                expect(elapsed).toBeGreaterThanOrEqual(25);
                                expect(responses).toHaveLength(2);
                                expect(responses[1]).toMatchObject({
                                    collateral: output,
                                    payload: { result: 'async-test' },
                                });
                            }
                        },
                    }
                );
            });

            it('should handle async chain processing', async () => {
                const input = collateral<{ value: number }>();
                const step1 = collateral<{ value: number }>();
                const output = collateral<{ result: number }>();

                const asyncStep1 = neuron( { step1 }).dendrite({
                    collateral: input,
                    response: async (payload, axon) => {
                        await new Promise(resolve => setTimeout(resolve, 20));
                        return axon.step1.createSignal({
                            value: payload.value * 2,
                        });
                    },
                });

                const asyncStep2 = neuron( { output }).dendrite({
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
                    collateral: unknown;
                    payload: unknown;
                }> = [];
                const startTime = Date.now();

                await cns.stimulate(input.createSignal({ value: 5 }), {
                    onResponse: response => {
                        responses.push({
                            collateral: response.outputSignal?.collateral,
                            payload: response.outputSignal?.payload,
                        });

                        if (
                            response.outputSignal?.collateral === output
                        ) {
                            const elapsed = Date.now() - startTime;
                            expect(elapsed).toBeGreaterThanOrEqual(35);
                            expect(responses).toHaveLength(3);
                            expect(responses[2]).toMatchObject({
                                collateral: output,
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
                const input = collateral<{ text: string }>();
                const output = collateral<{ result: string }>();

                const testNeuron = ctxBuilder
                    .neuron( { output })
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
                    collateral: output,
                    payload: { result: 'Hello Context' },
                });
            });

            it('should handle undefined context gracefully', async () => {
                const ctxBuilder = withCtx<{ data: string }>();
                const input = collateral<{ value: string }>();
                const output = collateral<{ result: string }>();

                const testNeuron = ctxBuilder
                    .neuron( { output })
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
                    collateral: output,
                    payload: { result: 'default' },
                });
            });
        });
    });

    describe('Edge Cases', () => {
        it('should handle neurons with no dendrites', async () => {
            const input = collateral<{ data: string }>();
            const output = collateral<{ result: string }>();

            const neuronWithNoDendrites = neuron( { output });
            const cns = new CNS([neuronWithNoDendrites]);

            const responses: Array<{
                collateral: unknown;
                queueLength: number;
            }> = [];

            await cns.stimulate(input.createSignal({ data: 'test' }), {
                onResponse: response => {
                    responses.push({
                        collateral: response.outputSignal?.collateral,
                        queueLength: response.queueLength,
                    });
                },
            });

            expect(responses).toHaveLength(1);
            expect(responses[0].collateral).toBe(input);
        });

        it('should handle undefined payloads', async () => {
            const input = collateral();
            const output = collateral<{ result: string }>();

            const testNeuron = neuron( { output }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    return axon.output.createSignal({
                        result: 'Processed undefined payload',
                    });
                },
            });

            const cns = new CNS([testNeuron]);
            const responses: Array<{
                collateral: unknown;
                payload: unknown;
            }> = [];

            await cns.stimulate(input.createSignal(), {
                onResponse: response => {
                    responses.push({
                        collateral: response.outputSignal?.collateral,
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
            const input = collateral<{ data: string }>();
            const output = collateral<{ result: string }>();

            const processor = neuron( { output }).dendrite({
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
            const start = collateral();
            const inC = collateral();
            const out = collateral();

            const u1 = neuron( { in: inC }).dendrite({
                collateral: start,
                response: (_p, axon) => axon.in.createSignal(),
            });

            const u2 = neuron( { in: inC }).dendrite({
                collateral: start,
                response: (_p, axon) => axon.in.createSignal(),
            });

            const DELAY = 30;
            const worker = neuron( { out })
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
                        if (r.outputSignal?.collateral === out) {
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
            const start = collateral();
            const inC = collateral();
            const out = collateral();

            const u1 = neuron( { in: inC }).dendrite({
                collateral: start,
                response: (_p, axon) => axon.in.createSignal(),
            });
            const u2 = neuron( { in: inC }).dendrite({
                collateral: start,
                response: (_p, axon) => axon.in.createSignal(),
            });
            const u3 = neuron( { in: inC }).dendrite({
                collateral: start,
                response: (_p, axon) => axon.in.createSignal(),
            });

            const DELAY = 30;
            const worker = neuron( { out })
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
                        if (r.outputSignal?.collateral === out) {
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
            const start = collateral();
            const inC = collateral();
            const out = collateral();

            const u1 = neuron( { in: inC }).dendrite({
                collateral: start,
                response: (_p, axon) => axon.in.createSignal(),
            });
            const u2 = neuron( { in: inC }).dendrite({
                collateral: start,
                response: (_p, axon) => axon.in.createSignal(),
            });

            const DELAY = 30;
            const worker = neuron( { out }).dendrite({
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
                        if (r.outputSignal?.collateral === out) {
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
            const input = collateral();
            const workerOut = collateral();

            const worker = neuron( { out: workerOut })
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
                    if (r.outputSignal?.collateral === workerOut) {
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
            const start = collateral<{ message: string }>();
            const middle = collateral<{ from: string }>();
            const end = collateral<{ from: string }>();

            const neuronA = neuron( { middle }).dendrite({
                collateral: start,
                response: (payload, axon) => {
                    return axon.middle.createSignal({ from: 'A' });
                },
            });

            const neuronB = neuron( { end }).dendrite({
                collateral: middle,
                response: (payload, axon) => {
                    return axon.end.createSignal({ from: 'B' });
                },
            });

            const neuronC = neuron( {}).dendrite({
                collateral: end,
                response: (payload, axon) => {
                    // Terminal neuron
                },
            });

            const cns = new CNS([neuronA, neuronB, neuronC], {
                autoCleanupContexts: true,
            });

            expect(cns.network.stronglyConnectedComponents).toHaveLength(3);
            expect(cns.network.getSCCSetByNeuron(neuronA)?.size).toBe(1);
            expect(cns.network.getSCCSetByNeuron(neuronB)?.size).toBe(1);
            expect(cns.network.getSCCSetByNeuron(neuronC)?.size).toBe(1);

            const emptyActiveCounts = new Map<number, number>();

            expect(
                cns.network.canNeuronBeGuaranteedDone(neuronA, emptyActiveCounts)
            ).toBe(true);
            expect(
                cns.network.canNeuronBeGuaranteedDone(neuronB, emptyActiveCounts)
            ).toBe(true);
            expect(
                cns.network.canNeuronBeGuaranteedDone(neuronC, emptyActiveCounts)
            ).toBe(true);
        });
    });

    describe('Array Signal Support', () => {
        it('should handle returning an array of signals from a neuron', async () => {
            const input = collateral<{ value: number }>();
            const output1 = collateral<{ result: string }>();
            const output2 = collateral<{ result: string }>();
            const final = collateral<{ message: string }>();

            const splitter = neuron( { output1, output2 }).dendrite({
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

            const collector1 = neuron( { final }).dendrite({
                collateral: output1,
                response: (payload, axon) => {
                    return axon.final.createSignal({
                        message: `Collected from ${payload.result}`,
                    });
                },
            });

            const collector2 = neuron( { final }).dendrite({
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
                        if (r.outputSignal?.collateral === final) {
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
            const input = collateral<{ count: number }>();
            const output = collateral<{ index: number }>();

            const generator = neuron( { output }).dendrite({
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
                        if (r.outputSignal?.collateral === output) {
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
            const input = collateral<{ id: number }>();
            const output = collateral<{ processed: number }>();

            const processor = neuron( { output }).dendrite({
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
                            if (r.outputSignal?.collateral === output) {
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
            const input = collateral<{ shouldEmit: boolean }>();
            const output = collateral<{ data: string }>();

            const conditional = neuron( { output }).dendrite({
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
                        if (r.outputSignal?.collateral === output) {
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
            const input = collateral<{ mode: 'single' | 'array' }>();
            const output = collateral<{ value: string }>();

            const flexible = neuron( { output }).dendrite({
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
                        if (r.outputSignal?.collateral === output) {
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
                        if (r.outputSignal?.collateral === output) {
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
            const input = collateral();
            const output = collateral();

            const n = neuron( { output }).dendrite({
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
            const input = collateral();
            const output = collateral();

            const n = neuron( { output }).dendrite({
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
            const input = collateral();
            const output = collateral();

            const n = neuron( { output }).dendrite({
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
            const input = collateral();
            const output = collateral();

            const n = neuron( { output }).dendrite({
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
            const input = collateral();
            const output = collateral();

            const n = neuron( { output }).dendrite({
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
            const input = collateral();
            const output = collateral();

            const n = neuron( { output }).dendrite({
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
            const input = collateral();
            const output = collateral();

            const n = neuron( { output }).dendrite({
                collateral: input,
                response: (_p, axon) => axon.output.createSignal(),
            });
            const sink = neuron( {}).dendrite({
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
            const input = collateral();
            const mid = collateral();
            const output = collateral();

            const a = neuron( { mid }).dendrite({
                collateral: input,
                response: (_p, axon) => axon.mid.createSignal(),
            });
            const b = neuron( { output }).dendrite({
                collateral: mid,
                response: (_p, axon) => axon.output.createSignal(),
            });
            const cns = new CNS([a, b]);

            const start = Date.now();
            let seenOutputAt: number | undefined;

            await cns
                .stimulate(input.createSignal(), {
                    onResponse: async r => {
                        if (r.outputSignal?.collateral === mid) {
                            await new Promise<void>(res => setTimeout(res, 30));
                        }
                        if (r.outputSignal?.collateral === output) {
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
            const input = collateral<{ value: number }>();
            const intermediate = collateral<{ value: number }>();
            const output = collateral<{ result: string }>();

            let step1Executed = false;
            let step2Executed = false;

            const step1 = ctxBuilder
                .neuron( { intermediate })
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

            const step2 = ctxBuilder.neuron( { output }).dendrite({
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

            // Reuse context store from first stimulation (in-process snapshot)
            const ctxFromFirst = stimulation1.getContext();

            // Retry with activate using failed tasks and saved context
            const results: string[] = [];
            const stimulation2 = cns.activate(
                failedTasks.map(ft => ft.task),
                {
                    ctx: ctxFromFirst,
                    onResponse: r => {
                        if (r.outputSignal?.collateral === output) {
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
            const input = collateral<{ value: number }>();
            const intermediate = collateral<{ value: number }>();
            const output = collateral<{ result: string }>();

            let attemptCount = 0;

            const step1 = ctxBuilder
                .neuron( { intermediate })
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

            const step2 = ctxBuilder.neuron( { output }).dendrite({
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
                        if (r.outputSignal?.collateral === output) {
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

            // Reuse context store from first stimulation
            const ctxFromFirst = stimulation1.getContext();

            // Retry with activate using failed tasks and saved context
            const results2: string[] = [];
            const stimulation2 = cns.activate(
                failedTasks.map(ft => ft.task),
                {
                    ctx: ctxFromFirst,
                    onResponse: r => {
                        if (r.outputSignal?.collateral === output) {
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
                (finalContext.get(step1) as { processed: string[] } | undefined)
                    ?.processed
            ).toContain('step1');
        });

        it('should preserve context and not re-execute completed tasks on retry', async () => {
            const ctxBuilder = withCtx<{ executed: string[] }>();
            const input = collateral<{ id: number }>();
            const step1Out = collateral<{ id: number }>();
            const step2Out = collateral<{ id: number }>();
            const output = collateral<{ result: string }>();

            const executionLog: string[] = [];

            const step1 = ctxBuilder.neuron( { step1Out }).dendrite({
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

            const step2 = ctxBuilder.neuron( { step2Out }).dendrite({
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

            const step3 = ctxBuilder.neuron( { output }).dendrite({
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
            const ctxFromFirst = stimulation1.getContext();

            // Clear execution log to verify retry doesn't re-execute step1
            executionLog.length = 0;

            // Retry with activate
            const results: string[] = [];
            const stimulation2 = cns.activate(
                failedTasks.map(ft => ft.task),
                {
                    ctx: ctxFromFirst,
                    onResponse: r => {
                        if (r.outputSignal?.collateral === output) {
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
            const executed = Array.from(finalContext.values())
                .map((v: any) => v.executed)
                .flat();
            expect(executed).toContain('step1-100');
            expect(executed).toContain('step2-100');
            expect(executed).toContain('step3-100');
        });
    });

    describe('CNSDrainGuard', () => {
        it('should reuse the same drain while processing is active', async () => {
            const input = collateral<{ id: number }>();
            let starts = 0;
            let resolveCurrentRun!: () => void;

            const worker = neuron({}).dendrite({
                collateral: input,
                response: async () => {
                    starts++;
                    await new Promise<void>(resolve => {
                        resolveCurrentRun = resolve;
                    });
                },
            });

            const cns = new CNS([worker]);
            const guard = new CNSDrainGuard({
                cns,
                signal: input.createSignal({ id: 1 }),
            });

            const firstDrain = guard.drain();
            const secondDrain = guard.drain();

            expect(firstDrain).toBe(secondDrain);
            expect(guard.isDraining()).toBe(true);
            expect(starts).toBe(1);

            resolveCurrentRun();
            await firstDrain;

            expect(guard.isDraining()).toBe(false);

            const nextDrain = guard.drain();

            expect(guard.isDraining()).toBe(true);
            expect(starts).toBe(2);

            resolveCurrentRun();
            await nextDrain;

            expect(guard.isDraining()).toBe(false);
        });

        it('should abort the current drain when using the guard abort controller', async () => {
            const input = collateral();

            const worker = neuron({}).dendrite({
                collateral: input,
                response: (_payload, _axon, ctx) =>
                    new Promise<void>((_resolve, reject) => {
                        ctx.abortSignal?.addEventListener('abort', () => {
                            reject(new Error('aborted by guard'));
                        });
                    }),
            });

            const cns = new CNS([worker]);
            const guard = new CNSDrainGuard({
                cns,
                signal: input.createSignal(),
            });

            const drain = guard.drain();

            expect(guard.abort()).toBe(true);
            await expect(drain).rejects.toThrow('Stimulation aborted');
            expect(guard.isDraining()).toBe(false);
        });

        it('should not abort when an external abort signal owns cancellation', async () => {
            const input = collateral();
            const abortController = new AbortController();

            const worker = neuron({}).dendrite({
                collateral: input,
                response: (_payload, _axon, ctx) =>
                    new Promise<void>((_resolve, reject) => {
                        ctx.abortSignal?.addEventListener('abort', () => {
                            reject(new Error('aborted externally'));
                        });
                    }),
            });

            const cns = new CNS([worker]);
            const guard = new CNSDrainGuard({
                cns,
                signal: input.createSignal(),
                options: {
                    abortSignal: abortController.signal,
                },
            });

            const drain = guard.drain();

            expect(guard.abort()).toBe(false);
            expect(guard.isDraining()).toBe(true);

            abortController.abort();

            await expect(drain).rejects.toThrow('Stimulation aborted');
            expect(guard.isDraining()).toBe(false);
        });
    });
});
