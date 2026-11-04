import { CNS, neuron } from '@cnstra/core';
import { createOIMSlotCollectionService, createOIMEntityContentService, OIMDB, OIMEffectService } from '@oimdb/core';
import { CNSHomeostatReceptor, CNSHomeostatReceptorCorrection, ECNSHomeostatCorrectionStatus } from '@cnstra/sync';
import type { TCNSHomeostasisState } from '@cnstra/sync';
import { createCNSOIMDBHomeostatEnvironment } from '../index';
import type { TCNSHomeostatConformanceDeck as TDeck, TCNSHomeostatConformanceDeckKey as TDeckKey } from '../../../sync/src/tests/conformance/cnsHomeostatConformance';
import { cnsSettleMicrotasks } from '../../../sync/src/tests/support/cnsHomeostatTestSupport';

const settle = () => cnsSettleMicrotasks(undefined, 12);

const createApp = () => {
    const db = new OIMDB();
    const server = { titles: { d1: 'first' } as Record<string, string>, requested: [] as string[] };
    const deckService = createOIMSlotCollectionService({ slotContentService: createOIMEntityContentService<TDeck, string>() });
    const decks = deckService.createStoreSlot(db);
    const deckReceptor = new CNSHomeostatReceptor<TDeckKey, TDeck>({
        name: 'deck',
        transduce: ([deckId]) => {
            server.requested.push(deckId);
            return Promise.resolve({ id: deckId, title: server.titles[deckId] ?? `deck ${deckId}` });
        },
    });
    const deckWriter = neuron({}).dendrite({
        collateral: deckReceptor.axon.homeostasisRestored,
        response: ({ data }) => {
            deckService.writeSlotContentByKey(decks, data.id, data);
        },
    });
    const cns = new CNS([deckReceptor.neuron, new CNSHomeostatReceptorCorrection({ homeostatReceptors: [deckReceptor] }).neuron, deckWriter]);
    cns.addDrainListener(() => db.flush());
    const homeostatEnvironment = createCNSOIMDBHomeostatEnvironment({ db, cns });
    const deckQueries = homeostatEnvironment.createComputedStoreAggregate(deckReceptor);
    const readDeckHomeostasis = (deckId: string): TCNSHomeostasisState<TDeckKey> =>
        deckQueries.getSlotByKey([deckId]).value;
    const titleOf = (deckId: string) => deckService.getSlotByKey(decks, deckId).entity?.title;
    const show = (deckId: string) => {
        const frames: string[] = [];
        let deckHomeostasis: TCNSHomeostasisState<TDeckKey> | undefined;
        const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => {
            deckHomeostasis = readDeckHomeostasis(deckId);
            const deck = deckService.getSlotByKey(decks, deckId).entity;
            frames.push(`${deckHomeostasis.status}:${deck?.title ?? '-'}`);
        });
        const current = () => {
            if (deckHomeostasis === undefined) throw new Error('the page has not read its query');
            return deckHomeostasis;
        };
        return { frames, current, dispose: () => OIMEffectService.INSTANCE.disposeEffect(effect) };
    };
    const readWithoutReader = (deckId: string) => {
        return deckQueries.getSlotByKey([deckId]).value;
    };
    const correctionOf = (deckId: string) =>
        homeostatEnvironment.homeostatCorrectionRepositoryOf(deckReceptor).peekHomeostatCorrectionState(homeostatEnvironment.homeostatEnvironmentOptions.keyHashFn([deckId]));
    return { db, server, deckReceptor, homeostatEnvironment, titleOf, show, readWithoutReader, correctionOf };
};

describe('homeostat queries on OIMDB in an app', () => {
    it('keeps one request for a reader that leaves and comes back in the tick it subscribed', async () => {
        const app = createApp();
        const leaving = app.show('d1');
        leaving.dispose();
        const page = app.show('d1');
        await settle();
        expect(app.server.requested).toEqual(['d1']);
        expect(page.frames[page.frames.length - 1]).toBe('restored:first');
        page.dispose();
    });

    it('aborts the request of a reader that leaves after it started', async () => {
        const app = createApp();
        const page = app.show('d1');
        await Promise.resolve();
        await Promise.resolve();
        const settled = page.current().homeostatRunningFiring?.waitUntilSettled();
        page.dispose();
        app.db.flush();
        await expect(settled).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('shows a spinner, then the deck, with no manual flush', async () => {
        const app = createApp();
        const page = app.show('d1');
        await settle();
        expect(page.frames).toEqual(['firing:-', 'restored:first']);
        page.dispose();
    });

    it('a route loader: start the query, wait for the data, hand the query over to the page', async () => {
        const app = createApp();
        const loader = app.show('d1');
        await loader.current().homeostatRunningFiring?.waitUntilSettled();
        expect(app.titleOf('d1')).toBe('first');
        const page = app.show('d1');
        loader.dispose();
        await settle();
        expect(page.frames[page.frames.length - 1]).toBe('restored:first');
        expect(app.server.requested).toEqual(['d1']);
        page.dispose();
    });

    it('drops a record written in advance into a key nobody holds at the next flush', async () => {
        const app = createApp();
        app.homeostatEnvironment.homeostatCorrectionRepositoryOf(app.deckReceptor).writeHomeostatCorrectionState(app.homeostatEnvironment.homeostatEnvironmentOptions.keyHashFn(['d1']), {
            receptorName: 'deck', key: ['d1'], status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 1,
            attempt: 0, startedAtMs: 0, restoredAtMs: 0, failedAtMs: undefined, error: undefined, invalidationNumber: 0,
        });
        app.db.flush();
        await settle();
        expect(app.correctionOf('d1')).toBeUndefined();
    });

    it('a read with no subscriber sends nothing, and its key goes at the next flush', async () => {
        const app = createApp();
        expect(app.readWithoutReader('d1').status).toBe(ECNSHomeostatCorrectionStatus.Firing);
        await settle();
        expect(app.server.requested).toEqual([]);
        app.db.flush();
        await settle();
        expect(app.correctionOf('d1')).toBeUndefined();
        await expect(app.homeostatEnvironment.invalidate(app.deckReceptor, ['d1'])).resolves.toBeUndefined();
    });
});
