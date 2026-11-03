import type { TCNSNeuron } from '@cnstra/types';
import { CNS, cnsNeuron } from '@cnstra/core';
import {
    CNS_HOMEOSTAT_REGULATOR_STIMULATION_CONTEXT_KEY,
    CNSHomeostatFiringContext,
    CNSHomeostatReceptor,
    CNSHomeostatReceptorCorrection,
    reduceCNSHomeostatCorrectionState,
    ECNSHomeostatCorrectionStatus,
} from '@cnstra/sync';
import type {
    CNSHomeostatEnvironment,
    ICNSHomeostatCorrectionRepository,
    ICNSHomeostatFiringPolicy,
    TCNSHomeostasisState,
    TCNSHomeostatEnvironmentFactoryOptions,
    TCNSHomeostatReceptorOptions,
} from '@cnstra/sync';
import { cnsAt } from '../support/cnsHomeostatTestSupport';

export type TCNSHomeostatConformanceDeck = { id: string; title: string };

export type TCNSHomeostatConformanceDeckKey = [deckId: string];

export type TCNSHomeostatConformanceWatch = {
    states: TCNSHomeostasisState<TCNSHomeostatConformanceDeckKey | undefined>[];
    frames: string[];
    dispose: () => void;
};

type TCNSHomeostatConformanceEnvironmentOverrides<TFiringPolicy extends ICNSHomeostatFiringPolicy, TCorrectionRepository extends ICNSHomeostatCorrectionRepository<readonly unknown[]>> =
    Omit<TCNSHomeostatEnvironmentFactoryOptions<TFiringPolicy, TCorrectionRepository>, 'cns'>;

type TCNSHomeostatConformanceDeckReceptor = CNSHomeostatReceptor<TCNSHomeostatConformanceDeckKey, TCNSHomeostatConformanceDeck>;

export type TCNSHomeostatConformanceEngine<
    TFiringPolicy extends ICNSHomeostatFiringPolicy,
    TCorrectionRepository extends ICNSHomeostatCorrectionRepository<readonly unknown[]>,
    TEnvironment extends CNSHomeostatEnvironment<TFiringPolicy, TCorrectionRepository>,
> = {
    createEnvironment(cns: CNS<TCNSNeuron<any>>, overrides: TCNSHomeostatConformanceEnvironmentOverrides<TFiringPolicy, TCorrectionRepository>): TEnvironment;
    writeDeck(deck: TCNSHomeostatConformanceDeck): void;
    watchDeck(environment: TEnvironment, homeostatReceptor: TCNSHomeostatConformanceDeckReceptor, deckId: string): TCNSHomeostatConformanceWatch;
    watchSelectedDeck(
        environment: TEnvironment,
        homeostatReceptor: TCNSHomeostatConformanceDeckReceptor,
        fetchDeck: (deckId: string, abortSignal: AbortSignal) => Promise<TCNSHomeostatConformanceDeck>
    ): TCNSHomeostatConformanceWatch;
    select(deckId: string | undefined): void;
    reselect(): void;
    setOnline(isOnline: boolean): void;
    setVisible(isVisible: boolean): void;
    invalidateInsideDerivation(environment: TEnvironment, homeostatReceptor: TCNSHomeostatConformanceDeckReceptor, deckId: string): void;
    createSignInFiringPolicy(): { homeostatFiringPolicy: TFiringPolicy; signIn: () => void };
    defaultHomeostatCorrectionRepository(): (homeostatReceptor: CNSHomeostatReceptor<never, unknown>) => TCorrectionRepository;
    keepingHomeostatCorrectionRepository(keepAfterUnholdMs: number): (homeostatReceptor: CNSHomeostatReceptor<never, unknown>) => TCorrectionRepository;
    wrapHomeostatCorrectionRepository(
        createHomeostatCorrectionRepository: (homeostatReceptor: CNSHomeostatReceptor<never, unknown>) => TCorrectionRepository,
        writtenStatuses: string[]
    ): (homeostatReceptor: CNSHomeostatReceptor<never, unknown>) => TCorrectionRepository;
    countRetained(environment: TEnvironment, homeostatReceptor: TCNSHomeostatConformanceDeckReceptor): number;
    settle(): Promise<void>;
    advance(ms: number): Promise<void>;
};

type TCNSHomeostatConformanceWorldOptions<
    TFiringPolicy extends ICNSHomeostatFiringPolicy,
    TCorrectionRepository extends ICNSHomeostatCorrectionRepository<readonly unknown[]>,
    TEnvironment extends CNSHomeostatEnvironment<TFiringPolicy, TCorrectionRepository>,
> = {
    deckReceptorOptions?: Pick<TCNSHomeostatReceptorOptions<TCNSHomeostatConformanceDeckKey, TCNSHomeostatConformanceDeck>, 'staleTimeMs' | 'homeostatRefractoryPolicy' | 'stimulationOptions'>;
    overrides?: (
        engine: TCNSHomeostatConformanceEngine<TFiringPolicy, TCorrectionRepository, TEnvironment>
    ) => TCNSHomeostatConformanceEnvironmentOverrides<TFiringPolicy, TCorrectionRepository>;
    reduceHomeostatCorrectionState?: typeof reduceCNSHomeostatCorrectionState;
};

const last = <T>(values: readonly T[]): T => {
    const value = values[values.length - 1];
    if (value === undefined) throw new Error('nothing was recorded');
    return value;
};

const runningFiringOf = (homeostasisState: TCNSHomeostasisState<TCNSHomeostatConformanceDeckKey | undefined> | undefined) => {
    const homeostatRunningFiring = homeostasisState?.homeostatRunningFiring;
    if (homeostatRunningFiring === undefined) throw new Error('the value carries no running request');
    return homeostatRunningFiring;
};

const useFakeTimers = () => jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });

export function cnsHomeostatConformance<
    TFiringPolicy extends ICNSHomeostatFiringPolicy,
    TCorrectionRepository extends ICNSHomeostatCorrectionRepository<readonly unknown[]>,
    TEnvironment extends CNSHomeostatEnvironment<TFiringPolicy, TCorrectionRepository>,
>(engineName: string, createEngine: () => TCNSHomeostatConformanceEngine<TFiringPolicy, TCorrectionRepository, TEnvironment>): void {
    const createWorld = (options: TCNSHomeostatConformanceWorldOptions<TFiringPolicy, TCorrectionRepository, TEnvironment> = {}) => {
        const engine = createEngine();
        const server = {
            requested: [] as string[],
            hang: false,
            failNext: 0,
            throwNext: false,
            answers: [] as (() => void)[],
            failures: [] as (() => void)[],
            titles: {} as Record<string, string>,
            abortSignals: [] as AbortSignal[],
            isWritingLater: false,
            writtenTitles: [] as string[],
        };
        const fetchDeck = (deckId: string, abortSignal: AbortSignal): Promise<TCNSHomeostatConformanceDeck> => {
            if (server.throwNext) {
                server.throwNext = false;
                throw new Error('bad key');
            }
            server.requested.push(deckId);
            server.abortSignals.push(abortSignal);
            if (server.failNext > 0) {
                server.failNext--;
                return Promise.reject(new Error('HTTP 503'));
            }
            if (!server.hang) return Promise.resolve({ id: deckId, title: server.titles[deckId] ?? `deck ${deckId}` });
            return new Promise((resolve, reject) => {
                server.answers.push(() => resolve({ id: deckId, title: server.titles[deckId] ?? `answer ${server.answers.length}` }));
                server.failures.push(() => reject(new Error('HTTP 503')));
                abortSignal.addEventListener('abort', () => reject(abortSignal.reason));
            });
        };
        const deckReceptor = new CNSHomeostatReceptor<TCNSHomeostatConformanceDeckKey, TCNSHomeostatConformanceDeck>({
            name: 'deck',
            transduce: ([deckId], abortSignal) => fetchDeck(deckId, abortSignal),
            ...options.deckReceptorOptions,
        });
        const cardReceptor = new CNSHomeostatReceptor<TCNSHomeostatConformanceDeckKey, TCNSHomeostatConformanceDeck>({ name: 'card', transduce: ([cardId], abortSignal) => fetchDeck(cardId, abortSignal) });
        const homeostatCorrection = new CNSHomeostatReceptorCorrection({
            homeostatReceptors: [deckReceptor, cardReceptor],
            reduceHomeostatCorrectionState: options.reduceHomeostatCorrectionState,
        });
        const signals: string[] = [];
        const stimulationContexts: unknown[] = [];
        const cardStimulationContexts: unknown[] = [];
        const toasts: string[] = [];
        const hooks = { onFired: [] as ((deckId: string) => void)[], onRestored: [] as ((deckId: string) => void)[] };
        const recorder = cnsNeuron({});
        for (const [collateralName, collateral] of Object.entries(deckReceptor.axon)) {
            recorder.dendrite({
                collateral,
                response: (_payload: unknown, _axon: unknown, ctx: { stimulationContext?: unknown }) => {
                    signals.push(collateralName);
                    stimulationContexts.push(ctx.stimulationContext);
                },
            });
        }
        for (const collateral of Object.values(cardReceptor.axon)) {
            recorder.dendrite({
                collateral,
                response: (_payload: unknown, _axon: unknown, ctx: { stimulationContext?: unknown }) => { cardStimulationContexts.push(ctx.stimulationContext); },
            });
        }
        const deckWriter = cnsNeuron({})
            .dendrite({
                collateral: deckReceptor.axon.homeostatFired,
                response: ({ key: [deckId] }) => { for (const onFired of hooks.onFired) onFired(deckId); },
            })
            .dendrite({
                collateral: deckReceptor.axon.homeostasisRestored,
                response: ({ key: [deckId], data }): Promise<void> | undefined => {
                    if (server.isWritingLater) {
                        return Promise.resolve().then(() => Promise.resolve()).then(() => {
                            engine.writeDeck(data);
                            server.writtenTitles.push(data.title);
                        });
                    }
                    engine.writeDeck(data);
                    server.writtenTitles.push(data.title);
                    for (const onRestored of hooks.onRestored) onRestored(deckId);
                    return undefined;
                },
            })
            .dendrite({
                collateral: deckReceptor.axon.homeostasisFailed,
                response: ({ key: [deckId], error }) => { toasts.push(`${deckId}: ${String(error)}`); },
            });
        const cns = new CNS([deckReceptor.neuron, cardReceptor.neuron, homeostatCorrection.neuron, deckWriter, recorder]);
        const environment = engine.createEnvironment(cns, options.overrides?.(engine) ?? {});
        const correctionOf = (homeostatReceptor: CNSHomeostatReceptor<never, unknown>, key: string, ofEnvironment = environment) =>
            ofEnvironment.homeostatCorrectionRepositoryOf(homeostatReceptor).peekHomeostatCorrectionState(ofEnvironment.homeostatEnvironmentOptions.keyHashFn([key]));
        return {
            engine, environment, cns, server, signals, stimulationContexts, cardStimulationContexts, toasts, hooks, deckReceptor, cardReceptor, fetchDeck, correctionOf,
            watchDeck: (deckId: string, ofEnvironment = environment) => engine.watchDeck(ofEnvironment, deckReceptor, deckId),
            watchCard: (cardId: string) => engine.watchDeck(environment, cardReceptor, cardId),
            watchSelectedDeck: () => engine.watchSelectedDeck(environment, deckReceptor, fetchDeck),
        };
    };

    describe(`homeostat queries on ${engineName}: use cases`, () => {
        it('shows loading, then the status and the data in one frame', async () => {
            const world = createWorld();
            world.server.hang = true;
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            expect(deck.frames).toEqual(['firing:-']);
            cnsAt(world.server.answers, 0)();
            await world.engine.settle();
            expect(deck.frames).toEqual(['firing:-', 'restored:answer 1']);
            expect(world.signals).toEqual(['homeostatFired', 'homeostasisRestored']);
            deck.dispose();
        });

        it('shows an error, tells a side-effect neuron, and retries after the refractory delay', async () => {
            useFakeTimers();
            try {
                const world = createWorld({ deckReceptorOptions: { homeostatRefractoryPolicy: { initialDelayMs: 2_000, multiplier: 2, maxDelayMs: 8_000 } } });
                world.server.failNext = 1;
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Failed, error: new Error('HTTP 503') });
                expect(world.toasts).toEqual(['d1: Error: HTTP 503']);
                await world.engine.advance(2_000);
                expect(world.server.requested).toEqual(['d1', 'd1']);
                expect(last(deck.frames)).toBe('restored:deck d1');
                deck.dispose();
            } finally {
                jest.useRealTimers();
            }
        });

        it('keeps the last error on the value while the failed key is asked again, and drops it on success', async () => {
            useFakeTimers();
            try {
                const world = createWorld({ deckReceptorOptions: { homeostatRefractoryPolicy: { initialDelayMs: 2_000, multiplier: 2, maxDelayMs: 8_000 } } });
                world.server.failNext = 1;
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                world.server.hang = true;
                await world.engine.advance(2_000);
                expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Firing, error: new Error('HTTP 503') });
                cnsAt(world.server.answers, 0)();
                await world.engine.settle();
                expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, error: undefined });
                deck.dispose();
            } finally {
                jest.useRealTimers();
            }
        });

        it('keeps the last error on a value paused offline', async () => {
            const world = createWorld({ overrides: engine => ({ createHomeostatCorrectionRepository: engine.keepingHomeostatCorrectionRepository(60_000) }) });
            world.server.failNext = 1;
            const first = world.watchDeck('d1');
            await world.engine.settle();
            first.dispose();
            await world.engine.settle();
            world.engine.setOnline(false);
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Paused, error: new Error('HTTP 503') });
            deck.dispose();
        });

        it('keeps the last error on a reader that joins the retry of a failed key', async () => {
            useFakeTimers();
            try {
                const world = createWorld({ deckReceptorOptions: { homeostatRefractoryPolicy: { initialDelayMs: 2_000, multiplier: 2, maxDelayMs: 8_000 } } });
                world.server.failNext = 1;
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                world.server.hang = true;
                await world.engine.advance(2_000);
                const joined = world.watchSelectedDeck();
                await world.engine.settle();
                expect(world.server.requested).toEqual(['d1', 'd1']);
                expect(last(joined.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Firing, error: new Error('HTTP 503') });
                deck.dispose();
                joined.dispose();
            } finally {
                jest.useRealTimers();
            }
        });

        it('fails a request whose transduce throws synchronously', async () => {
            const world = createWorld();
            world.server.throwNext = true;
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Failed, error: new Error('bad key') });
            deck.dispose();
        });

        it('refetches stale data while held, and not after the last reader left', async () => {
            useFakeTimers();
            try {
                const world = createWorld({ deckReceptorOptions: { staleTimeMs: 5_000 } });
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                await world.engine.advance(5_000);
                expect(world.server.requested).toEqual(['d1', 'd1']);
                deck.dispose();
                await world.engine.settle();
                await world.engine.advance(5_000);
                expect(world.server.requested).toEqual(['d1', 'd1']);
            } finally {
                jest.useRealTimers();
            }
        });

        describe('a record kept after its last reader left', () => {
            const createKeepingWorld = (keepAfterUnholdMs: number, staleTimeMs: number) => createWorld({
                deckReceptorOptions: { staleTimeMs },
                overrides: engine => ({ createHomeostatCorrectionRepository: engine.keepingHomeostatCorrectionRepository(keepAfterUnholdMs) }),
            });
            const leaveAndComeBack = async (world: ReturnType<typeof createKeepingWorld>, awayMs: number) => {
                const first = world.watchDeck('d1');
                await world.engine.settle();
                first.dispose();
                await world.engine.settle();
                await world.engine.advance(awayMs);
                return world.watchDeck('d1');
            };

            it('answers a reader that comes back while the record is kept and fresh without a request', async () => {
                useFakeTimers();
                try {
                    const world = createKeepingWorld(60_000, 30_000);
                    const deck = await leaveAndComeBack(world, 10_000);
                    await world.engine.settle();
                    expect(world.server.requested).toEqual(['d1']);
                    expect(deck.frames).toEqual(['restored:deck d1']);
                    deck.dispose();
                } finally {
                    jest.useRealTimers();
                }
            });

            it('asks again when the kept record went stale', async () => {
                useFakeTimers();
                try {
                    const world = createKeepingWorld(120_000, 10_000);
                    const deck = await leaveAndComeBack(world, 30_000);
                    await world.engine.settle();
                    expect(world.server.requested).toEqual(['d1', 'd1']);
                    deck.dispose();
                } finally {
                    jest.useRealTimers();
                }
            });

            it('asks again when the record was let go after the keep window', async () => {
                useFakeTimers();
                try {
                    const world = createKeepingWorld(10_000, 120_000);
                    const deck = await leaveAndComeBack(world, 30_000);
                    await world.engine.settle();
                    expect(world.server.requested).toEqual(['d1', 'd1']);
                    deck.dispose();
                } finally {
                    jest.useRealTimers();
                }
            });

            it('answers from the record while it is kept when the stale time is not set', async () => {
                useFakeTimers();
                try {
                    const world = createKeepingWorld(60_000, Infinity);
                    const deck = await leaveAndComeBack(world, 1_000);
                    await world.engine.settle();
                    expect(world.server.requested).toEqual(['d1']);
                    expect(deck.states[deck.states.length - 1]).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
                    deck.dispose();
                } finally {
                    jest.useRealTimers();
                }
            });

            it('asks a kept failed record again at once, before its refractory delay ends', async () => {
                useFakeTimers();
                try {
                    const world = createWorld({
                        deckReceptorOptions: { staleTimeMs: 30_000, homeostatRefractoryPolicy: { initialDelayMs: 60_000, multiplier: 2, maxDelayMs: 60_000 } },
                        overrides: engine => ({ createHomeostatCorrectionRepository: engine.keepingHomeostatCorrectionRepository(120_000) }),
                    });
                    world.server.failNext = 1;
                    const deck = await leaveAndComeBack(world, 1_000);
                    await world.engine.settle();
                    expect(world.server.requested).toEqual(['d1', 'd1']);
                    expect(last(deck.frames)).toBe('restored:deck d1');
                    deck.dispose();
                } finally {
                    jest.useRealTimers();
                }
            });

            it('shows a kept fresh record offline instead of pausing', async () => {
                useFakeTimers();
                try {
                    const world = createKeepingWorld(60_000, 30_000);
                    const first = world.watchDeck('d1');
                    await world.engine.settle();
                    first.dispose();
                    await world.engine.settle();
                    world.engine.setOnline(false);
                    const deck = world.watchDeck('d1');
                    await world.engine.settle();
                    expect(world.server.requested).toEqual(['d1']);
                    expect(deck.frames).toEqual(['restored:deck d1']);
                    deck.dispose();
                } finally {
                    jest.useRealTimers();
                }
            });

            it('asks again after invalidate on a kept key nobody holds', async () => {
                useFakeTimers();
                try {
                    const world = createKeepingWorld(60_000, 30_000);
                    const first = world.watchDeck('d1');
                    await world.engine.settle();
                    first.dispose();
                    await world.engine.settle();
                    await expect(world.environment.invalidate(world.deckReceptor, ['d1'])).resolves.toBeUndefined();
                    const deck = world.watchDeck('d1');
                    await world.engine.settle();
                    expect(world.server.requested).toEqual(['d1', 'd1']);
                    deck.dispose();
                } finally {
                    jest.useRealTimers();
                }
            });

            it('still asks again for a reader that comes back right away when nothing is kept', async () => {
                const world = createWorld({ deckReceptorOptions: { staleTimeMs: 30_000 } });
                const first = world.watchDeck('d1');
                await world.engine.settle();
                first.dispose();
                await world.engine.settle();
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                expect(world.server.requested).toEqual(['d1', 'd1']);
                deck.dispose();
            });

            it('moves a query to a kept fresh key without dropping the running request it shared', async () => {
                useFakeTimers();
                try {
                    const world = createKeepingWorld(60_000, 30_000);
                    const kept = world.watchDeck('d2');
                    await world.engine.settle();
                    kept.dispose();
                    await world.engine.settle();
                    world.server.hang = true;
                    world.engine.select('d1');
                    const deck = world.watchDeck('d1');
                    const selected = world.watchSelectedDeck();
                    await world.engine.settle();
                    expect(world.server.requested).toEqual(['d2', 'd1']);
                    world.engine.select('d2');
                    await world.engine.settle();
                    expect(last(selected.frames)).toBe('restored:deck d2');
                    expect(cnsAt(world.server.abortSignals, 1).aborted).toBe(false);
                    cnsAt(world.server.answers, 0)();
                    await world.engine.settle();
                    expect(last(deck.frames)).toBe('restored:answer 1');
                    deck.dispose();
                    selected.dispose();
                } finally {
                    jest.useRealTimers();
                }
            });

            it('keeps the record of a reader that came back within the window past the end of that window', async () => {
                useFakeTimers();
                try {
                    const world = createKeepingWorld(60_000, 1_000_000);
                    const deck = await leaveAndComeBack(world, 10_000);
                    await world.engine.settle();
                    await world.engine.advance(70_000);
                    expect(world.correctionOf(world.deckReceptor, 'd1')).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
                    expect(world.server.requested).toEqual(['d1']);
                    deck.dispose();
                } finally {
                    jest.useRealTimers();
                }
            });

            it('keeps the record of a reader that came back in the same tick when nothing is kept', async () => {
                const world = createWorld({ deckReceptorOptions: { staleTimeMs: 30_000 } });
                const first = world.watchDeck('d1');
                await world.engine.settle();
                first.dispose();
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                expect(world.correctionOf(world.deckReceptor, 'd1')).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
                deck.dispose();
            });

            it('keeps the record for the whole window after the reader that came back leaves again', async () => {
                useFakeTimers();
                try {
                    const world = createKeepingWorld(60_000, 1_000_000);
                    const second = await leaveAndComeBack(world, 10_000);
                    await world.engine.settle();
                    await world.engine.advance(10_000);
                    second.dispose();
                    await world.engine.settle();
                    await world.engine.advance(45_000);
                    const deck = world.watchDeck('d1');
                    await world.engine.settle();
                    expect(world.server.requested).toEqual(['d1']);
                    deck.dispose();
                } finally {
                    jest.useRealTimers();
                }
            });

            it('does not ask again for a reader that joins a held key while its answer is fresh', async () => {
                const world = createWorld({ deckReceptorOptions: { staleTimeMs: 30_000 } });
                const first = world.watchDeck('d1');
                await world.engine.settle();
                const second = world.watchSelectedDeck();
                await world.engine.settle();
                expect(second.states[second.states.length - 1]).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
                first.dispose();
                second.dispose();
                expect(world.server.requested).toEqual(['d1']);
            });

            it('two environments on one repository: the record stays while the other one still holds the key', async () => {
                const world = createWorld({ deckReceptorOptions: { staleTimeMs: 30_000 } });
                const sharedHomeostatCorrectionRepository = world.environment.homeostatCorrectionRepositoryOf(world.deckReceptor);
                const otherEnvironment = world.engine.createEnvironment(world.cns, { createHomeostatCorrectionRepository: () => sharedHomeostatCorrectionRepository });
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                const otherDeck = world.watchDeck('d1', otherEnvironment);
                await world.engine.settle();
                otherDeck.dispose();
                await world.engine.settle();
                expect(world.correctionOf(world.deckReceptor, 'd1')).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
                deck.dispose();
            });

            it('lets the kept record go after the keep window', async () => {
                useFakeTimers();
                try {
                    const world = createKeepingWorld(10_000, 30_000);
                    const first = world.watchDeck('d1');
                    await world.engine.settle();
                    first.dispose();
                    await world.engine.settle();
                    expect(world.correctionOf(world.deckReceptor, 'd1')).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
                    await world.engine.advance(20_000);
                    expect(world.correctionOf(world.deckReceptor, 'd1')).toBeUndefined();
                } finally {
                    jest.useRealTimers();
                }
            });
        });

        it('runs one request for readers of one key, keeps the record for a reader that joined, and clears it after the last one', async () => {
            const world = createWorld();
            const first = world.watchDeck('d1');
            const second = world.watchSelectedDeck();
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1']);
            first.dispose();
            await world.engine.settle();
            expect(world.correctionOf(world.deckReceptor, 'd1')).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
            world.environment.invalidate(world.deckReceptor, ['d1']);
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1', 'd1']);
            second.dispose();
            await world.engine.settle();
            expect(world.correctionOf(world.deckReceptor, 'd1')).toBeUndefined();
        });

        it('aborts a shared request only when its last reader leaves, and ignores the late answer', async () => {
            const world = createWorld();
            world.server.hang = true;
            const first = world.watchDeck('d1');
            const second = world.watchSelectedDeck();
            await world.engine.settle();
            first.dispose();
            await world.engine.settle();
            expect(world.signals).toEqual(['homeostatFired']);
            second.dispose();
            await world.engine.settle();
            expect(world.signals).toEqual(['homeostatFired', 'homeostasisCancelled']);
            expect(world.correctionOf(world.deckReceptor, 'd1')).toBeUndefined();
        });

        it('answers another query of the key that comes after the answer from the record when the stale time is not set', async () => {
            const world = createWorld();
            const first = world.watchDeck('d1');
            await world.engine.settle();
            world.server.titles.d1 = 'newer';
            const second = world.watchSelectedDeck();
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1']);
            expect(last(first.frames)).toBe('restored:deck d1');
            expect(last(second.frames)).toBe('restored:deck d1');
            first.dispose();
            second.dispose();
        });

        it('settles a reader that mounts while the answer is being written', async () => {
            const world = createWorld();
            let mounted: TCNSHomeostatConformanceWatch | undefined;
            world.hooks.onRestored.push(() => { mounted ??= world.watchSelectedDeck(); });
            const first = world.watchDeck('d1');
            await world.engine.settle();
            const mountedWatch = mounted;
            if (mountedWatch === undefined) throw new Error('the reader did not mount');
            expect(last(mountedWatch.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
            expect(last(first.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
            first.dispose();
            mountedWatch.dispose();
        });

        it('a new reader after the last one left asks again', async () => {
            const world = createWorld();
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            deck.dispose();
            await world.engine.settle();
            const again = world.watchDeck('d1');
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1', 'd1']);
            again.dispose();
        });

        it('lets the key go when its dependency goes: aborts the running request and clears the record', async () => {
            const world = createWorld();
            world.server.hang = true;
            const selected = world.watchSelectedDeck();
            await world.engine.settle();
            expect(last(selected.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Firing, key: ['d1'] });
            world.engine.select(undefined);
            await world.engine.settle();
            expect(last(selected.states)).toEqual({ key: undefined, status: ECNSHomeostatCorrectionStatus.Idle, firingNumber: 0, error: undefined, homeostatRunningFiring: undefined });
            expect(world.signals).toEqual(['homeostatFired', 'homeostasisCancelled']);
            expect(world.correctionOf(world.deckReceptor, 'd1')).toBeUndefined();
            await expect(world.environment.invalidate(world.deckReceptor, ['d1'])).resolves.toBeUndefined();
            selected.dispose();
        });

        it('waits idle for its dependency, follows it, and aborts the request of the old value', async () => {
            const world = createWorld();
            world.engine.select(undefined);
            world.server.hang = true;
            const selected = world.watchSelectedDeck();
            await world.engine.settle();
            expect(last(selected.states)).toEqual({ key: undefined, status: ECNSHomeostatCorrectionStatus.Idle, firingNumber: 0, error: undefined, homeostatRunningFiring: undefined });
            expect(world.signals).toEqual([]);
            world.engine.select('d1');
            await world.engine.settle();
            world.engine.select('d2');
            await world.engine.settle();
            cnsAt(world.server.answers, 1)();
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1', 'd2']);
            expect(world.signals).toContain('homeostasisCancelled');
            expect(last(selected.states)).toMatchObject({ key: ['d2'], status: ECNSHomeostatCorrectionStatus.Restored });
            selected.dispose();
        });

        it('keeps one running request when what it read changes but the key stays', async () => {
            const world = createWorld();
            world.server.hang = true;
            const selected = world.watchSelectedDeck();
            await world.engine.settle();
            world.engine.reselect();
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1']);
            expect(cnsAt(world.server.abortSignals, 0).aborted).toBe(false);
            cnsAt(world.server.answers, 0)();
            await world.engine.settle();
            expect(world.signals).toEqual(['homeostatFired', 'homeostasisRestored']);
            expect(last(selected.states)).toMatchObject({ key: ['d1'], status: ECNSHomeostatCorrectionStatus.Restored });
            selected.dispose();
        });

        it('waits for the refractory delay of a failed key when what it read changes but the key stays', async () => {
            useFakeTimers();
            try {
                const world = createWorld({ deckReceptorOptions: { homeostatRefractoryPolicy: { initialDelayMs: 2_000, multiplier: 2, maxDelayMs: 8_000 } } });
                world.server.failNext = 1;
                const selected = world.watchSelectedDeck();
                await world.engine.settle();
                world.engine.reselect();
                await world.engine.settle();
                expect(world.server.requested).toEqual(['d1']);
                await world.engine.advance(2_000);
                expect(world.server.requested).toEqual(['d1', 'd1']);
                expect(last(selected.states)).toMatchObject({ key: ['d1'], status: ECNSHomeostatCorrectionStatus.Restored });
                selected.dispose();
            } finally {
                jest.useRealTimers();
            }
        });

        it('asks a failed key again once when what it read changes but the key stays', async () => {
            const world = createWorld();
            world.server.failNext = 1;
            const selected = world.watchSelectedDeck();
            await world.engine.settle();
            expect(last(selected.states)).toMatchObject({ key: ['d1'], status: ECNSHomeostatCorrectionStatus.Failed });
            world.engine.reselect();
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1', 'd1']);
            expect(last(selected.states)).toMatchObject({ key: ['d1'], status: ECNSHomeostatCorrectionStatus.Restored });
            selected.dispose();
        });

        it('lets a dendrite on homeostatFired write the state manager when the query is read inside a derivation', async () => {
            const world = createWorld();
            world.hooks.onFired.push(deckId => world.engine.writeDeck({ id: `fired ${deckId}`, title: 'fired' }));
            const selected = world.watchSelectedDeck();
            await world.engine.settle();
            world.engine.select('d2');
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1', 'd2']);
            expect(last(selected.states)).toMatchObject({ key: ['d2'], status: ECNSHomeostatCorrectionStatus.Restored });
            selected.dispose();
        });

        it('pauses offline, lets a running request finish, and resumes when the network comes back', async () => {
            const world = createWorld();
            world.server.hang = true;
            const running = world.watchDeck('d1');
            await world.engine.settle();
            world.engine.setOnline(false);
            cnsAt(world.server.answers, 0)();
            await world.engine.settle();
            expect(last(running.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
            world.server.hang = false;
            const paused = world.watchDeck('d2');
            await world.engine.settle();
            expect(last(paused.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Paused });
            world.engine.setOnline(true);
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1', 'd2']);
            expect(last(paused.frames)).toBe('restored:deck d2');
            running.dispose();
            paused.dispose();
        });

        it('keeps stale data offline and refetches it when the network comes back', async () => {
            useFakeTimers();
            try {
                const world = createWorld({ deckReceptorOptions: { staleTimeMs: 5_000 } });
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                world.engine.setOnline(false);
                await world.engine.advance(5_000);
                expect(world.server.requested).toEqual(['d1']);
                expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
                world.engine.setOnline(true);
                await world.engine.settle();
                expect(world.server.requested).toEqual(['d1', 'd1']);
                deck.dispose();
            } finally {
                jest.useRealTimers();
            }
        });

        it('fires a first read while hidden but waits with stale data until the document is visible', async () => {
            useFakeTimers();
            try {
                const world = createWorld({ deckReceptorOptions: { staleTimeMs: 5_000 } });
                world.engine.setVisible(false);
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                expect(world.server.requested).toEqual(['d1']);
                await world.engine.advance(5_000);
                expect(world.server.requested).toEqual(['d1']);
                world.engine.setVisible(true);
                await world.engine.settle();
                expect(world.server.requested).toEqual(['d1', 'd1']);
                deck.dispose();
            } finally {
                jest.useRealTimers();
            }
        });

        it('refreshes an invalidated key in a hidden tab and resolves the invalidate, then waits with stale data again', async () => {
            useFakeTimers();
            try {
                const world = createWorld({ deckReceptorOptions: { staleTimeMs: 5_000 } });
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                world.engine.setVisible(false);
                await world.engine.settle();
                world.server.titles.d1 = 'saved';
                const refreshed = world.environment.invalidate(world.deckReceptor, ['d1']);
                await world.engine.settle();
                await expect(refreshed).resolves.toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
                expect(world.server.requested).toEqual(['d1', 'd1']);
                expect(last(deck.frames)).toBe('restored:saved');
                await world.engine.advance(5_000);
                expect(world.server.requested).toEqual(['d1', 'd1']);
                deck.dispose();
            } finally {
                jest.useRealTimers();
            }
        });

        describe('a tab that comes back while its refetch timer is late', () => {
            const createLateTimerWorld = () => {
                const clock = { nowMs: 1_000_000 };
                const world = createWorld({
                    deckReceptorOptions: { staleTimeMs: 30_000 },
                    overrides: () => ({ getNowMs: () => clock.nowMs, scheduleRefetchAt: () => undefined }),
                });
                return { world, clock };
            };

            it('asks an overdue key again once when the tab becomes visible', async () => {
                const { world, clock } = createLateTimerWorld();
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                world.engine.setVisible(false);
                await world.engine.settle();
                clock.nowMs += 60_000;
                world.engine.setVisible(true);
                await world.engine.settle();
                expect(world.server.requested).toEqual(['d1', 'd1']);
                expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
                world.engine.setVisible(false);
                await world.engine.settle();
                world.engine.setVisible(true);
                await world.engine.settle();
                expect(world.server.requested).toEqual(['d1', 'd1']);
                deck.dispose();
            });

            it('does not ask a fresh key again when the tab becomes visible', async () => {
                const { world, clock } = createLateTimerWorld();
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                world.engine.setVisible(false);
                await world.engine.settle();
                clock.nowMs += 10_000;
                world.engine.setVisible(true);
                await world.engine.settle();
                expect(world.server.requested).toEqual(['d1']);
                expect(last(deck.frames)).toBe('restored:deck d1');
                deck.dispose();
            });
        });

        it('drops a record written into a key nobody holds', async () => {
            const world = createWorld();
            world.environment.homeostatCorrectionRepositoryOf(world.deckReceptor).writeHomeostatCorrectionState(world.environment.homeostatEnvironmentOptions.keyHashFn(['d1']), {
                receptorName: 'deck', key: ['d1'], status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 1,
                attempt: 0, startedAtMs: 0, restoredAtMs: 0, failedAtMs: undefined, error: undefined, invalidationNumber: 0,
            });
            await world.engine.settle();
            expect(world.correctionOf(world.deckReceptor, 'd1')).toBeUndefined();
        });

        it('refreshes after a write, also when the write lands while the request runs', async () => {
            const world = createWorld();
            world.server.hang = true;
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            world.server.titles.d1 = 'before the write';
            world.environment.invalidate(world.deckReceptor, ['d1']);
            cnsAt(world.server.answers, 0)();
            await world.engine.settle();
            world.server.titles.d1 = 'after the write';
            cnsAt(world.server.answers, 1)();
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1', 'd1']);
            expect(last(deck.frames)).toBe('restored:after the write');
            deck.dispose();
        });

        it('asks again at once when a request invalidated while it ran fails, and waits the doubled refractory delay after that one fails too', async () => {
            useFakeTimers();
            try {
                const world = createWorld({ deckReceptorOptions: { homeostatRefractoryPolicy: { initialDelayMs: 10_000, multiplier: 2, maxDelayMs: 80_000 } } });
                world.server.hang = true;
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                world.environment.invalidate(world.deckReceptor, ['d1']);
                cnsAt(world.server.failures, 0)();
                await world.engine.settle();
                expect(world.server.requested).toEqual(['d1', 'd1']);
                cnsAt(world.server.failures, 1)();
                await world.engine.settle();
                expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Failed, firingNumber: 2 });
                expect(world.server.requested).toEqual(['d1', 'd1']);
                world.server.hang = false;
                await world.engine.advance(12_000);
                expect(world.server.requested).toEqual(['d1', 'd1']);
                await world.engine.advance(10_000);
                expect(world.server.requested).toEqual(['d1', 'd1', 'd1']);
                deck.dispose();
            } finally {
                jest.useRealTimers();
            }
        });

        it('takes an invalidate called from inside a derivation', async () => {
            const world = createWorld();
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            world.engine.invalidateInsideDerivation(world.environment, world.deckReceptor, 'd1');
            await world.engine.settle();
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1', 'd1']);
            deck.dispose();
        });

        it('keeps two receptors apart for the same key', async () => {
            const world = createWorld();
            world.server.hang = true;
            const deck = world.watchDeck('k1');
            const card = world.watchCard('k1');
            await world.engine.settle();
            cnsAt(world.server.answers, 1)();
            await world.engine.settle();
            expect(last(card.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
            expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Firing });
            deck.dispose();
            card.dispose();
        });

        it('keeps two environments apart: each has its own records and requests', async () => {
            const world = createWorld();
            const otherEnvironment = world.engine.createEnvironment(world.cns, {});
            const deck = world.watchDeck('d1');
            const otherDeck = world.watchDeck('d1', otherEnvironment);
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1', 'd1']);
            deck.dispose();
            await world.engine.settle();
            expect(world.correctionOf(world.deckReceptor, 'd1')).toBeUndefined();
            expect(world.correctionOf(world.deckReceptor, 'd1', otherEnvironment)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
            otherDeck.dispose();
        });

        it('two environments on one repository: an answer to a request the other one started before an invalidate is not taken as fresh', async () => {
            const world = createWorld();
            const sharedHomeostatCorrectionRepository = world.environment.homeostatCorrectionRepositoryOf(world.deckReceptor);
            const otherEnvironment = world.engine.createEnvironment(world.cns, { createHomeostatCorrectionRepository: () => sharedHomeostatCorrectionRepository });
            world.server.hang = true;
            const deck = world.watchDeck('d1');
            const otherDeck = world.watchDeck('d1', otherEnvironment);
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1', 'd1']);
            world.server.titles.d1 = 'before the save';
            const invalidated = world.environment.invalidate(world.deckReceptor, ['d1']);
            await world.engine.settle();
            cnsAt(world.server.answers, 1)();
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1', 'd1', 'd1', 'd1']);
            world.server.titles.d1 = 'after the save';
            for (const answer of world.server.answers.slice(2)) answer();
            await world.engine.settle();
            await expect(invalidated).resolves.toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 2 });
            expect(last(deck.frames)).toBe('restored:after the save');
            expect(last(otherDeck.frames)).toBe('restored:after the save');
            deck.dispose();
            otherDeck.dispose();
        });

        it('writes nothing for an answer that comes without a query, as a resumed run does', async () => {
            const world = createWorld();
            world.cns.stimulate(world.deckReceptor.axon.homeostasisRestored.createSignal({ key: ['d1'], firingNumber: 9, data: { id: 'd1', title: 'resumed' } }));
            await world.engine.settle();
            expect(world.correctionOf(world.deckReceptor, 'd1')).toBeUndefined();
        });

        it('does not let an older answer overwrite a newer record', async () => {
            const world = createWorld();
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            world.cns.stimulate(world.deckReceptor.axon.homeostasisFailed.createSignal({ key: ['d1'], firingNumber: 0, error: new Error('late') }), {
                stimulationContext: {
                    [CNS_HOMEOSTAT_REGULATOR_STIMULATION_CONTEXT_KEY]: new CNSHomeostatFiringContext(
                        world.environment.homeostatCorrectionRepositoryOf(world.deckReceptor), world.environment.homeostatEnvironmentOptions.keyHashFn(['d1']), 0, 0, () => 0
                    ),
                },
            });
            await world.engine.settle();
            expect(world.correctionOf(world.deckReceptor, 'd1')).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 1 });
            deck.dispose();
        });

        it('fires past a higher firing number of a stale record that a shared or persisted repository leaves', async () => {
            const world = createWorld({ overrides: engine => ({ createHomeostatCorrectionRepository: engine.keepingHomeostatCorrectionRepository(60_000) }) });
            world.environment.homeostatCorrectionRepositoryOf(world.deckReceptor).writeHomeostatCorrectionState(world.environment.homeostatEnvironmentOptions.keyHashFn(['d1']), {
                receptorName: 'deck', key: ['d1'], status: ECNSHomeostatCorrectionStatus.Stale, firingNumber: 1_000,
                attempt: 0, startedAtMs: 0, restoredAtMs: 0, failedAtMs: undefined, error: undefined, invalidationNumber: 0,
            });
            await world.engine.settle();
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1']);
            expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 1_001 });
            deck.dispose();
        });

        it('answers from a restored record that a shared or persisted repository leaves when the stale time is not set', async () => {
            const world = createWorld({ overrides: engine => ({ createHomeostatCorrectionRepository: engine.keepingHomeostatCorrectionRepository(60_000) }) });
            world.environment.homeostatCorrectionRepositoryOf(world.deckReceptor).writeHomeostatCorrectionState(world.environment.homeostatEnvironmentOptions.keyHashFn(['d1']), {
                receptorName: 'deck', key: ['d1'], status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 1_000,
                attempt: 0, startedAtMs: 0, restoredAtMs: 0, failedAtMs: undefined, error: undefined, invalidationNumber: 0,
            });
            await world.engine.settle();
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            expect(world.server.requested).toEqual([]);
            expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 1_000 });
            deck.dispose();
        });

        it('fires again when a running request is overtaken by a newer stale record', async () => {
            const world = createWorld();
            world.server.hang = true;
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            world.server.hang = false;
            world.environment.homeostatCorrectionRepositoryOf(world.deckReceptor).writeHomeostatCorrectionState(world.environment.homeostatEnvironmentOptions.keyHashFn(['d1']), {
                receptorName: 'deck', key: ['d1'], status: ECNSHomeostatCorrectionStatus.Stale, firingNumber: 1_000,
                attempt: 0, startedAtMs: 0, restoredAtMs: 0, failedAtMs: undefined, error: undefined, invalidationNumber: 0,
            });
            await world.engine.settle();
            cnsAt(world.server.answers, 0)();
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1', 'd1']);
            expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 1_001 });
            deck.dispose();
        });

        it('carries the running request in a firing value, and waits on it until the answer and its writes have landed', async () => {
            const world = createWorld();
            world.server.hang = true;
            const restored: string[] = [];
            world.hooks.onRestored.push(deckId => { restored.push(deckId); });
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            const joined = world.watchSelectedDeck();
            await world.engine.settle();
            const firing = last(deck.states);
            expect(firing).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Firing, firingNumber: 1 });
            expect(last(joined.states).homeostatRunningFiring).toBe(firing.homeostatRunningFiring);
            const settled = runningFiringOf(firing).waitUntilSettled();
            expect(runningFiringOf(firing).waitUntilSettled()).toBe(settled);
            cnsAt(world.server.answers, 0)();
            expect(await settled).toEqual({ key: ['d1'], status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 1, error: undefined, homeostatRunningFiring: undefined });
            expect(restored).toEqual(['d1']);
            await world.engine.settle();
            expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, homeostatRunningFiring: undefined });
            deck.dispose();
            joined.dispose();
        });

        it('waits on a request that already failed: resolves with the failed value', async () => {
            const world = createWorld();
            world.server.failNext = 1;
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            const firing = deck.states.find(homeostasisState => homeostasisState.status === ECNSHomeostatCorrectionStatus.Firing);
            await expect(runningFiringOf(firing).waitUntilSettled())
                .resolves.toMatchObject({ status: ECNSHomeostatCorrectionStatus.Failed, firingNumber: 1, error: new Error('HTTP 503') });
            deck.dispose();
        });

        it('rejects the wait with the abort reason when the last reader leaves before the answer', async () => {
            const world = createWorld();
            world.server.hang = true;
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            const settled = runningFiringOf(last(deck.states)).waitUntilSettled();
            deck.dispose();
            await world.engine.settle();
            await expect(settled).rejects.toMatchObject({ name: 'AbortError' });
            await expect(runningFiringOf(last(deck.states)).waitUntilSettled()).rejects.toMatchObject({ name: 'AbortError' });
        });

        it('rejects the wait when a neuron on the answer throws', async () => {
            const world = createWorld();
            world.server.hang = true;
            world.hooks.onRestored.push(() => { throw new Error('domain write failed'); });
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            const settled = runningFiringOf(last(deck.states)).waitUntilSettled();
            cnsAt(world.server.answers, 0)();
            await expect(settled).rejects.toBeInstanceOf(Error);
            await world.engine.settle();
            await world.engine.settle();
            expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Failed, firingNumber: 1 });
            deck.dispose();
        });

        it('fails the key when a writer on the answer throws: tells the failure and asks again after the refractory delay', async () => {
            useFakeTimers();
            try {
                const world = createWorld({ deckReceptorOptions: { homeostatRefractoryPolicy: { initialDelayMs: 2_000, multiplier: 2, maxDelayMs: 8_000 } } });
                let isWriteFailing = true;
                world.hooks.onRestored.push(() => { if (isWriteFailing) throw new Error('domain write failed'); });
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                await world.engine.settle();
                expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Failed, firingNumber: 1, error: expect.any(Error) });
                expect(world.correctionOf(world.deckReceptor, 'd1')).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Failed, firingNumber: 1, attempt: 1 });
                expect(world.signals).toEqual(['homeostatFired', 'homeostasisRestored', 'homeostasisFailed']);
                expect(world.toasts).toHaveLength(1);
                isWriteFailing = false;
                await world.engine.advance(2_000);
                expect(world.server.requested).toEqual(['d1', 'd1']);
                expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 2, error: undefined });
                deck.dispose();
            } finally {
                jest.useRealTimers();
            }
        });

        it('does not abort a request that has its answer when its last reader settles and leaves', async () => {
            const world = createWorld();
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            deck.dispose();
            await world.engine.settle();
            expect(cnsAt(world.server.abortSignals, 0).aborted).toBe(false);
            expect(world.signals).toEqual(['homeostatFired', 'homeostasisRestored']);
        });

        it('marks the record stale at each invalidate while a request runs, and writes the answer of that request as stale', async () => {
            const writtenStatuses: string[] = [];
            const world = createWorld({
                overrides: engine => ({
                    createHomeostatCorrectionRepository: engine.wrapHomeostatCorrectionRepository(engine.defaultHomeostatCorrectionRepository(), writtenStatuses),
                }),
            });
            const first = world.watchDeck('d1');
            await world.engine.settle();
            world.server.hang = true;
            world.environment.invalidate(world.deckReceptor, ['d1']);
            await world.engine.settle();
            const second = world.watchSelectedDeck();
            world.environment.invalidate(world.deckReceptor, ['d1']);
            await world.engine.settle();
            expect(writtenStatuses).toEqual(['restored', 'stale', 'stale']);
            expect(world.server.requested).toEqual(['d1', 'd1']);
            cnsAt(world.server.answers, 0)();
            await world.engine.settle();
            cnsAt(world.server.answers, 1)();
            await world.engine.settle();
            expect(writtenStatuses).toEqual(['restored', 'stale', 'stale', 'stale', 'restored']);
            expect(world.server.requested).toEqual(['d1', 'd1', 'd1']);
            expect(world.server.writtenTitles).toHaveLength(2);
            first.dispose();
            second.dispose();
        });

        it('keeps an invalidate made while a request runs when the query that started it leaves before its answer', async () => {
            const world = createWorld();
            const first = world.watchDeck('d1');
            await world.engine.settle();
            world.server.hang = true;
            world.environment.invalidate(world.deckReceptor, ['d1']);
            await world.engine.settle();
            const second = world.watchSelectedDeck();
            await world.engine.settle();
            world.environment.invalidate(world.deckReceptor, ['d1']);
            first.dispose();
            await world.engine.settle();
            world.server.titles.d1 = 'before the write';
            cnsAt(world.server.answers, 0)();
            await world.engine.settle();
            world.server.titles.d1 = 'after the write';
            cnsAt(world.server.answers, 1)();
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1', 'd1', 'd1']);
            expect(last(second.frames)).toBe('restored:after the write');
            second.dispose();
        });

        it('refetches after the first answer when the invalidate came before any record existed', async () => {
            const world = createWorld();
            world.server.hang = true;
            const first = world.watchDeck('d1');
            await world.engine.settle();
            world.environment.invalidate(world.deckReceptor, ['d1']);
            await world.engine.settle();
            world.server.titles.d1 = 'before the write';
            cnsAt(world.server.answers, 0)();
            await world.engine.settle();
            world.server.titles.d1 = 'after the write';
            cnsAt(world.server.answers, 1)();
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1', 'd1']);
            expect(last(first.frames)).toBe('restored:after the write');
            first.dispose();
        });

        it('resolves an invalidate made while a request runs with the answer of the request started after it', async () => {
            const world = createWorld();
            world.server.hang = true;
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            let refreshed: TCNSHomeostasisState<TCNSHomeostatConformanceDeckKey> | undefined;
            const invalidated = world.environment.invalidate(world.deckReceptor, ['d1']).then(homeostasisState => { refreshed = homeostasisState; });
            world.server.titles.d1 = 'before the save';
            cnsAt(world.server.answers, 0)();
            await world.engine.settle();
            expect(refreshed).toBeUndefined();
            world.server.titles.d1 = 'after the save';
            cnsAt(world.server.answers, 1)();
            await world.engine.settle();
            await invalidated;
            expect(refreshed).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 2 });
            expect(world.server.writtenTitles).toEqual(['after the save']);
            deck.dispose();
        });

        it('does not deliver an answer to a request that started before the last invalidate: cancels it, keeps the record stale and asks again at once', async () => {
            const world = createWorld();
            world.server.hang = true;
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            const settled = runningFiringOf(last(deck.states)).waitUntilSettled();
            const invalidated = world.environment.invalidate(world.deckReceptor, ['d1']);
            world.server.titles.d1 = 'before the save';
            cnsAt(world.server.answers, 0)();
            await world.engine.settle();
            expect(world.signals).toEqual(['homeostatFired', 'homeostasisDisturbed', 'homeostasisDisturbed', 'homeostasisCancelled', 'homeostatFired']);
            expect(world.server.writtenTitles).toEqual([]);
            expect(world.correctionOf(world.deckReceptor, 'd1')).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Stale, firingNumber: 1, invalidationNumber: 1 });
            expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Firing, firingNumber: 2 });
            await expect(settled).rejects.toMatchObject({ name: 'AbortError' });
            world.server.titles.d1 = 'after the save';
            cnsAt(world.server.answers, 1)();
            await world.engine.settle();
            await expect(invalidated).resolves.toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 2 });
            expect(world.server.writtenTitles).toEqual(['after the save']);
            expect(last(deck.frames)).toBe('restored:after the save');
            deck.dispose();
        });

        it('resolves every invalidate of a storm with the first answer delivered after the last one', async () => {
            const world = createWorld();
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            world.server.hang = true;
            const invalidations = [world.environment.invalidate(world.deckReceptor, ['d1'])];
            await world.engine.settle();
            invalidations.push(world.environment.invalidate(world.deckReceptor, ['d1']));
            cnsAt(world.server.answers, 0)();
            await world.engine.settle();
            invalidations.push(world.environment.invalidate(world.deckReceptor, ['d1']));
            cnsAt(world.server.answers, 1)();
            await world.engine.settle();
            cnsAt(world.server.answers, 2)();
            await world.engine.settle();
            const settledByInvalidation = { status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 4 };
            await expect(Promise.all(invalidations)).resolves.toMatchObject([settledByInvalidation, settledByInvalidation, settledByInvalidation]);
            expect(world.server.requested).toEqual(['d1', 'd1', 'd1', 'd1']);
            expect(world.server.writtenTitles).toEqual(['deck d1', 'answer 3']);
            deck.dispose();
        });

        it('resolves an invalidate once a domain writer that writes later has written', async () => {
            const world = createWorld();
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            world.server.isWritingLater = true;
            world.server.titles.d1 = 'saved';
            const invalidated = world.environment.invalidate(world.deckReceptor, ['d1']);
            await world.engine.settle();
            await world.engine.settle();
            const refreshed = await invalidated;
            expect(refreshed).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 2 });
            expect(last(world.server.writtenTitles)).toBe('saved');
            deck.dispose();
        });

        it('a retry: invalidate a failed key and wait until it is restored', async () => {
            const world = createWorld();
            world.server.failNext = 1;
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Failed });
            const invalidated = world.environment.invalidate(world.deckReceptor, ['d1']);
            await world.engine.settle();
            await expect(invalidated).resolves.toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 2 });
            expect(last(deck.frames)).toBe('restored:deck d1');
            deck.dispose();
        });

        it('resolves an invalidate of a key no query holds at once with nothing, and requests nothing', async () => {
            const world = createWorld();
            await expect(world.environment.invalidate(world.deckReceptor, ['d1'])).resolves.toBeUndefined();
            expect(world.server.requested).toEqual([]);
        });

        it('resolves an invalidate with the failure when the refresh fails', async () => {
            const world = createWorld();
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            world.server.failNext = 1;
            const invalidated = world.environment.invalidate(world.deckReceptor, ['d1']);
            await world.engine.settle();
            await expect(invalidated).resolves.toMatchObject({ status: ECNSHomeostatCorrectionStatus.Failed, error: new Error('HTTP 503') });
            deck.dispose();
        });

        it('waits with an invalidate made offline until the network comes back and the refresh answers', async () => {
            const world = createWorld();
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            world.engine.setOnline(false);
            let refreshed: TCNSHomeostasisState<TCNSHomeostatConformanceDeckKey> | undefined;
            const invalidated = world.environment.invalidate(world.deckReceptor, ['d1']).then(homeostasisState => { refreshed = homeostasisState; });
            await world.engine.settle();
            expect(refreshed).toBeUndefined();
            expect(world.server.requested).toEqual(['d1']);
            world.engine.setOnline(true);
            await world.engine.settle();
            await invalidated;
            expect(refreshed).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 2 });
            deck.dispose();
        });

        it('rejects an invalidate when a dendrite on the answer of the refresh fails', async () => {
            const world = createWorld();
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            world.hooks.onRestored.push(() => { throw new Error('domain write failed'); });
            const invalidated = world.environment.invalidate(world.deckReceptor, ['d1']);
            await world.engine.settle();
            await expect(invalidated).rejects.toBeInstanceOf(Error);
            await world.engine.settle();
            await world.engine.settle();
            expect(world.correctionOf(world.deckReceptor, 'd1')).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Failed, firingNumber: 2 });
            deck.dispose();
        });

        it('resolves an invalidate with nothing when the last reader leaves before the refresh answers', async () => {
            const world = createWorld();
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            world.server.hang = true;
            const invalidated = world.environment.invalidate(world.deckReceptor, ['d1']);
            await world.engine.settle();
            deck.dispose();
            await expect(invalidated).resolves.toBeUndefined();
        });

        it('invalidates by a key prefix of the whole key as invalidate does, and by a prefix no held key has with nothing', async () => {
            const world = createWorld();
            const decks = [world.watchDeck('d1'), world.watchDeck('d2')];
            await world.engine.settle();
            const invalidated = world.environment.invalidateByKeyPrefix(world.deckReceptor, ['d1']);
            await world.engine.settle();
            await expect(invalidated).resolves.toMatchObject([{ key: ['d1'], status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 3 }]);
            expect(world.server.requested).toEqual(['d1', 'd2', 'd1']);
            await expect(world.environment.invalidateByKeyPrefix(world.deckReceptor, ['d9'])).resolves.toEqual([]);
            expect(world.server.requested).toEqual(['d1', 'd2', 'd1']);
            for (const deck of decks) deck.dispose();
        });

        it('invalidates by an empty key prefix every key the queries hold, resolves with the value of each, and leaves a kept record nobody holds', async () => {
            const world = createWorld({ overrides: engine => ({ createHomeostatCorrectionRepository: engine.keepingHomeostatCorrectionRepository(60_000) }) });
            const left = world.watchDeck('d3');
            await world.engine.settle();
            left.dispose();
            await world.engine.settle();
            const decks = [world.watchDeck('d1'), world.watchDeck('d2')];
            await world.engine.settle();
            const invalidated = world.environment.invalidateByKeyPrefix(world.deckReceptor, []);
            await world.engine.settle();
            await expect(invalidated).resolves.toMatchObject([
                { key: ['d1'], status: ECNSHomeostatCorrectionStatus.Restored },
                { key: ['d2'], status: ECNSHomeostatCorrectionStatus.Restored },
            ]);
            expect(world.server.requested).toEqual(['d3', 'd1', 'd2', 'd1', 'd2']);
            expect(world.correctionOf(world.deckReceptor, 'd3')).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, invalidationNumber: 0 });
            for (const deck of decks) deck.dispose();
        });

        it('invalidates by a key prefix the held keys whose leading parts are the prefix, and leaves the others', async () => {
            const world = createWorld();
            const pageReceptor = new CNSHomeostatReceptor<[deckId: string, page: number], TCNSHomeostatConformanceDeck>({
                name: 'page',
                transduce: ([deckId, page], abortSignal) => world.fetchDeck(`${deckId}:${page}`, abortSignal),
            });
            const pageEnvironment = world.engine.createEnvironment(
                new CNS([pageReceptor.neuron, new CNSHomeostatReceptorCorrection({ homeostatReceptors: [pageReceptor] }).neuron]),
                { createHomeostatCorrectionRepository: world.engine.keepingHomeostatCorrectionRepository(60_000) }
            );
            const pageRegulator = pageEnvironment.homeostatRegulatorOf(pageReceptor);
            const pageCorrectionRepository = pageEnvironment.homeostatCorrectionRepositoryOf(pageReceptor);
            const pageCorrectionOf = (key: readonly unknown[]) => pageCorrectionRepository.peekHomeostatCorrectionState(pageEnvironment.homeostatEnvironmentOptions.keyHashFn(key));
            const pageKeys: [deckId: string, page: number][] = [['d1', 1], ['d1', 2], ['d2', 1]];
            const pages = pageKeys.map(key => {
                const homeostasisQuery = pageRegulator.createHomeostasisQuery();
                const homeostatSource = pageRegulator.createHomeostatSource(key);
                return {
                    key,
                    read: () => pageRegulator.regulate(homeostasisQuery, homeostatSource, pageCorrectionOf(key)),
                    release: () => pageRegulator.release(homeostasisQuery),
                };
            });
            for (const page of pages) page.read();
            await world.engine.settle();
            for (const page of pages) page.read();
            expect(world.server.requested).toEqual(['d1:1', 'd1:2', 'd2:1']);
            const invalidated = pageEnvironment.invalidateByKeyPrefix(pageReceptor, ['d1']);
            await world.engine.settle();
            expect(pages.map(page => pageCorrectionOf(page.key)?.status)).toEqual([
                ECNSHomeostatCorrectionStatus.Stale, ECNSHomeostatCorrectionStatus.Stale, ECNSHomeostatCorrectionStatus.Restored,
            ]);
            for (const page of pages) page.read();
            await world.engine.settle();
            await expect(invalidated).resolves.toMatchObject([
                { key: ['d1', 1], status: ECNSHomeostatCorrectionStatus.Restored },
                { key: ['d1', 2], status: ECNSHomeostatCorrectionStatus.Restored },
            ]);
            expect(world.server.requested).toEqual(['d1:1', 'd1:2', 'd2:1', 'd1:1', 'd1:2']);
            for (const page of pages) page.release();
        });

        it('retains nothing after a hundred keys were read and let go', async () => {
            useFakeTimers();
            try {
                const world = createWorld({ deckReceptorOptions: { staleTimeMs: 60_000 } });
                const decks: TCNSHomeostatConformanceWatch[] = [];
                for (let i = 0; i < 100; i++) decks.push(world.watchDeck(`d${i}`));
                await world.engine.settle();
                expect(world.engine.countRetained(world.environment, world.deckReceptor)).toBeGreaterThan(0);
                for (const deck of decks) deck.dispose();
                await world.engine.settle();
                for (let i = 0; i < 100; i++) expect(world.correctionOf(world.deckReceptor, `d${i}`)).toBeUndefined();
                expect(world.engine.countRetained(world.environment, world.deckReceptor)).toBe(0);
                for (let i = 0; i < 100; i++) await expect(world.environment.invalidate(world.deckReceptor, [`d${i}`])).resolves.toBeUndefined();
                expect(world.server.requested).toHaveLength(100);
            } finally {
                jest.useRealTimers();
            }
        });
    });

    describe(`homeostat queries on ${engineName}: every part replaced`, () => {
        it('a firing policy of its own: waits for sign-in instead of the network', async () => {
            let signIn = (): void => undefined;
            const world = createWorld({
                overrides: engine => {
                    const signInFiringPolicy = engine.createSignInFiringPolicy();
                    signIn = signInFiringPolicy.signIn;
                    return { homeostatFiringPolicy: signInFiringPolicy.homeostatFiringPolicy };
                },
            });
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Paused });
            signIn();
            await world.engine.settle();
            expect(last(deck.frames)).toBe('restored:deck d1');
            deck.dispose();
        });

        it('a refetch policy of its own: poll every second regardless of the receptor', async () => {
            useFakeTimers();
            try {
                const world = createWorld({ overrides: () => ({ createHomeostatRefetchPolicy: () => ({ refetchAtMs: homeostatCorrectionState => (homeostatCorrectionState.restoredAtMs ?? Infinity) + 1_000 }) }) });
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                await world.engine.advance(1_000);
                await world.engine.advance(1_000);
                expect(world.server.requested).toEqual(['d1', 'd1', 'd1']);
                deck.dispose();
            } finally {
                jest.useRealTimers();
            }
        });

        it('a repository of its own: every write goes through it and the queries stay correct', async () => {
            const writtenStatuses: string[] = [];
            const world = createWorld({
                overrides: engine => ({
                    createHomeostatCorrectionRepository: engine.wrapHomeostatCorrectionRepository(engine.defaultHomeostatCorrectionRepository(), writtenStatuses),
                }),
            });
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            world.environment.invalidate(world.deckReceptor, ['d1']);
            await world.engine.settle();
            expect(writtenStatuses).toEqual(['restored', 'stale', 'restored']);
            expect(last(deck.frames)).toBe('restored:deck d1');
            deck.dispose();
        });

        it('a key identity of its own, also with a repository of its own: keys that differ in case share one request and one record', async () => {
            const writtenStatuses: string[] = [];
            const world = createWorld({
                overrides: engine => ({
                    keyHashFn: key => JSON.stringify(key).toLowerCase(),
                    createHomeostatCorrectionRepository: engine.wrapHomeostatCorrectionRepository(engine.defaultHomeostatCorrectionRepository(), writtenStatuses),
                }),
            });
            const lower = world.watchDeck('d1');
            const upper = world.watchDeck('D1');
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1']);
            expect(last(upper.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
            expect(writtenStatuses).toEqual(['restored']);
            lower.dispose();
            upper.dispose();
        });

        it('a key identity of its own: invalidate by a key prefix compares the prefix by it', async () => {
            const world = createWorld({
                overrides: engine => ({
                    keyHashFn: key => JSON.stringify(key).toLowerCase(),
                    createHomeostatCorrectionRepository: engine.wrapHomeostatCorrectionRepository(engine.defaultHomeostatCorrectionRepository(), []),
                }),
            });
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            const invalidated = world.environment.invalidateByKeyPrefix(world.deckReceptor, ['D1']);
            await world.engine.settle();
            await expect(invalidated).resolves.toMatchObject([{ key: ['d1'], status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 2 }]);
            expect(world.server.requested).toEqual(['d1', 'd1']);
            deck.dispose();
        });

        it('a refetch scheduler of its own: stale data is refetched when the scheduler says so', async () => {
            const due: (() => void)[] = [];
            const clock = { nowMs: 1_000 };
            const world = createWorld({
                deckReceptorOptions: { staleTimeMs: 1 },
                overrides: () => ({
                    getNowMs: () => clock.nowMs,
                    scheduleRefetchAt: (_homeostatCorrectionRepository, _keyHash, _refetchAtMs, refetch) => { due.push(refetch); },
                }),
            });
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1']);
            clock.nowMs += 1;
            due.shift()!();
            await world.engine.settle();
            expect(world.server.requested).toEqual(['d1', 'd1']);
            deck.dispose();
        });

        it('a clock of its own: the record carries its times', async () => {
            const world = createWorld({ overrides: () => ({ getNowMs: () => 42 }) });
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            expect(world.correctionOf(world.deckReceptor, 'd1')).toMatchObject({ startedAtMs: 42, restoredAtMs: 42 });
            deck.dispose();
        });

        it('a scheduler after the derivation of its own: nothing is fired until it runs', async () => {
            const queued: (() => void)[] = [];
            const world = createWorld({ overrides: () => ({ runUntracked: run => { queued.push(run); } }) });
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            expect(world.server.requested).toEqual([]);
            while (queued.length !== 0) {
                queued.shift()!();
                await world.engine.settle();
            }
            expect(world.server.requested).toEqual(['d1']);
            expect(last(deck.frames)).toBe('restored:deck d1');
            deck.dispose();
        });

        it('a transaction and a write of its own: the answer still lands in one frame and invalidate still works', async () => {
            const calls = { runInTransaction: 0, runWrite: 0 };
            const world = createWorld({
                overrides: engine => {
                    const defaults = engine.createEnvironment(new CNS([]), {}).homeostatEnvironmentOptions;
                    return {
                        runInTransaction: run => {
                            calls.runInTransaction++;
                            return defaults.runInTransaction(run);
                        },
                        runWrite: write => { calls.runWrite++; defaults.runWrite(write); },
                    };
                },
            });
            world.server.hang = true;
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            cnsAt(world.server.answers, 0)();
            await world.engine.settle();
            expect(deck.frames).toEqual(['firing:-', 'restored:answer 1']);
            world.server.hang = false;
            world.environment.invalidate(world.deckReceptor, ['d1']);
            await world.engine.settle();
            expect(calls.runInTransaction).toBeGreaterThan(0);
            expect(calls.runWrite).toBe(1);
            expect(world.server.requested).toEqual(['d1', 'd1']);
            deck.dispose();
        });

        it('a regulator of its own: the environment builds every regulator through it', async () => {
            const built: string[] = [];
            const world = createWorld({
                overrides: engine => {
                    const defaults = engine.createEnvironment(new CNS([]), {}).homeostatEnvironmentOptions;
                    return {
                        createHomeostatRegulator: regulatorOptions => {
                            built.push(regulatorOptions.homeostatReceptor.name);
                            return defaults.createHomeostatRegulator(regulatorOptions);
                        },
                    };
                },
            });
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            expect(built).toEqual(['deck']);
            expect(last(deck.frames)).toBe('restored:deck d1');
            deck.dispose();
        });

        it('a correction reducer of its own: the correction neuron writes what it returns', async () => {
            const world = createWorld({
                reduceHomeostatCorrectionState: (homeostatCorrectionState, homeostatOutcome) => {
                    const reduced = reduceCNSHomeostatCorrectionState(homeostatCorrectionState, homeostatOutcome);
                    return reduced === undefined || reduced.error === undefined ? reduced : { ...reduced, error: 'the server is down' };
                },
            });
            world.server.failNext = 1;
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Failed, error: 'the server is down' });
            deck.dispose();
        });

        it('stimulation options of the environment and of the receptor reach every signal, contexts merged', async () => {
            const world = createWorld({
                deckReceptorOptions: { stimulationOptions: { stimulationContext: { receptor: 'deck' } } },
                overrides: () => ({ stimulationOptions: { stimulationContext: { screen: 'decks' } } }),
            });
            const deck = world.watchDeck('d1');
            await world.engine.settle();
            expect(world.stimulationContexts).toHaveLength(2);
            for (const stimulationContext of world.stimulationContexts) expect(stimulationContext).toMatchObject({ receptor: 'deck', screen: 'decks' });
            deck.dispose();
        });

        it('stimulation options of its own per receptor: every signal of that receptor gets them, and the other receptor\'s signals do not', async () => {
            const world = createWorld({
                overrides: () => ({
                    stimulationOptionsOf: homeostatReceptor => homeostatReceptor.name === 'deck' ? { stimulationContext: { tenant: 'acme' } } : undefined,
                }),
            });
            const deck = world.watchDeck('d1');
            const card = world.watchCard('c1');
            await world.engine.settle();
            expect(world.stimulationContexts).toHaveLength(2);
            for (const stimulationContext of world.stimulationContexts) expect(stimulationContext).toMatchObject({ tenant: 'acme' });
            expect(world.cardStimulationContexts).toHaveLength(2);
            for (const stimulationContext of world.cardStimulationContexts) expect(stimulationContext).not.toHaveProperty('tenant');
            expect(world.correctionOf(world.cardReceptor, 'c1')).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
            deck.dispose();
            card.dispose();
        });

        it('defaults of the environment apply to receptors that do not set them: stale time and refractory delay', async () => {
            useFakeTimers();
            try {
                const world = createWorld({ overrides: () => ({ staleTimeMs: 3_000, homeostatRefractoryPolicy: { initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 4_000 } }) });
                world.server.failNext = 1;
                const deck = world.watchDeck('d1');
                await world.engine.settle();
                expect(last(deck.states)).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Failed });
                await world.engine.advance(1_000);
                expect(world.server.requested).toEqual(['d1', 'd1']);
                await world.engine.advance(3_000);
                expect(world.server.requested).toEqual(['d1', 'd1', 'd1']);
                deck.dispose();
            } finally {
                jest.useRealTimers();
            }
        });
    });
}
