import { TCNSSignal } from '../types/TCNSSignal';

export interface ICNSCollateral<TPayload> {
    readonly index: number;
    createSignal(): TCNSSignal<ICNSCollateral<TPayload>>;
    createSignal(payload: TPayload): TCNSSignal<ICNSCollateral<TPayload>>;
}
