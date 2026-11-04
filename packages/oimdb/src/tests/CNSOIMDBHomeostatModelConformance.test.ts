import { isOIMSlotEmpty, OIMDB, OIMEffectService } from '@oimdb/core';
import { cnsHomeostatModelConformance } from '../../../sync/src/tests/conformance/cnsHomeostatModelConformance';
import { cnsSettleMicrotasks } from '../../../sync/src/tests/support/cnsHomeostatTestSupport';
import { CNSOIMDBHomeostatModelBinding } from '../index';
import type { ICNSOIMDBHomeostatModelHandles } from '../index';

cnsHomeostatModelConformance<ICNSOIMDBHomeostatModelHandles>('OIMDB', () => {
    let nowMs = 1_000_000;
    const db = new OIMDB({ getNowMs: () => nowMs });
    const settle = () => cnsSettleMicrotasks(undefined, 12);
    return {
        createBinding: () => new CNSOIMDBHomeostatModelBinding(db),
        watch: read => {
            const frames: string[] = [];
            const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => { frames.push(read()); });
            return { frames, dispose: () => OIMEffectService.INSTANCE.disposeEffect(effect) };
        },
        cardOf: (cards, cardId) => cards.getSlotByKey(cardId).entity,
        writeCard: (cards, card) => { cards.writeSlotContentByKey(card.id, card); },
        cardsOf: (cardsBucket, key) => Array.from(cardsBucket.getSlotByKey(key).getBucketMemberSlots(), cardSlot => cardSlot.entity),
        cardsPageSummaryOf: (cardsPageSummary, key) => cardsPageSummary.getSlotByKey(key).entity,
        homeostasisStatusOf: (homeostasis, key) => homeostasis.getSlotByKey(key).value.status,
        peekCard: (cards, cardId) => cards.peekSlotByKey(cardId)?.entity,
        peekCards: (cardsBucket, key) => {
            const cardsBucketSlot = cardsBucket.peekSlotByKey(key);
            return cardsBucketSlot === undefined || isOIMSlotEmpty(cardsBucketSlot)
                ? undefined
                : Array.from(cardsBucketSlot.getBucketMemberSlots(), cardSlot => cardSlot.entity);
        },
        peekCardsPageSummary: (cardsPageSummary, key) => cardsPageSummary.peekSlotByKey(key)?.entity,
        settle,
        advance: async ms => {
            nowMs += ms;
            await jest.advanceTimersByTimeAsync(ms);
            db.flush();
            await settle();
        },
    };
});
