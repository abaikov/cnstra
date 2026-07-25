import type { TExoHistory } from '@exodra/router';

// Hash-based history for @exodra/router. The DevTools panel is loaded by
// devtools-electron via `win.loadFile(.../dist/index.html)` over the file://
// protocol, where the History API (pushState with real paths) does not work —
// which is why the React version used react-router's HashRouter. @exodra/router
// ships no hash mode, so we implement the tiny TExoHistory contract over
// `location.hash`. The path lives after the '#': `#/apps/foo` → pathname
// `/apps/foo`. Empty hash is treated as '/'.
//
// TExoHistory (exodra/packages/router/src/types/index.ts):
//   getLocation(): TExoLocation  — the router parses the string we hand back via
//   createHref/push/replace, so getLocation returns the current hash path string
//   parsed by the router itself. We return the raw path; the router's own
//   parsePath turns it into a TExoLocation. To stay faithful to the interface we
//   parse here with the same shape the router expects.

function readHashPath(win: Window): string {
    const raw = win.location.hash.slice(1); // strip leading '#'
    if (!raw || raw === '') return '/';
    return raw.startsWith('/') ? raw : `/${raw}`;
}

function parseLocation(path: string) {
    const hashIndex = path.indexOf('#');
    const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
    const hash = hashIndex >= 0 ? path.slice(hashIndex) : '';
    const searchIndex = withoutHash.indexOf('?');
    const pathname = searchIndex >= 0 ? withoutHash.slice(0, searchIndex) : withoutHash;
    const search = searchIndex >= 0 ? withoutHash.slice(searchIndex) : '';
    const href = `${pathname}${search}${hash}`;
    return { pathname: pathname || '/', search, hash, href };
}

export function createHashHistory(win: Window = window): TExoHistory {
    const subscribers = new Set<() => void>();
    const notify = () => subscribers.forEach(fn => fn());

    const onHashChange = () => notify();
    win.addEventListener('hashchange', onHashChange);

    return {
        getLocation() {
            return parseLocation(readHashPath(win));
        },
        createHref(to: string) {
            const path = to.startsWith('/') ? to : `/${to}`;
            return `#${path}`;
        },
        push(to: string) {
            const path = to.startsWith('/') ? to : `/${to}`;
            // Setting location.hash fires 'hashchange' (→ notify) when the value
            // actually changes; notify manually when it does not so the router
            // still reconciles a same-path navigation.
            const next = `#${path}`;
            if (win.location.hash === next) {
                notify();
            } else {
                win.location.hash = next;
            }
        },
        replace(to: string) {
            const path = to.startsWith('/') ? to : `/${to}`;
            const url = `${win.location.pathname}${win.location.search}#${path}`;
            win.history.replaceState(null, '', url);
            notify();
        },
        subscribe(update: () => void) {
            subscribers.add(update);
            return () => {
                subscribers.delete(update);
            };
        },
        dispose() {
            win.removeEventListener('hashchange', onHashChange);
            subscribers.clear();
        },
    };
}
