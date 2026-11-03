import { cnsCollateral } from '@cnstra/core';
import type { TCNSAppDTO } from '@cnstra/devtools-dto';

export const appModelAxon = {
    appUpserted: cnsCollateral<TCNSAppDTO>(),
    appDisconnected: cnsCollateral<{ appId: string }>(),
};
