import { TCNSSignal } from './types/TCNSSignal';

export class CNSCollateral<TId extends string, TPayload> {
    constructor(public readonly id: TId) {}

    createSignal(
        ...args: [TPayload] extends [undefined] ? [] : [payload: TPayload]
    ): TCNSSignal<TId, TPayload> {
        const payload = (args as any)[0] as TPayload;
        return { type: this.id, payload };
    }
}
