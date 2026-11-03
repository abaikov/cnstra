import { TCNSSignal } from '@cnstra/types';
import { ICNSCollateral } from '@cnstra/types';

let nextCollateralIndex = 0;

export class CNSCollateral<TPayload> implements ICNSCollateral<TPayload> {
    public readonly index = nextCollateralIndex++;

    createSignal(): TCNSSignal<CNSCollateral<TPayload>>;
    createSignal(payload: TPayload): TCNSSignal<CNSCollateral<TPayload>>;
    createSignal(payload?: TPayload): TCNSSignal<CNSCollateral<TPayload>> {
        return { collateral: this, payload };
    }
}
