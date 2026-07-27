import { TCNSSignal } from '@cnstra/types';
import { ICNSCollateral } from '@cnstra/types';

export class CNSCollateral<TPayload> implements ICNSCollateral<TPayload> {
    createSignal(): TCNSSignal<CNSCollateral<TPayload>>;
    createSignal(payload: TPayload): TCNSSignal<CNSCollateral<TPayload>>;
    createSignal(payload?: TPayload): TCNSSignal<CNSCollateral<TPayload>> {
        return { collateral: this, payload };
    }
}
