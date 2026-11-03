import { bindable } from '@exodra/reactivity';
import type { TExoWritableBindable } from '@exodra/reactivity';
import type { TExoRouter } from '@exodra/router';
import type { TCNSAppDTO } from '@cnstra/devtools-dto';
import { effect } from '@oimdb/core/oimdb';
import { db } from '../../model/db';

export interface AppSelection {
    connectedApps: TExoWritableBindable<TCNSAppDTO[]>;
    effectiveSelectedAppId: TExoWritableBindable<string | null>;
    dispose(): void;
}

export interface CreateAppSelectionParams {
    router: TExoRouter;
}

function routeAppIdFrom(router: TExoRouter): string | undefined {
    const match = router.getMatch();
    const fromParams = match?.params?.appId as string | undefined;
    if (fromParams) return fromParams;
    const m = router.getLocation().pathname.match(/^\/apps\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : undefined;
}

export function createAppSelection({ router }: CreateAppSelectionParams): AppSelection {
    const connectedApps = bindable<TCNSAppDTO[]>([]);
    const effectiveSelectedAppId = bindable<string | null>(null);
    let selectedAppId: string | null = null;

    const recomputeEffective = (): void => {
        effectiveSelectedAppId.setValue(routeAppIdFrom(router) || selectedAppId || null);
    };

    const onAppsChanged = (): void => {
        const apps = db.allApps.getEntitiesByKey('all');
        connectedApps.setValue(apps);
        if (!routeAppIdFrom(router) && !selectedAppId && apps.length) selectedAppId = apps[0].id;
        recomputeEffective();
    };

    const unsubs = [
        router.match.subscribe(recomputeEffective),
        effect(onAppsChanged, [db.allApps.getSlotByKey('all')]),
    ];

    return {
        connectedApps,
        effectiveSelectedAppId,
        dispose: () => {
            for (const unsub of unsubs) unsub();
            unsubs.length = 0;
        },
    };
}
