import { TCNSSignal } from './types/TCNSSignal';
import { ICNSCollateral } from './interfaces/ICNSCollateral';

export class CNSCollateral<TType extends string, TPayload>
    implements ICNSCollateral<TType, TPayload>
{
    constructor(public readonly type: TType) {}

    createSignal(): TCNSSignal<TType, TPayload>;
    createSignal(payload: TPayload): TCNSSignal<TType, TPayload>;
    createSignal(payload?: TPayload): TCNSSignal<TType, TPayload> {
        return { collateral: this, payload };
    }
}
