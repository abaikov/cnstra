import { autorun } from 'mobx';
import { cnsHomeostatModelConformance } from '../../../sync/src/tests/conformance/cnsHomeostatModelConformance';
import { cnsSettleMicrotasks } from '../../../sync/src/tests/support/cnsHomeostatTestSupport';
import { CNSMobXHomeostatModelBinding } from '../index';
import type { ICNSMobXHomeostatModelHandles } from '../index';

cnsHomeostatModelConformance<ICNSMobXHomeostatModelHandles>('MobX', () => {
    const settle = () => cnsSettleMicrotasks(undefined, 12);
    return {
        createBinding: () => new CNSMobXHomeostatModelBinding(),
        watch: read => {
            const frames: string[] = [];
            const dispose = autorun(() => { frames.push(read()); });
            return { frames, dispose };
        },
        cardOf: (cards, cardId) => cards.getEntry(cardId),
        writeCard: (cards, card) => { cards.writeEntry(card.id, card); },
        cardsOf: (cardsBucket, key) => cardsBucket.getEntities(key),
        cardsPageSummaryOf: (cardsPageSummary, key) => cardsPageSummary.getEntry(key),
        homeostasisStatusOf: (homeostasis, key) => homeostasis.createComputed(key).get().status,
        peekCard: (cards, cardId) => cards.peekEntry(cardId),
        peekCards: (cardsBucket, key) => cardsBucket.peekEntities(key),
        peekCardsPageSummary: (cardsPageSummary, key) => cardsPageSummary.peekEntry(key),
        settle,
        advance: async ms => {
            await jest.advanceTimersByTimeAsync(ms);
            await settle();
        },
    };
});
