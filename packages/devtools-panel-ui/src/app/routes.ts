import type { TExoRoute } from '@exodra/router';

// The panel has three routes, all rendering the same shell; the main pane is
// derived reactively from `router.location` (Topology vs Stimulations), so the
// route `component` is a no-op placeholder — we use the router purely for
// location tracking, `:appId` param matching, and navigation, not an Outlet.
const noop = (): [] => [];

export const routes: readonly TExoRoute[] = [
    { path: '/apps', component: noop },
    { path: '/apps/:appId', component: noop },
    { path: '/apps/:appId/stimulations', component: noop },
];

/** True when the current pathname is the stimulations view. */
export const isStimulationsPath = (pathname: string): boolean =>
    pathname.endsWith('/stimulations');
