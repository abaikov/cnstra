import { collateral } from '@cnstra/core';
import {
    AppsActiveMessage,
    AppDisconnectedMessage,
    InitMessage,
    ResponseBatchMessage,
    StimulationBatchMessage,
} from '@cnstra/devtools-dto';

export const appModelAxon = {
    devtoolsInit: collateral<InitMessage, 'devtools:init'>('devtools:init'),
    devtoolsResponseBatch: collateral<
        ResponseBatchMessage,
        'devtools:response-batch'
    >('devtools:response-batch'),
    appsActive: collateral<AppsActiveMessage, 'apps:active'>('apps:active'),
    appDisconnected: collateral<AppDisconnectedMessage, 'app:disconnected'>(
        'app:disconnected'
    ),
    selectAppClicked: collateral<{ appId: string }, 'app:select'>('app:select'),
    stimulationBatch: collateral<StimulationBatchMessage, 'stimulation:batch'>(
        'stimulation:batch'
    ),
};
