import { describe, it, expect, afterEach } from '@jest/globals';
import { bindable } from '@exodra/reactivity';
import type { TExoRouter } from '@exodra/router';
import type { TCNSAppDTO } from '@cnstra/devtools-dto';
import { db } from '../../../model/db';
import { createAppSelection } from '.././selection';

const makeApp = (id: string): TCNSAppDTO => ({ id, name: id, version: '1.0.0' });

const routerAt = (pathname: string) => {
    const match = bindable<{ params: Record<string, string> } | null>(null);
    const location = { pathname };
    const router = {
        match,
        getMatch: () => match.getValue(),
        getLocation: () => location,
    } as unknown as TExoRouter;
    return { router, match, location };
};

const settle = (): Promise<void> => Promise.resolve();

const created: Array<{ dispose(): void }> = [];

afterEach(() => {
    for (const selection of created.splice(0)) selection.dispose();
    for (const app of db.allApps.getEntitiesByKey('all')) db.apps.deleteEntityByKey(app.id);
});

describe('createAppSelection', () => {
    it('lists the apps already stored and selects the first one', () => {
        db.apps.upsertEntityByKey('a', makeApp('a'));
        db.apps.upsertEntityByKey('b', makeApp('b'));
        const selection = createAppSelection({ router: routerAt('/').router });
        created.push(selection);

        expect(selection.connectedApps.getValue().map(app => app.id)).toEqual(['a', 'b']);
        expect(selection.effectiveSelectedAppId.getValue()).toBe('a');
    });

    it('follows apps that connect and disconnect later, keeping the first selection', async () => {
        const selection = createAppSelection({ router: routerAt('/').router });
        created.push(selection);
        expect(selection.effectiveSelectedAppId.getValue()).toBeNull();

        db.apps.upsertEntityByKey('late', makeApp('late'));
        await settle();
        expect(selection.connectedApps.getValue().map(app => app.id)).toEqual(['late']);
        expect(selection.effectiveSelectedAppId.getValue()).toBe('late');

        db.apps.upsertEntityByKey('later', makeApp('later'));
        db.apps.deleteEntityByKey('late');
        await settle();
        expect(selection.connectedApps.getValue().map(app => app.id)).toEqual(['later']);
        expect(selection.effectiveSelectedAppId.getValue()).toBe('late');
    });

    it('lets the app named by the route override the selected one', () => {
        db.apps.upsertEntityByKey('a', makeApp('a'));
        const { router, match, location } = routerAt('/');
        const selection = createAppSelection({ router });
        created.push(selection);
        expect(selection.effectiveSelectedAppId.getValue()).toBe('a');

        location.pathname = '/apps/b';
        match.setValue({ params: { appId: 'b' } });
        expect(selection.effectiveSelectedAppId.getValue()).toBe('b');
    });

    it('stops following the store once disposed', async () => {
        const selection = createAppSelection({ router: routerAt('/').router });
        selection.dispose();

        db.apps.upsertEntityByKey('a', makeApp('a'));
        await settle();
        expect(selection.connectedApps.getValue()).toEqual([]);
    });
});
