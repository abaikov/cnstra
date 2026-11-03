import { withExoHandlers } from '@exodra/core';
import type { TExoEventOf, TExoEventPort, TExoMachine } from '@exodra/core';
import type { ICNSCollateral } from '@cnstra/types';
import type { TCNSExodraNode } from './types/TCNSExodraNode';
import type { TCNSExodraReceptor } from './types/TCNSExodraReceptor';
import { injectCNS } from './injectCNS';

export function withCNSReceptors<
    TWiring extends TCNSExodraNode,
    TPorts,
    TParams,
    TState,
    TMachine extends TExoMachine<TWiring, TPorts, TParams, TState>
>(
    machine: TMachine & TExoMachine<TWiring, TPorts, TParams, TState>,
    declare: (receptor: TCNSExodraReceptor<TWiring & { state: TState }, TWiring>) => void
): TMachine {
    return withExoHandlers(machine, on => {
        const receptor: TCNSExodraReceptor<TWiring & { state: TState }, TWiring> = <TEvent>(
            port: TExoEventPort<TEvent>,
            collateral: ICNSCollateral<unknown>,
            payloadOf?: (node: TWiring & { state: TState }, event: unknown extends TEvent ? TExoEventOf<TWiring> : TEvent) => unknown
        ): void => {
            on(port, (node, event) => {
                if (payloadOf === undefined) {
                    injectCNS(node).stimulate(collateral.createSignal());
                    return;
                }
                const payload = payloadOf(node, event);
                if (payload !== undefined) injectCNS(node).stimulate(collateral.createSignal(payload));
            });
        };
        declare(receptor);
    });
}
