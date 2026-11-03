/**
 * E2E late-joining flow: panel connects, receives an initial apps list, then a
 * new app connects with its topology. Drives the real pipeline end-to-end
 * (ws message → AppIngressNeuron → data-layer → OIMDB).
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { db } from '../model/db';
import type { TCNSAppDTO, TCNSServerMessageDTO } from '@cnstra/devtools-dto';
import { mainCNS } from '../cns';
import { wsAxon } from '../cns/ws/WsAxon';

// Deterministic: await the whole ingest → data-layer chain.
const feed = async (msg: TCNSServerMessageDTO) => {
    await mainCNS
        .stimulate(wsAxon.message.createSignal(JSON.stringify(msg)))
        .waitUntilComplete();
};

const makeApp = (id: string, name: string): TCNSAppDTO => ({
    id,
    name,
    version: '1.0.0',
});

const connectedApps = () => db.allApps.getEntitiesByKey('all');

const clearApps = () => {
    for (const app of connectedApps()) db.apps.deleteEntityByKey(app.id);
};

describe('E2E Late-Joining Apps', () => {
    beforeEach(() => clearApps());

    it('runs the full connect → list → late-join flow', async () => {
        // Step 1: initial apps list (server's response to the connect).
        await feed({
            type: 'apps.result',
            requestId: '__init__',
            items: [makeApp('existing-app', 'Existing App')],
        });
        expect(connectedApps().map(a => a.id)).toEqual(['existing-app']);

        // Step 2: a new app connects.
        await feed({
            type: 'app.connected',
            app: makeApp('late-app', 'Late App'),
            topology: { cnsId: 'late-app:main', neurons: [], collaterals: [], dendrites: [] },
        });

        // Both apps present.
        expect(connectedApps().map(a => a.id).sort()).toEqual([
            'existing-app',
            'late-app',
        ]);
    });
});
