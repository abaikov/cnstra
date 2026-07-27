import { bindable } from '@exodra/reactivity';
import type { TExoWritableBindable } from '@exodra/reactivity';
import type { TExoRouter } from '@exodra/router';
import type { CNSDTOClientMessage } from '@cnstra/devtools-dto';
import { mainCNS } from '../../cns';
import { appModelAxon } from '../../cns/controller-layer/AppModelAxon';
import { db } from '../../model';
import type { TApp } from '../../model';
import {
    readEntitiesByIndexKey,
    subscribeEntitiesByIndexKey,
    readPksByIndexKey,
    subscribePksByIndexKey,
} from '../../exo/oimdb-bind';

// Framework-agnostic port of the old `useAppSelection` React hook: owns the
// app / CNS selection state machine. All state that was React `useState` is now
// a bindable; every `useEffect` becomes explicit subscription wiring. Reuses the
// unchanged data layer (`mainCNS` / `appModelAxon` / `db`).

const genRequestId = (): string =>
    `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export interface AppSelection {
    connectedApps: TExoWritableBindable<TApp[]>;
    selectedAppId: TExoWritableBindable<string | null>;
    selectedCnsId: TExoWritableBindable<string | null>;
    effectiveSelectedAppId: TExoWritableBindable<string | null>;
    /** CNS instance ids available for the currently selected app. */
    cnsIdsForApp: TExoWritableBindable<string[]>;
    selectApp(appId: string): void;
    selectCns(cnsId: string | null): void;
    dispose(): void;
}

export interface CreateAppSelectionParams {
    router: TExoRouter;
    send(message: CNSDTOClientMessage): boolean;
}

/** Extract the `:appId` route param from the current router match/location. */
function routeAppIdFrom(router: TExoRouter): string | undefined {
    const match = router.getMatch();
    const fromParams = match?.params?.appId as string | undefined;
    if (fromParams) return fromParams;
    // Fallback: parse /apps/:appId[/...] straight off the pathname.
    const m = router.getLocation().pathname.match(/^\/apps\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : undefined;
}

export function createAppSelection({
    router,
    send,
}: CreateAppSelectionParams): AppSelection {
    const connectedApps = bindable<TApp[]>([]);
    const selectedAppId = bindable<string | null>(null);
    const selectedCnsId = bindable<string | null>(null);
    const effectiveSelectedAppId = bindable<string | null>(null);
    const cnsIdsForApp = bindable<string[]>([]);

    const unsubs: Array<() => void> = [];

    const readApps = (): TApp[] =>
        readEntitiesByIndexKey(db.apps, db.apps.indexes.all, 'all').filter(
            (a): a is TApp => a != null
        );

    const readSelectedPk = (): string | null =>
        readPksByIndexKey(db.apps.indexes.selected, 'selected')[0] ?? null;

    const readCnsForApp = (appId: string | null): string[] => {
        if (!appId) return [];
        return Array.from(
            (db.cns.indexes.appId.getPksByKey(appId) ??
                new Set<string>()) as Set<string>
        );
    };

    const recomputeEffective = (): void => {
        const next =
            routeAppIdFrom(router) ||
            readSelectedPk() ||
            selectedAppId.getValue() ||
            null;
        effectiveSelectedAppId.setValue(next);
    };

    // Stimulations are no longer pulled per-app here — `createDurableIngest` polls
    // the name-based store (`cns.stimulations.query`) for all scopes. Only topology
    // is requested on selection.
    const requestTopologyAndStimulations = (appId: string): void => {
        send({ type: 'topology.query', requestId: genRequestId(), appId });
    };

    // ── React to the connected-apps set ──────────────────────────────────────
    const onAppsChanged = (): void => {
        const apps = readApps();
        connectedApps.setValue(apps);

        // Auto-select the first app when nothing is selected yet.
        recomputeEffective();
        if (!effectiveSelectedAppId.getValue() && apps.length) {
            selectApp(apps[0].id);
        }
    };
    unsubs.push(
        subscribeEntitiesByIndexKey(
            db.apps,
            db.apps.indexes.all,
            'all',
            onAppsChanged
        )
    );

    // ── React to the DB-driven selected index ────────────────────────────────
    const onSelectedIndexChanged = (): void => {
        const pk = readSelectedPk();
        if (pk && selectedAppId.getValue() !== pk) {
            selectedAppId.setValue(pk);
        }
        recomputeEffective();
    };
    unsubs.push(
        subscribePksByIndexKey(
            db.apps.indexes.selected,
            'selected',
            onSelectedIndexChanged
        )
    );

    // ── React to selectedAppId: refresh CNS list, fetch data ─────────────────
    unsubs.push(
        selectedAppId.subscribe(() => {
            const appId = selectedAppId.getValue();
            const cnsIds = readCnsForApp(appId);
            cnsIdsForApp.setValue(cnsIds);

            const currentCns = selectedCnsId.getValue();
            if (!appId) {
                selectedCnsId.setValue(null);
            } else if (cnsIds.length) {
                if (!currentCns || !cnsIds.includes(currentCns)) {
                    selectedCnsId.setValue(cnsIds[0] ?? null);
                }
            } else {
                selectedCnsId.setValue(null);
            }

            recomputeEffective();
            if (appId) requestTopologyAndStimulations(appId);
        })
    );

    // ── React to route changes (back/forward, direct nav) ────────────────────
    unsubs.push(router.match.subscribe(() => recomputeEffective()));

    function selectApp(appId: string): void {
        selectedAppId.setValue(appId);
        // Route selection through the CNS so the data-layer updates the
        // (manual) apps.selected index.
        try {
            mainCNS.stimulate(
                appModelAxon.selectAppClicked.createSignal({ appId })
            );
        } catch {
            /* selection is best-effort */
        }
        void router.navigate(`/apps/${appId}`);
    }

    function selectCns(cnsId: string | null): void {
        selectedCnsId.setValue(cnsId);
    }

    // Prime from whatever is already in the store.
    onAppsChanged();
    onSelectedIndexChanged();

    return {
        connectedApps,
        selectedAppId,
        selectedCnsId,
        effectiveSelectedAppId,
        cnsIdsForApp,
        selectApp,
        selectCns,
        dispose: () => {
            for (const u of unsubs) u();
            unsubs.length = 0;
        },
    };
}
