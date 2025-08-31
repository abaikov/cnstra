import { TCNSSignal } from '../types/TCNSSignal';

export interface ICNSCollateral<TId extends string, TPayload> {
    id: TId;
    createSignal(payload: TPayload): TCNSSignal<TId, TPayload>;
}
