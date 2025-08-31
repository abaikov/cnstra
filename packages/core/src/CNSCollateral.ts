import { TCNSSignal } from './types/TCNSSignal';
import { ICNSCollateral } from './interfaces/ICNSCollateral';

export class CNSCollateral<TId extends string, TPayload>
    implements ICNSCollateral<TId, TPayload>
{
    constructor(public readonly id: TId) {}

    createSignal(): TCNSSignal<TId, TPayload>;
    createSignal(payload: TPayload): TCNSSignal<TId, TPayload>;
    createSignal(payload?: TPayload): TCNSSignal<TId, TPayload> {
        return { collateral: this, payload };
    }
}
