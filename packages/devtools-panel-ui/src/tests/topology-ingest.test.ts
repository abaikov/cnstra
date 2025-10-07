import { describe, it, expect } from '@jest/globals';
import { mainCNS } from '../cns';
import { appModelAxon } from '../cns/controller-layer/AppModelAxon';
import { db, dbEventQueue } from '../model';

describe('Topology ingestion via init', () => {
    it('writes neurons and dendrites to OIMDB and indexes by appId', async () => {
        const appId = `app-${Date.now()}`;
        const init = {
            type: 'init',
            devToolsInstanceId: appId,
            appName: 'Topo UI Test',
            version: '0.0.1',
            timestamp: Date.now(),
            neurons: [{ name: 'in' }, { name: 'proc' }, { name: 'out' }],
            collaterals: [{ name: 'cIn' }, { name: 'cMid' }, { name: 'cOut' }],
            dendrites: [
                { neuronName: 'proc', collateralName: 'cIn' },
                { neuronName: 'out', collateralName: 'cMid' },
            ],
        } as any;

        // Stimulate CNS directly with devtools:init collateral
        await mainCNS.stimulate(appModelAxon.devtoolsInit.createSignal(init));
        dbEventQueue.flush();

        const neuronPks = db.neurons.indexes.appId.getPksByKey(appId);
        expect(neuronPks ? Array.from(neuronPks).length : 0).toBe(3);

        const dendritePks = db.dendrites.indexes.appId.getPksByKey(appId);
        expect(dendritePks ? Array.from(dendritePks).length : 0).toBe(2);
    });
});
