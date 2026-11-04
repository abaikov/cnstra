import type { ICNSStimulationRepository } from '@cnstra/persist';
import type { ICNSScheduledStimulationReader, TCNSDevToolsActionMiddleware } from '@cnstra/persist-dto';
import type { TCNSUiConfig } from './index';
import type { TCNSPollingOptions } from './pollingTransport';
import type { TCNSDevToolsWebSocketOptions } from './TCNSDevToolsWebSocketOptions';

export type TCNSDevToolsHandlerOptions = {
    basePath?: string;
    stimulationRepository?: ICNSStimulationRepository;
    actions?: readonly TCNSDevToolsActionMiddleware[];
    scheduledStimulationReader?: ICNSScheduledStimulationReader;
    ui?: TCNSUiConfig;
    readOnly?: boolean;
    polling?: TCNSPollingOptions;
    webSocket?: TCNSDevToolsWebSocketOptions;
    appId?: string;
};
