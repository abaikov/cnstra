import { TCNSSignal } from '../types/TCNSSignal';

export interface ICNSCollateral<TPayload> {
    createSignal(): TCNSSignal<ICNSCollateral<TPayload>>;
    createSignal(payload: TPayload): TCNSSignal<ICNSCollateral<TPayload>>;
}
