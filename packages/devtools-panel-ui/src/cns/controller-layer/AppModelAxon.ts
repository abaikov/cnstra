import { collateral } from '@cnstra/core';
import {
    AppsActiveMessage,
    AppDisconnectedMessage,
    DevToolsApp,
    InitMessage,
    ResponseBatchMessage,
    StimulationBatchMessage,
} from '@cnstra/devtools-dto';

export const appModelAxon = {
    devtoolsInit: collateral<InitMessage>(),
    devtoolsResponseBatch: collateral<ResponseBatchMessage>(),
    appsActive: collateral<AppsActiveMessage>(),
    appAdded: collateral<{ type: 'app:added'; app: DevToolsApp }>(),
    appDisconnected: collateral<AppDisconnectedMessage>(),
    selectAppClicked: collateral<{ appId: string }>(),
    stimulationBatch: collateral<StimulationBatchMessage>(),
};
