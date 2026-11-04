import type { TCNSHomeostatTransductionResponse } from './TCNSHomeostatTransductionResponse';

export type TCNSHomeostatTransductionChannelResponse = TCNSHomeostatTransductionResponse & {
    readonly requestId: string;
};
