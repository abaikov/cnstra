/**
 * Late-joining apps: the panel is already running and a new app appears — via an
 * `app.connected` broadcast or an `apps.result` list. Drives the real pipeline
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

const makeApp = (id: string, name: string, version = '1.0.0'): TCNSAppDTO => ({
    id,
    name,
    version,
});

const appConnected = (app: TCNSAppDTO): TCNSServerMessageDTO => ({
    type: 'app.connected',
    app,
    topology: {
        cnsId: `${app.id}:main`,
        neurons: [],
        collaterals: [],
        dendrites: [],
    },
});

const connectedApps = () => db.allApps.getEntitiesByKey('all');

const clearApps = () => {
    for (const app of connectedApps()) db.apps.deleteEntityByKey(app.id);
};

describe('Late-Joining Apps', () => {
    beforeEach(() => clearApps());

    it('adds a newly connected app to the database', async () => {
        const existing = makeApp('existing-app', 'Existing App');
        db.apps.upsertEntityByKey(existing.id, existing);
        expect(connectedApps().length).toBe(1);

        await feed(appConnected(makeApp('new-app', 'New App', '2.0.0')));

        const apps = connectedApps();
        expect(apps.length).toBe(2);
        const newApp = apps.find(a => a.id === 'new-app');
        expect(newApp).toBeDefined();
        expect(newApp?.name).toBe('New App');
        expect(newApp?.version).toBe('2.0.0');
    });

    it('ingests a full apps list (apps.result)', async () => {
        await feed({
            type: 'apps.result',
            requestId: 'r1',
            items: [
                makeApp('existing-app', 'Existing App'),
                makeApp('new-app', 'New App'),
            ],
        });

        const apps = connectedApps();
        expect(apps.length).toBe(2);
        expect(apps.map(a => a.id).sort()).toEqual(['existing-app', 'new-app']);
    });

    it('handles multiple apps joining one by one', async () => {
        expect(connectedApps().length).toBe(0);

        const specs = [
            { id: 'app-1', name: 'App One' },
            { id: 'app-2', name: 'App Two' },
            { id: 'app-3', name: 'App Three' },
        ];
        for (let i = 0; i < specs.length; i++) {
            await feed(appConnected(makeApp(specs[i].id, specs[i].name)));
            expect(connectedApps().length).toBe(i + 1);
        }

        expect(connectedApps().map(a => a.id).sort()).toEqual([
            'app-1',
            'app-2',
            'app-3',
        ]);
    });

    it('removes an app on app.disconnected', async () => {
        await feed(appConnected(makeApp('app-x', 'App X')));
        expect(connectedApps().length).toBe(1);

        await feed({ type: 'app.disconnected', appId: 'app-x' });
        expect(connectedApps().length).toBe(0);
    });
});
