import type { TExoRoute } from '@exodra/router';

// The panel is a single surface: the faceted Explorer. It lives at the ROOT (`/`),
// so a shareable URL is just `#/?…` — the `/explorer` segment was a leftover from
// the old multi-page panel (sidebar + App/Decay pages, since removed). The router
// is used purely for location tracking and query-string round-tripping, not as an
// Outlet — so `component` is a no-op placeholder. `/explorer` is kept as an alias
// so previously-shared links keep resolving.
const noop = (): [] => [];

export const routes: readonly TExoRoute[] = [
    { path: '/', component: noop },
    { path: '/explorer', component: noop }, // legacy alias
];

/** True when the current pathname is the (single) explorer surface. */
export const isExplorerPath = (pathname: string): boolean =>
    pathname === '/' || pathname.startsWith('/explorer');
