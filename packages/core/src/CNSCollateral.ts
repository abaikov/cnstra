import { TCNSSignal } from './types/TCNSSignal';
import { ICNSCollateral } from './interfaces/ICNSCollateral';

export class CNSCollateral<TName extends string, TPayload>
    implements ICNSCollateral<TName, TPayload>
{
    constructor(public readonly name: TName) {}

    createSignal(): TCNSSignal<TName, TPayload>;
    createSignal(payload: TPayload): TCNSSignal<TName, TPayload>;
    createSignal(payload?: TPayload): TCNSSignal<TName, TPayload> {
        return { collateralName: this.name, payload };
    }
}
