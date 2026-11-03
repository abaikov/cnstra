import { cnsNeuron } from '@cnstra/core';
import type { TCNSServerMessageDTO } from '@cnstra/devtools-dto';
import { appModelAxon } from './AppModelAxon';
import { wsAxon } from '../ws/WsAxon';

export const appIngressNeuron = cnsNeuron(appModelAxon).bind(wsAxon, {
    open: () => {},
    close: () => {},
    error: () => {},
    message: (raw, axon) => {
        let msg: TCNSServerMessageDTO | undefined;
        try {
            msg = typeof raw === 'string' ? JSON.parse(raw) : undefined;
        } catch {
            return;
        }
        if (!msg || typeof (msg as { type?: unknown }).type !== 'string') {
            return;
        }

        switch (msg.type) {
            case 'app.connected':
                return axon.appUpserted.createSignal(msg.app);

            case 'app.disconnected':
                return axon.appDisconnected.createSignal({ appId: msg.appId });

            case 'apps.result':
                return msg.items.map(app => axon.appUpserted.createSignal(app));

            default:
                return;
        }
    },
});
