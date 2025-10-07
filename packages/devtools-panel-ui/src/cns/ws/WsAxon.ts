import { collateral } from '@cnstra/core';

export type TWSRawMessage = string | ArrayBuffer | Blob;

export const wsAxon = {
    open: collateral('ws:open' as const),
    close: collateral<{ code: number; reason?: string }>('ws:close'),
    error: collateral<{ message: string }>('ws:error'),
    message: collateral<TWSRawMessage>('ws:message'),
};
