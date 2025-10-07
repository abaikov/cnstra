import { TCNSSignal } from '../types/TCNSSignal';

export interface ICNSCollateral<TName extends string, TPayload> {
    name: TName;
    createSignal(payload: TPayload): TCNSSignal<TName, TPayload>;
}
