import { autorun, observable, runInAction } from 'mobx';
import type { IComputedValue } from 'mobx';
import { CNSHomeostatFiringPolicy } from '@cnstra/sync';
import type { CNSHomeostatReceptor, ICNSHomeostatCorrectionRepository, ICNSHomeostatFiringPolicy, TCNSHomeostasisState } from '@cnstra/sync';
import { cnsHomeostatConformance } from '../../../sync/src/tests/conformance/cnsHomeostatConformance';
import type {
    TCNSHomeostatConformanceDeck as TDeck,
    TCNSHomeostatConformanceDeckKey as TDeckKey,
    TCNSHomeostatConformanceEngine,
    TCNSHomeostatConformanceWatch,
} from '../../../sync/src/tests/conformance/cnsHomeostatConformance';
import { CNSMobXHomeostatCorrectionRepository, createCNSMobXHomeostatEnvironment } from '../index';
import type { CNSMobXHomeostatEnvironment } from '../index';
import { cnsSettleMicrotasks } from '../../../sync/src/tests/support/cnsHomeostatTestSupport';

cnsHomeostatConformance('MobX', (): TCNSHomeostatConformanceEngine<ICNSHomeostatFiringPolicy, ICNSHomeostatCorrectionRepository<readonly unknown[]>, CNSMobXHomeostatEnvironment> => {
    let nowMs = 1_000_000;
    const decks = observable.map<string, TDeck>();
    const selectedDeckId = observable.box<string | undefined>('d1');
    const selectionCount = observable.box(0);
    const online = observable.box(true);
    const visible = observable.box(true);
    const settle = () => cnsSettleMicrotasks();
    const watch = (homeostasisComputed: IComputedValue<TCNSHomeostasisState<TDeckKey | undefined>>, deckIdOf: () => string | undefined): TCNSHomeostatConformanceWatch => {
        const states: TCNSHomeostasisState<TDeckKey | undefined>[] = [];
        const frames: string[] = [];
        const dispose = autorun(() => {
            const homeostasisState = homeostasisComputed.get();
            const deckId = deckIdOf();
            const deck = deckId === undefined ? undefined : decks.get(deckId);
            states.push(homeostasisState);
            frames.push(`${homeostasisState.status}:${deck?.title ?? '-'}`);
        });
        return { states, frames, dispose };
    };
    return {
        createEnvironment: (cns, overrides) => createCNSMobXHomeostatEnvironment({
            cns,
            isOnline: () => online.get(),
            isVisible: () => visible.get(),
            getNowMs: () => nowMs,
            ...overrides,
        }),
        writeDeck: deck => { runInAction(() => decks.set(deck.id, deck)); },
        watchDeck: (environment, homeostatReceptor, deckId) => watch(
            environment.createComputed(homeostatReceptor, [deckId]),
            () => deckId
        ),
        watchSelectedDeck: (environment, homeostatReceptor, fetchDeck) => watch(
            environment.createSourceTrackingComputed(homeostatReceptor, {
                getHomeostatSource: () => {
                    void selectionCount.get();
                    const deckId = selectedDeckId.get();
                    return deckId === undefined ? undefined : { key: [deckId], transduce: abortSignal => fetchDeck(deckId, abortSignal) };
                },
            }),
            () => selectedDeckId.get()
        ),
        select: deckId => { runInAction(() => selectedDeckId.set(deckId)); },
        reselect: () => { runInAction(() => selectionCount.set(selectionCount.get() + 1)); },
        setOnline: isOnline => { runInAction(() => online.set(isOnline)); },
        setVisible: isVisible => { runInAction(() => visible.set(isVisible)); },
        createSignInFiringPolicy: () => {
            const signedIn = observable.box(false);
            return {
                homeostatFiringPolicy: new CNSHomeostatFiringPolicy({ isOnline: () => signedIn.get() }),
                signIn: () => { runInAction(() => signedIn.set(true)); },
            };
        },
        defaultHomeostatCorrectionRepository: () => () => new CNSMobXHomeostatCorrectionRepository(),
        keepingHomeostatCorrectionRepository: keepAfterUnholdMs => () => new CNSMobXHomeostatCorrectionRepository({ keepAfterUnholdMs }),
        wrapHomeostatCorrectionRepository: (createHomeostatCorrectionRepository, writtenStatuses) => (homeostatReceptor: CNSHomeostatReceptor<never, unknown>): ICNSHomeostatCorrectionRepository<readonly unknown[]> => {
            const homeostatCorrectionRepository = createHomeostatCorrectionRepository(homeostatReceptor);
            return {
                peekHomeostatCorrectionState: keyHash => homeostatCorrectionRepository.peekHomeostatCorrectionState(keyHash),
                holdHomeostatCorrectionState: keyHash => homeostatCorrectionRepository.holdHomeostatCorrectionState(keyHash),
                unholdHomeostatCorrectionState: keyHash => homeostatCorrectionRepository.unholdHomeostatCorrectionState(keyHash),
                writeHomeostatCorrectionState: (keyHash, homeostatCorrectionState) => {
                    writtenStatuses.push(homeostatCorrectionState.status);
                    homeostatCorrectionRepository.writeHomeostatCorrectionState(keyHash, homeostatCorrectionState);
                },
            };
        },
        invalidateInsideDerivation: (environment, homeostatReceptor, deckId) => {
            const dispose = autorun(() => {
                if (online.get()) environment.invalidate(homeostatReceptor, [deckId]);
            });
            dispose();
        },
        countRetained: () => jest.getTimerCount(),
        settle,
        advance: async ms => {
            nowMs += ms;
            await jest.advanceTimersByTimeAsync(ms);
            await settle();
        },
    };
});
