import { collateral } from '@cnstra/core';

export type TWSRawMessage = string | ArrayBuffer | Blob;

export const wsAxon = {
    open: collateral<'ws:open'>(),
    close: collateral<{ code: number; reason?: string }>(),
    error: collateral<{ message: string }>(),
    message: collateral<TWSRawMessage>(),
};
