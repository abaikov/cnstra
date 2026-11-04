import * as React from 'react';
import { act, render } from '@testing-library/react';
import { collateral } from '@cnstra/core';
import { OIMDB } from '@oimdb/core';
import { OIMDBProvider } from '@oimdb/react';
import { CNSHomeostatReceptor, defineCNSHomeostatModel, ECNSHomeostatCorrectionStatus } from '@cnstra/sync';
import { createCNSOIMDBHomeostatSchema } from '../index';
import { useCNSHomeostatEntity } from '../react/index';
import type { TCNSHomeostatEntityHomeostasis } from '../react/index';

type TCard = { id: string; title: string };

const settle = async () => {
    for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); });
};

const cardNotFound = new Error('no card c404');

const createApp = () => {
    const db = new OIMDB();
    const requested: string[] = [];
    const answerByCardId = new Map<string, (card: TCard) => void>();
    const cardReceptor = new CNSHomeostatReceptor<[cardId: string], TCard>({
        name: 'card',
        transduce: ([cardId]) => {
            requested.push(cardId);
            if (cardId === 'c404') return Promise.reject(cardNotFound);
            return new Promise<TCard>(resolve => { answerByCardId.set(cardId, resolve); });
        },
    });
    const boardModelDefinition = defineCNSHomeostatModel({ cardsChanged: collateral<{ cardIds: string[] }>() })
        .collection('cards', { idOf: (card: TCard) => card.id, homeostatReceptor: cardReceptor });
    const schema = createCNSOIMDBHomeostatSchema(db, { homeostatModels: { board: boardModelDefinition } });
    const { board } = schema;
    const readings: TCNSHomeostatEntityHomeostasis<TCard>[] = [];
    function CardScreen({ cardId }: { cardId: string }): React.ReactElement {
        const { entity: card, status, error } = useCNSHomeostatEntity(board.cards, cardId);
        readings.push({ entity: card, status, error });
        return <span data-testid="card">{`${status}:${card?.title ?? '-'}`}</span>;
    }
    const App = ({ children }: { children: React.ReactNode }) => <OIMDBProvider db={db}>{children}</OIMDBProvider>;
    const answer = async (cardId: string) => {
        const answerCard = answerByCardId.get(cardId);
        if (answerCard === undefined) throw new Error(`no request for ${cardId} is waiting`);
        answerCard({ id: cardId, title: `card ${cardId}` });
        await settle();
    };
    const lastReading = () => {
        const reading = readings[readings.length - 1];
        if (reading === undefined) throw new Error('nothing was rendered');
        return reading;
    };
    return { requested, lastReading, answer, CardScreen, App, dispose: () => { schema.dispose(); db.dispose(); } };
};

describe('useCNSHomeostatEntity: an entity of a synced model with its loading and its error', () => {
    it('shows a skeleton while the card is asked, then the card, after one request under StrictMode', async () => {
        const app = createApp();
        const screen = render(<React.StrictMode><app.App><app.CardScreen cardId="c42" /></app.App></React.StrictMode>);
        await settle();
        expect(app.lastReading()).toEqual({ entity: undefined, status: ECNSHomeostatCorrectionStatus.Firing, error: undefined });
        expect(screen.getByTestId('card').textContent).toBe(`${ECNSHomeostatCorrectionStatus.Firing}:-`);
        await app.answer('c42');
        expect(app.lastReading()).toEqual({ entity: { id: 'c42', title: 'card c42' }, status: ECNSHomeostatCorrectionStatus.Restored, error: undefined });
        expect(screen.getByTestId('card').textContent).toBe(`${ECNSHomeostatCorrectionStatus.Restored}:card c42`);
        expect(app.requested).toEqual(['c42']);
        screen.unmount();
        app.dispose();
    });

    it('shows the failure of the request with its error and no card', async () => {
        const app = createApp();
        const screen = render(<app.App><app.CardScreen cardId="c404" /></app.App>);
        await settle();
        const reading = app.lastReading();
        expect(reading.status).toBe(ECNSHomeostatCorrectionStatus.Failed);
        expect(reading.error).toBe(cardNotFound);
        expect(reading.entity).toBeUndefined();
        expect(app.requested).toEqual(['c404']);
        screen.unmount();
        app.dispose();
    });

    it('asks once for a card two components read', async () => {
        const app = createApp();
        const screen = render(<app.App><app.CardScreen cardId="c42" /><app.CardScreen cardId="c42" /></app.App>);
        await settle();
        await app.answer('c42');
        expect(screen.getAllByTestId('card').map(card => card.textContent)).toEqual([
            `${ECNSHomeostatCorrectionStatus.Restored}:card c42`,
            `${ECNSHomeostatCorrectionStatus.Restored}:card c42`,
        ]);
        expect(app.requested).toEqual(['c42']);
        screen.unmount();
        app.dispose();
    });
});
