import { collateral } from '@cnstra/core';

export const actionFeedbackAxon = {
    noticeExpired: collateral<{ noticeNumber: number }>(),
};
