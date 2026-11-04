import { CNS } from '@cnstra/core';
import { OIMChannelService, OIMDB, OIMEffectService, OIM_SLICE_LENGTH_MS, createOIMEntityContentService, createOIMSingleSlotService } from '@oimdb/core';
import { CNS_HOMEOSTAT_REFETCH_SLICE_LENGTH_MS, CNSHomeostatReceptor, CNSHomeostatReceptorCorrection } from '@cnstra/sync';
import { cnsAt, cnsSettleMicrotasks, createCNSHomeostatTestDeckReceptor } from '../../../sync/src/tests/support/cnsHomeostatTestSupport';
import { createCNSOIMDBHomeostatEnvironment } from '../index';

describe('the OIMDB default scheduler after the derivation', () => {
    it('defers what a hundred queries ask for with one microtask outside a flush and one subscription inside it', async () => {
        const { requested, deckReceptor, cns } = createCNSHomeostatTestDeckReceptor();
        const db = new OIMDB();
        const settle = () => cnsSettleMicrotasks(() => db.flush());
        const homeostatEnvironment = createCNSOIMDBHomeostatEnvironment({ db, cns });
        const deckQueries = homeostatEnvironment.createComputedStoreAggregate(deckReceptor);
        const queueMicrotaskSpy = jest.spyOn(globalThis, 'queueMicrotask');
        const effects = [];
        for (let i = 0; i < 100; i++) {
            effects.push(OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => {
                void deckQueries.getSlotByKey([`d${i}`]).value;
            }));
        }
        expect(queueMicrotaskSpy).toHaveBeenCalledTimes(1);
        queueMicrotaskSpy.mockRestore();
        await settle();
        expect(requested).toHaveLength(100);
        for (let i = 0; i < 100; i++) homeostatEnvironment.invalidate(deckReceptor, [`d${i}`]);
        const subscribeAfterEachFlush = jest.spyOn(OIMChannelService.INSTANCE, 'subscribeAfterEachFlush');
        db.flush();
        expect(subscribeAfterEachFlush).toHaveBeenCalledTimes(1);
        subscribeAfterEachFlush.mockRestore();
        await settle();
        expect(requested).toHaveLength(200);
        for (const effect of effects) OIMEffectService.INSTANCE.disposeEffect(effect);
        await settle();
    });

    it('stops the refetch wheel and aborts the running request on dispose, before the db is disposed', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
        try {
            const server = { requested: [] as string[], hang: false, abortSignals: [] as AbortSignal[] };
            const deckReceptor = new CNSHomeostatReceptor<[deckId: string], { id: string }>({
                name: 'deck',
                staleTimeMs: 5_000,
                transduce: ([deckId], abortSignal) => {
                    server.requested.push(deckId);
                    server.abortSignals.push(abortSignal);
                    if (!server.hang) return Promise.resolve({ id: deckId });
                    return new Promise((_resolve, reject) => { abortSignal.addEventListener('abort', () => reject(abortSignal.reason)); });
                },
            });
            const cns = new CNS([deckReceptor.neuron, new CNSHomeostatReceptorCorrection({ homeostatReceptors: [deckReceptor] }).neuron]);
            const db = new OIMDB();
            const settle = () => cnsSettleMicrotasks(() => db.flush());
            const homeostatEnvironment = createCNSOIMDBHomeostatEnvironment({ db, cns });
            const deckQueries = homeostatEnvironment.createComputedStoreAggregate(deckReceptor);
            OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => { void deckQueries.getSlotByKey(['d1']).value; });
            await settle();
            expect(server.requested).toEqual(['d1']);
            server.hang = true;
            const invalidated = homeostatEnvironment.invalidate(deckReceptor, ['d1']);
            await settle();
            expect(server.requested).toEqual(['d1', 'd1']);
            expect(jest.getTimerCount()).toBeGreaterThan(0);
            const writeHomeostatCorrectionState = jest.spyOn(homeostatEnvironment.homeostatCorrectionRepositoryOf(deckReceptor), 'writeHomeostatCorrectionState');
            homeostatEnvironment.dispose();
            db.dispose();
            expect(cnsAt(server.abortSignals, 1).aborted).toBe(true);
            await expect(invalidated).resolves.toBeUndefined();
            await jest.advanceTimersByTimeAsync(10_000);
            await cnsSettleMicrotasks();
            expect(server.requested).toEqual(['d1', 'd1']);
            expect(writeHomeostatCorrectionState).not.toHaveBeenCalled();
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('the OIMDB refetch wheel', () => {
    it('slices refetches by the refetch slice of @cnstra/sync, which the MobX scheduler uses', () => {
        expect(OIM_SLICE_LENGTH_MS).toBe(CNS_HOMEOSTAT_REFETCH_SLICE_LENGTH_MS);
    });

    it('refetches a held query whose refetch fell due while nobody watched it, once it is watched again', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
        try {
            let nowMs = 1_000_000;
            const requested: string[] = [];
            const deckReceptor = new CNSHomeostatReceptor<[deckId: string], { id: string }>({
                name: 'deck',
                staleTimeMs: 5_000,
                transduce: ([deckId]) => {
                    requested.push(deckId);
                    return Promise.resolve({ id: deckId });
                },
            });
            const cns = new CNS([deckReceptor.neuron, new CNSHomeostatReceptorCorrection({ homeostatReceptors: [deckReceptor] }).neuron]);
            const db = new OIMDB({ getNowMs: () => nowMs });
            const settle = () => cnsSettleMicrotasks(() => db.flush());
            const advance = async (ms: number) => {
                nowMs += ms;
                await jest.advanceTimersByTimeAsync(ms);
                await settle();
            };
            const homeostatEnvironment = createCNSOIMDBHomeostatEnvironment({ db, cns });
            const deckQuery = homeostatEnvironment.createComputedStoreAggregate(deckReceptor).getSlotByKey(['d1']);
            deckQuery.holdSlot();
            const watchDeck = () => OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => { void deckQuery.value; });
            const hiddenDeck = watchDeck();
            await settle();
            expect(requested).toEqual(['d1']);
            OIMEffectService.INSTANCE.disposeEffect(hiddenDeck);
            await advance(5_000 + OIM_SLICE_LENGTH_MS * 2);
            expect(requested).toEqual(['d1']);
            const shownDeck = watchDeck();
            await settle();
            expect(requested).toEqual(['d1', 'd1']);
            await advance(5_000 + OIM_SLICE_LENGTH_MS * 2);
            expect(requested).toEqual(['d1', 'd1', 'd1']);
            OIMEffectService.INSTANCE.disposeEffect(shownDeck);
            deckQuery.unholdSlot();
            homeostatEnvironment.dispose();
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('the browser slots the firing policy reads', () => {
    it('are held by the environment, so a slot read with getSingleSlot survives the flushes before the first query', async () => {
        const { requested, deckReceptor, cns } = createCNSHomeostatTestDeckReceptor();
        const db = new OIMDB();
        const onlineService = createOIMSingleSlotService({ slotContentService: createOIMEntityContentService<{ isOnline: boolean }>() });
        const online = onlineService.createStoreSlot(db);
        onlineService.writeSingleSlotContent(online, { isOnline: true });
        const onlineSlot = onlineService.getSingleSlot(online);
        const homeostatEnvironment = createCNSOIMDBHomeostatEnvironment({ db, cns, onlineSlot });
        db.flush();
        db.flush();

        const deckQueries = homeostatEnvironment.createComputedStoreAggregate(deckReceptor);
        const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => {
            void deckQueries.getSlotByKey(['d1']).value;
        });
        await cnsSettleMicrotasks(() => db.flush());

        expect(requested).toEqual(['d1']);
        OIMEffectService.INSTANCE.disposeEffect(effect);
        const holdCountWhileHeld = onlineSlot.holdCount;
        homeostatEnvironment.dispose();
        homeostatEnvironment.dispose();
        expect(onlineSlot.holdCount).toBe(holdCountWhileHeld - 1);
    });
});
