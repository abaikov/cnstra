import { cnsCollateral } from '@cnstra/core';

export type TWSRawMessage = string | ArrayBuffer | Blob;

export const wsAxon = {
    open: cnsCollateral<'ws:open'>(),
    close: cnsCollateral<{ code: number; reason?: string }>(),
    error: cnsCollateral<{ message: string }>(),
    message: cnsCollateral<TWSRawMessage>(),
};
