import type { ICNSHomeostatTransductionCodec } from '../interfaces/ICNSHomeostatTransductionCodec';
import type { TCNSHomeostatTransductionChannelRequest } from './TCNSHomeostatTransductionChannelRequest';

export type TCNSHomeostatTransductionChannelOptions = {
    sendRequest: (homeostatTransductionChannelRequest: TCNSHomeostatTransductionChannelRequest) => void;
    homeostatTransductionCodec?: ICNSHomeostatTransductionCodec | undefined;
    timeoutMs?: number | undefined;
};
