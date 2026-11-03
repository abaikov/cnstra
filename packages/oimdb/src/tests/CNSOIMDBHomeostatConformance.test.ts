import {
    createOIMSingleSlotService,
    createOIMSlotCollectionService,
    createOIMEntityContentService,
    OIM_SLICE_LENGTH_MS,
    OIMDB,
    OIMEffectService,
    OIMSlotAfterUnholdReleasePolicy,
} from '@oimdb/core';
import type { TCNSHomeostasisState } from '@cnstra/sync';
import { cnsHomeostatConformance } from '../../../sync/src/tests/conformance/cnsHomeostatConformance';
import type {
    TCNSHomeostatConformanceDeck as TDeck,
    TCNSHomeostatConformanceDeckKey as TDeckKey,
    TCNSHomeostatConformanceEngine,
    TCNSHomeostatConformanceWatch,
} from '../../../sync/src/tests/conformance/cnsHomeostatConformance';
import { CNSOIMDBHomeostatCorrectionRepository, createCNSOIMDBHomeostatCorrectionStoreSlot, createCNSOIMDBHomeostatEnvironment } from '../index';
import type { CNSOIMDBHomeostatEnvironment, ICNSOIMDBHomeostatCorrectionRepository, ICNSOIMDBHomeostatFiringPolicy, TCNSOIMDBHomeostasisComputedStoreAggregate } from '../index';
import { cnsSettleMicrotasks } from '../../../sync/src/tests/support/cnsHomeostatTestSupport';


cnsHomeostatConformance('OIMDB', (): TCNSHomeostatConformanceEngine<ICNSOIMDBHomeostatFiringPolicy, ICNSOIMDBHomeostatCorrectionRepository, CNSOIMDBHomeostatEnvironment> => {
    let nowMs = 1_000_000;
    const db = new OIMDB({ getNowMs: () => nowMs });
    const onlineService = createOIMSingleSlotService({ slotContentService: createOIMEntityContentService<{ isOnline: boolean }>() });
    const online = onlineService.createStoreSlot(db);
    onlineService.writeSingleSlotContent(online, { isOnline: true });
    const visibilityService = createOIMSingleSlotService({ slotContentService: createOIMEntityContentService<{ isVisible: boolean }>() });
    const visibility = visibilityService.createStoreSlot(db);
    visibilityService.writeSingleSlotContent(visibility, { isVisible: true });
    const triggerService = createOIMSingleSlotService({ slotContentService: createOIMEntityContentService<{ count: number }>() });
    const trigger = triggerService.createStoreSlot(db);
    triggerService.writeSingleSlotContent(trigger, { count: 0 });
    const deckService = createOIMSlotCollectionService({ slotContentService: createOIMEntityContentService<TDeck, string>() });
    const decks = deckService.createStoreSlot(db);
    const selectionService = createOIMSlotCollectionService({ slotContentService: createOIMEntityContentService<{ deckId: string; selectionCount?: number }, string>() });
    const selection = selectionService.createStoreSlot(db);
    selectionService.writeSlotContentByKey(selection, 'current', { deckId: 'd1' });
    db.flush();
    const settle = () => cnsSettleMicrotasks(() => db.flush());
    const deckQueriesList: TCNSOIMDBHomeostasisComputedStoreAggregate<TDeckKey>[] = [];
    const homeostatCorrectionRepositories: CNSOIMDBHomeostatCorrectionRepository[] = [];
    const createHomeostatCorrectionRepository = () => {
        const homeostatCorrectionRepository = new CNSOIMDBHomeostatCorrectionRepository(createCNSOIMDBHomeostatCorrectionStoreSlot(db));
        homeostatCorrectionRepositories.push(homeostatCorrectionRepository);
        return homeostatCorrectionRepository;
    };
    const keepingHomeostatCorrectionRepository = (keepAfterUnholdMs: number) => () => {
        const homeostatCorrectionRepository = new CNSOIMDBHomeostatCorrectionRepository(createCNSOIMDBHomeostatCorrectionStoreSlot(db, {
            slotReleasePolicy: new OIMSlotAfterUnholdReleasePolicy({ keepAfterUnholdMs }),
        }));
        homeostatCorrectionRepositories.push(homeostatCorrectionRepository);
        return homeostatCorrectionRepository;
    };
    const watch = (readHomeostasisState: () => { homeostasisState: TCNSHomeostasisState<TDeckKey | undefined>; deckId: string | undefined }): TCNSHomeostatConformanceWatch => {
        const states: TCNSHomeostasisState<TDeckKey | undefined>[] = [];
        const frames: string[] = [];
        const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => {
            const { homeostasisState, deckId } = readHomeostasisState();
            const deck = deckId === undefined ? undefined : deckService.getSlotByKey(decks, deckId).entity;
            states.push(homeostasisState);
            frames.push(`${homeostasisState.status}:${deck?.title ?? '-'}`);
        });
        return { states, frames, dispose: () => OIMEffectService.INSTANCE.disposeEffect(effect) };
    };
    return {
        createEnvironment: (cns, overrides) => {
            cns.addDrainListener(() => db.flush());
            return createCNSOIMDBHomeostatEnvironment({
                db,
                cns,
                onlineSlot: onlineService.getSingleSlot(online),
                visibilitySlot: visibilityService.getSingleSlot(visibility),
                createHomeostatCorrectionRepository,
                ...overrides,
            });
        },
        writeDeck: deck => { deckService.writeSlotContentByKey(decks, deck.id, deck); },
        watchDeck: (environment, homeostatReceptor, deckId) => {
            const deckQueries = environment.createComputedStoreAggregate(homeostatReceptor);
            deckQueriesList.push(deckQueries);
            return watch(() => ({
                homeostasisState: deckQueries.getSlotByKey([deckId]).value,
                deckId,
            }));
        },
        watchSelectedDeck: (environment, homeostatReceptor, fetchDeck) => {
            const selectedDeckQuery = environment.createSourceTrackingComputedStoreAggregate(homeostatReceptor, {
                getHomeostatSource: () => {
                    const deckId = selectionService.getSlotByKey(selection, 'current').entity?.deckId;
                    return deckId === undefined ? undefined : { key: [deckId], transduce: abortSignal => fetchDeck(deckId, abortSignal) };
                },
            });
            return watch(() => {
                const homeostasisState = selectedDeckQuery.getSingleSlot().value;
                const deckId = selectionService.getSlotByKey(selection, 'current').entity?.deckId;
                return { homeostasisState, deckId };
            });
        },
        select: deckId => {
            if (deckId === undefined) selectionService.getSlotByKey(selection, 'current').clearSlotContent();
            else selectionService.writeSlotContentByKey(selection, 'current', { deckId });
            db.flush();
        },
        reselect: () => {
            const selectionSlot = selectionService.getSlotByKey(selection, 'current');
            selectionSlot.updateEntity({ selectionCount: (selectionSlot.entity?.selectionCount ?? 0) + 1 });
            db.flush();
        },
        setOnline: isOnline => { onlineService.writeSingleSlotContent(online, { isOnline }); db.flush(); },
        setVisible: isVisible => { visibilityService.writeSingleSlotContent(visibility, { isVisible }); db.flush(); },
        invalidateInsideDerivation: (environment, homeostatReceptor, deckId) => {
            let isInvalidated = false;
            const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => {
                const count = triggerService.getSingleSlot(trigger).entity?.count ?? 0;
                if (count === 0 || isInvalidated) return;
                isInvalidated = true;
                environment.invalidate(homeostatReceptor, [deckId]);
            });
            triggerService.writeSingleSlotContent(trigger, { count: 1 });
            db.flush();
            OIMEffectService.INSTANCE.disposeEffect(effect);
        },
        createSignInFiringPolicy: () => {
            const sessionService = createOIMSingleSlotService({ slotContentService: createOIMEntityContentService<{ isSignedIn: boolean }>() });
            const session = sessionService.createStoreSlot(db);
            sessionService.writeSingleSlotContent(session, { isSignedIn: false });
            db.flush();
            const sessionSlot = sessionService.getSingleSlot(session);
            return {
                homeostatFiringPolicy: {
                    sourceSlots: [sessionSlot],
                    isFiringAllowed: () => sessionSlot.entity?.isSignedIn ?? false,
                    isRefiringAllowed: () => sessionSlot.entity?.isSignedIn ?? false,
                },
                signIn: () => { sessionService.writeSingleSlotContent(session, { isSignedIn: true }); db.flush(); },
            };
        },
        defaultHomeostatCorrectionRepository: () => createHomeostatCorrectionRepository,
        keepingHomeostatCorrectionRepository,
        wrapHomeostatCorrectionRepository: (createHomeostatCorrectionRepository, writtenStatuses) => (homeostatReceptor): ICNSOIMDBHomeostatCorrectionRepository => {
            const homeostatCorrectionRepository = createHomeostatCorrectionRepository(homeostatReceptor);
            return {
                getHomeostatCorrectionSlot: keyHash => homeostatCorrectionRepository.getHomeostatCorrectionSlot(keyHash),
                peekHomeostatCorrectionSlot: keyHash => homeostatCorrectionRepository.peekHomeostatCorrectionSlot(keyHash),
                peekHomeostatCorrectionState: keyHash => homeostatCorrectionRepository.peekHomeostatCorrectionState(keyHash),
                holdHomeostatCorrectionState: keyHash => homeostatCorrectionRepository.holdHomeostatCorrectionState(keyHash),
                unholdHomeostatCorrectionState: keyHash => homeostatCorrectionRepository.unholdHomeostatCorrectionState(keyHash),
                writeHomeostatCorrectionState: (keyHash, homeostatCorrectionState) => {
                    writtenStatuses.push(homeostatCorrectionState.status);
                    homeostatCorrectionRepository.writeHomeostatCorrectionState(keyHash, homeostatCorrectionState);
                },
            };
        },
        countRetained: () => {
            let retained = 0;
            for (const { homeostatCorrectionStoreSlot } of homeostatCorrectionRepositories) retained += homeostatCorrectionStoreSlot.slotService.getSlotCount(homeostatCorrectionStoreSlot);
            for (const deckQueries of deckQueriesList) retained += deckQueries.getSlotCount();
            return retained;
        },
        settle,
        advance: async ms => {
            const advanceMs = ms + OIM_SLICE_LENGTH_MS * 2;
            nowMs += advanceMs;
            await jest.advanceTimersByTimeAsync(advanceMs);
            await settle();
        },
    };
});
