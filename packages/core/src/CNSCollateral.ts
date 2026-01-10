import { TCNSSignal } from './types/TCNSSignal';
import { ICNSCollateral } from './interfaces/ICNSCollateral';

export class CNSCollateral<TPayload> implements ICNSCollateral<TPayload> {
    createSignal(): TCNSSignal<CNSCollateral<TPayload>>;
    createSignal(payload: TPayload): TCNSSignal<CNSCollateral<TPayload>>;
    createSignal(payload?: TPayload): TCNSSignal<CNSCollateral<TPayload>> {
        return { collateral: this, payload };
    }
}
