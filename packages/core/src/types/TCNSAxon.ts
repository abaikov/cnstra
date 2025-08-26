import { CNSCollateral } from '../CNSCollateral';

export type TCNSAxon<TCId extends string, TInputPayload = unknown> = Record<
    TCId,
    CNSCollateral<TCId, TInputPayload>
>;
