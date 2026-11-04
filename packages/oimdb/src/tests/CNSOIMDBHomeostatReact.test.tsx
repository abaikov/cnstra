import * as React from 'react';
import { act, render } from '@testing-library/react';
import { createRoot } from 'react-dom/client';
import { CNS, neuron } from '@cnstra/core';
import { createOIMSlotCollectionService, createOIMEntityContentService, OIMDB } from '@oimdb/core';
import { OIMDBProvider, useOIMComputedValueByKey, useOIMEntityByKey } from '@oimdb/react';
import { CNSHomeostatReceptor, CNSHomeostatReceptorCorrection } from '@cnstra/sync';
import { createCNSOIMDBHomeostatEnvironment } from '../index';
import type { TCNSHomeostatConformanceDeck as TDeck, TCNSHomeostatConformanceDeckKey as TDeckKey } from '../../../sync/src/tests/conformance/cnsHomeostatConformance';

const settle = async () => {
    for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); });
};

const createApp = () => {
    const db = new OIMDB();
    const deckService = createOIMSlotCollectionService({ slotContentService: createOIMEntityContentService<TDeck, string>() });
    const decks = deckService.createStoreAggregate(deckService.createStoreSlot(db));
    const requested: string[] = [];
    const deckReceptor = new CNSHomeostatReceptor<TDeckKey, TDeck>({
        name: 'deck',
        transduce: ([deckId]) => {
            requested.push(deckId);
            return Promise.resolve({ id: deckId, title: `deck ${deckId}` });
        },
    });
    const deckWriter = neuron({}).dendrite({
        collateral: deckReceptor.axon.homeostasisRestored,
        response: ({ data }) => { decks.writeSlotContentByKey(data.id, data); },
    });
    const cns = new CNS([deckReceptor.neuron, new CNSHomeostatReceptorCorrection({ homeostatReceptors: [deckReceptor] }).neuron, deckWriter]);
    cns.addDrainListener(() => db.flush());
    const homeostatEnvironment = createCNSOIMDBHomeostatEnvironment({ db, cns });
    const deckQueries = homeostatEnvironment.createComputedStoreAggregate(deckReceptor);
    const isKeyHeld = async (deckId: string) => (await homeostatEnvironment.invalidate(deckReceptor, [deckId])) !== undefined;
    function DeckScreen({ deckId }: { deckId: string }): React.ReactElement {
        const deckHomeostasis = useOIMComputedValueByKey(deckQueries, [deckId]);
        const deck = useOIMEntityByKey(decks, deckId);
        return <span data-testid="deck">{`${deckHomeostasis.status}:${deck?.title ?? '-'}`}</span>;
    }
    const App = ({ children }: { children: React.ReactNode }) => <OIMDBProvider db={db}>{children}</OIMDBProvider>;
    return { db, requested, isKeyHeld, DeckScreen, App };
};

describe('homeostat queries in React through @oimdb/react', () => {
    it('shows the deck after one request', async () => {
        const app = createApp();
        const screen = render(<app.App><app.DeckScreen deckId="d1" /></app.App>);
        await settle();
        expect(screen.getByTestId('deck').textContent).toBe('restored:deck d1');
        expect(app.requested).toEqual(['d1']);
        screen.unmount();
    });

    it('sends one request under StrictMode', async () => {
        const app = createApp();
        const screen = render(<React.StrictMode><app.App><app.DeckScreen deckId="d1" /></app.App></React.StrictMode>);
        await settle();
        expect(screen.getByTestId('deck').textContent).toBe('restored:deck d1');
        expect(app.requested).toEqual(['d1']);
        screen.unmount();
    });

    it('lets the key go at the next flush after the screen unmounts', async () => {
        const app = createApp();
        const screen = render(<app.App><app.DeckScreen deckId="d1" /></app.App>);
        await settle();
        screen.unmount();
        app.db.flush();
        await settle();
        await expect(app.isKeyHeld('d1')).resolves.toBe(false);
    });

    it('sends one request when React subscribes in a later task than it rendered, as outside act', async () => {
        const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
        const wasActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
        const container = document.createElement('div');
        const root = createRoot(container);
        const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
        try {
            const app = createApp();
            root.render(<React.StrictMode><app.App><app.DeckScreen deckId="d1" /></app.App></React.StrictMode>);
            for (let i = 0; i < 10; i++) await nextTask();
            expect(container.textContent).toBe('restored:deck d1');
            expect(app.requested).toEqual(['d1']);
        } finally {
            root.unmount();
            reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment;
        }
    });

    it('sends nothing for a render that Suspense threw away before it subscribed, and lets its key go', async () => {
        const app = createApp();
        const gate = new Promise<void>(() => undefined);
        function Suspender(): React.ReactElement {
            throw gate;
        }
        const screen = render(<app.App><React.Suspense fallback={<i />}><app.DeckScreen deckId="d1" /><Suspender /></React.Suspense></app.App>);
        await settle();
        expect(app.requested).toEqual([]);
        screen.unmount();
        app.db.flush();
        await settle();
        await expect(app.isKeyHeld('d1')).resolves.toBe(false);
    });
});

const createReceptiveFieldApp = () => {
    const db = new OIMDB();
    const requested: string[] = [];
    const deckReceptor = new CNSHomeostatReceptor<TDeckKey, TDeck>({
        name: 'deck',
        transduce: ([deckId]) => {
            requested.push(deckId);
            return Promise.resolve({ id: deckId, title: `deck ${deckId}` });
        },
    });
    let decks: ReturnType<typeof createDeckStoreSlot>;
    const deckWriter = neuron({}).dendrite({
        collateral: deckReceptor.axon.homeostasisRestored,
        response: ({ data }) => { decks.writeSlotContentByKey(data.id, data); },
    });
    const cns = new CNS([deckReceptor.neuron, new CNSHomeostatReceptorCorrection({ homeostatReceptors: [deckReceptor] }).neuron, deckWriter]);
    cns.addDrainListener(() => db.flush());
    const homeostatEnvironment = createCNSOIMDBHomeostatEnvironment({ db, cns });
    const deckReceptiveField = homeostatEnvironment.createReceptiveField(deckReceptor, { selectKey: (deckId: string): TDeckKey => [deckId] });
    const createDeckStoreSlot = () => {
        const deckService = createOIMSlotCollectionService({
            slotContentService: createOIMEntityContentService<TDeck, string>(),
            slotSubscriptionListener: deckReceptiveField.slotSubscriptionListener,
        });
        return deckService.createStoreAggregate(deckService.createStoreSlot(db));
    };
    decks = createDeckStoreSlot();
    const isKeyHeld = async (deckId: string) => (await homeostatEnvironment.invalidate(deckReceptor, [deckId])) !== undefined;
    function DeckScreen({ deckId }: { deckId: string }): React.ReactElement {
        const deck = useOIMEntityByKey(decks, deckId);
        return <span data-testid="deck">{deck?.title ?? '-'}</span>;
    }
    const App = ({ children }: { children: React.ReactNode }) => <OIMDBProvider db={db}>{children}</OIMDBProvider>;
    return { db, requested, isKeyHeld, DeckScreen, App };
};

describe('a receptive field in React through @oimdb/react', () => {
    it('asks once for the deck a screen reads, under StrictMode too', async () => {
        const app = createReceptiveFieldApp();
        const screen = render(<React.StrictMode><app.App><app.DeckScreen deckId="d1" /></app.App></React.StrictMode>);
        await settle();
        expect(screen.getByTestId('deck').textContent).toBe('deck d1');
        expect(app.requested).toEqual(['d1']);
        screen.unmount();
    });

    it('lets the key go on the field pass after the screen unmounts', async () => {
        const app = createReceptiveFieldApp();
        const screen = render(<app.App><app.DeckScreen deckId="d1" /></app.App>);
        await settle();
        await expect(app.isKeyHeld('d1')).resolves.toBe(true);
        await settle();
        screen.unmount();
        app.db.flush();
        await settle();
        await expect(app.isKeyHeld('d1')).resolves.toBe(false);
    });
});
