import { TCNSSignal } from '../types/TCNSSignal';

export interface ICNSCollateral<TType extends string, TPayload> {
    type: TType;
    createSignal(payload: TPayload): TCNSSignal<TType, TPayload>;
}
