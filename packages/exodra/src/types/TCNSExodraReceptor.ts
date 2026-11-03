import type { TExoEventOf, TExoEventPort } from '@exodra/core';
import type { ICNSCollateral } from '@cnstra/types';

export type TCNSExodraReceptor<TNode, TWiring> = {
    <TEvent, TCollateral extends ICNSCollateral<unknown>>(
        port: TExoEventPort<TEvent>,
        collateral: TCollateral & ([TCollateral extends ICNSCollateral<infer P> ? P : never] extends [undefined | void] ? unknown : never)
    ): void;
    <TEvent, TCollateral extends ICNSCollateral<unknown>>(
        port: TExoEventPort<TEvent>,
        collateral: TCollateral & ([TCollateral extends ICNSCollateral<infer P> ? P : never] extends [undefined | void] ? never : unknown),
        payloadOf: (
            node: TNode,
            event: unknown extends TEvent ? TExoEventOf<TWiring> : TEvent
        ) => (TCollateral extends ICNSCollateral<infer P> ? P : never) | undefined
    ): void;
};
