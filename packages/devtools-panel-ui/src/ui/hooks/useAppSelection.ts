import React, { useEffect, useMemo, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import {
    useSelectEntitiesByIndexKeySetBased,
    useSelectPksByIndexKeySetBased,
} from '@oimdb/react';
import { mainCNS } from '../../cns';
import { appModelAxon } from '../../cns/controller-layer/AppModelAxon';
import { db } from '../../model';
import type { TApp } from '../../model';
import type { DevtoolsSocket } from './useDevtoolsSocket';

// Generate an opaque requestId for the request/response query protocol.
const genRequestId = (): string =>
    `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Debounce utility
const debounce = <T extends (...args: any[]) => void>(
    func: T,
    delay: number
): ((...args: Parameters<T>) => void) => {
    let timeoutId: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func(...args), delay);
    };
};

export interface UseAppSelectionParams {
    /** Safe, typed WebSocket send from `useDevtoolsSocket`. */
    send: DevtoolsSocket['send'];
    navigate: NavigateFunction;
    /** The `:appId` route param, if present. */
    routeAppId: string | undefined;
}

export interface UseAppSelection {
    connectedApps: TApp[];
    selectedAppId: string | null;
    selectedCnsId: string | null;
    effectiveSelectedAppId: string | null;
    /** Handle a user click on an app: update state, notify the CNS, and route. */
    selectApp: (appId: string) => void;
    /** Update the selected CNS instance for the current app. */
    selectCns: (cnsId: string | null) => void;
}

/**
 * Owns the app / CNS selection state machine: which app and CNS instance are
 * active, keeping local state in sync with the `apps.selected` DB index, and
 * firing `topology.query` / `stimulations.query` for the current selection.
 */
export const useAppSelection = ({
    send,
    navigate,
    routeAppId,
}: UseAppSelectionParams): UseAppSelection => {
    const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
    const [selectedCnsId, setSelectedCnsId] = useState<string | null>(null);
    // Tracks whether CNS data has been (re)requested for the current app.
    const [, setCnsDataLoaded] = useState<boolean>(false);

    const connectedAppsRaw = useSelectEntitiesByIndexKeySetBased(
        db.apps,
        db.apps.indexes.all,
        'all'
    );
    const connectedApps = useMemo(
        () =>
            (connectedAppsRaw || []).filter(
                (a): a is NonNullable<typeof a> => a != null
            ),
        [connectedAppsRaw]
    );

    // CNS list for selected app
    const cnsIdsForApp = useMemo(() => {
        if (!selectedAppId) return [] as string[];
        const pks = (db.cns.indexes.appId.getPksByKey(selectedAppId) ||
            new Set()) as Set<string>;
        return Array.from(pks);
    }, [selectedAppId]);

    // Debounced request stimulations function
    const debouncedRequestStimulations = useMemo(
        () =>
            debounce((apps: readonly any[]) => {
                if (!apps || apps.length === 0) return;
                apps.forEach(app => {
                    send({
                        type: 'stimulations.query',
                        requestId: genRequestId(),
                        appId: app.id,
                        filter: { limit: 1000 },
                    });
                });
            }, 1000),
        [send]
    );

    // Request stimulations when apps are connected
    useEffect(() => {
        if (connectedApps && connectedApps.length > 0) {
            debouncedRequestStimulations(connectedApps);
        }
    }, [connectedApps, debouncedRequestStimulations]);

    // Observe selected app id from DB index (single selection)
    const selectedAppPksSet = useSelectPksByIndexKeySetBased(
        db.apps.indexes.selected,
        'selected'
    );
    const selectedAppPks = useMemo(
        () => (selectedAppPksSet ? Array.from(selectedAppPksSet) : []),
        [selectedAppPksSet]
    );
    const effectiveSelectedAppId =
        routeAppId || selectedAppPks[0] || selectedAppId || null;

    // Auto-select first app if none selected and apps are available
    useEffect(() => {
        if (
            !effectiveSelectedAppId &&
            connectedApps &&
            connectedApps.length > 0
        ) {
            const appId = connectedApps[0].id;
            setSelectedAppId(appId);
            // Route selection through the CNS so the data-layer updates the
            // (manual) apps.selected index.
            try {
                mainCNS.stimulate(
                    appModelAxon.selectAppClicked.createSignal({ appId })
                );
            } catch {}
            // ensure URL reflects selection
            if (!routeAppId) navigate(`/apps/${appId}`);
        }
    }, [connectedApps, effectiveSelectedAppId]);

    // Keep local state in sync with DB-selected index
    useEffect(() => {
        if (
            selectedAppPks &&
            selectedAppPks[0] &&
            selectedAppId !== selectedAppPks[0]
        ) {
            setSelectedAppId(selectedAppPks[0]);
        }
    }, [selectedAppPks]);

    // Auto-select first CNS if none selected or selection invalid
    useEffect(() => {
        if (!selectedAppId) {
            setSelectedCnsId(null);
            setCnsDataLoaded(false);
            return;
        }
        if (cnsIdsForApp.length > 0) {
            if (!selectedCnsId || !cnsIdsForApp.includes(selectedCnsId)) {
                setSelectedCnsId(cnsIdsForApp[0] || null);
            }
        } else {
            setSelectedCnsId(null);
        }
    }, [selectedAppId, cnsIdsForApp]);

    // Fetch topology and data for selected app/CNS via REST-over-WS
    useEffect(() => {
        if (!selectedAppId) return;

        // Reset CNS data loaded state
        setCnsDataLoaded(false);

        // Request topology (neurons/collaterals/dendrites) for the selected app.
        send({
            type: 'topology.query',
            requestId: genRequestId(),
            appId: selectedAppId,
        });

        // Request stimulations for the selected app
        send({
            type: 'stimulations.query',
            requestId: genRequestId(),
            appId: selectedAppId,
            filter: { limit: 1000 },
        });
    }, [selectedAppId, send]);

    const selectApp = React.useCallback(
        (appId: string) => {
            setSelectedAppId(appId);
            // route selection through CNS so data-layer updates indexes
            try {
                const signal = appModelAxon.selectAppClicked.createSignal({
                    appId,
                });
                mainCNS.stimulate(signal);
            } catch {}
            navigate(`/apps/${appId}`);
        },
        [navigate]
    );

    const selectCns = React.useCallback((cnsId: string | null) => {
        setSelectedCnsId(cnsId);
    }, []);

    return {
        connectedApps,
        selectedAppId,
        selectedCnsId,
        effectiveSelectedAppId,
        selectApp,
        selectCns,
    };
};
