import { TCNSSignal } from '../types/TCNSSignal';
import { CNSCollateral } from '../CNSCollateral';

export interface ICNSCollateral<TPayload> {
    createSignal(payload: TPayload): TCNSSignal<CNSCollateral<TPayload>>;
}
