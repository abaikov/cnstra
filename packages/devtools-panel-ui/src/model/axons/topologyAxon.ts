import { collateral } from '@cnstra/core';

export const topologyAxon = {
    appsChanged: collateral<{ scopeName: string | undefined }>(),
    topologyChanged: collateral<{ scopeName: string | undefined }>(),
};
