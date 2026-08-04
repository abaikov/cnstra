import type { TExoRoute } from '@exodra/router';

// The panel routes all render the same shell; the main pane is derived reactively
// from `router.location` (Topology vs Explorer), so the route `component` is a
// no-op placeholder — the router is used purely for location tracking, `:appId`
// param matching, and navigation, not an Outlet.
const noop = (): [] => [];

export const routes: readonly TExoRoute[] = [
    { path: '/apps', component: noop },
    { path: '/apps/:appId', component: noop },
    { path: '/explorer', component: noop },
];

/** True when the current pathname is the faceted explorer. */
export const isExplorerPath = (pathname: string): boolean =>
    pathname.startsWith('/explorer');
