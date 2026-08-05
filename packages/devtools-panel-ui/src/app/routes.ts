import type { TExoRoute } from '@exodra/router';

// The panel is a single surface: the faceted Explorer. The router is used purely
// for location tracking and query-string round-tripping (the Explorer writes its
// shareable query-state to `/explorer?…`), not as an Outlet — so the route
// `component` is a no-op placeholder.
const noop = (): [] => [];

export const routes: readonly TExoRoute[] = [
    { path: '/explorer', component: noop },
];

/** True when the current pathname is the faceted explorer. */
export const isExplorerPath = (pathname: string): boolean =>
    pathname.startsWith('/explorer');
