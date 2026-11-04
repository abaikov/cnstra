# @cnstra/devtools-panel-react

The CNStra DevTools panel as a React component, for the admin you already have.

📚 **[Full Documentation](https://cnstra.org/)** | [Admin Guide](https://cnstra.org/docs/devtools/admin)

## Installation

```bash
npm install @cnstra/devtools-panel-react @cnstra/devtools-panel-ui @cnstra/core @cnstra/devtools-dto @cnstra/sync @cnstra/oimdb @cnstra/exodra @cnstra/persist-dto @cnstra/types @exodra/core @exodra/dom @exodra/jsx @exodra/context @exodra/list-reconcile @oimdb/core @oimdb/browser @oimdb/exodra
```

The panel's runtime packages are peer dependencies: your app has one copy of each,
and the panel shares it.

## Usage

Mount `createCNSDevToolsHandler` from `@cnstra/devtools-server` under a path of your
server, behind your own auth, then point the component at that path:

```tsx file=AdminCNStra.tsx
import { CNSDevToolsPanel } from '@cnstra/devtools-panel-react';
import '@cnstra/devtools-panel-ui/embed.css';

export function AdminCNStra() {
    return <CNSDevToolsPanel url="/admin/cnstra" style={{ height: '80vh' }} />;
}
```

The panel fills the height of its div, so give the div one.

If your app already uses OIMDB, pass its database and the panel puts its schema into
it instead of creating its own:

```tsx file=AdminCNStraInAppDb.tsx
import { OIMDB } from '@oimdb/core';
import { CNSDevToolsPanel } from '@cnstra/devtools-panel-react';

declare const appDb: OIMDB;

export function AdminCNStraInAppDb() {
    return <CNSDevToolsPanel url="/admin/cnstra" db={appDb} style={{ height: '80vh' }} />;
}
```

Unmounting the panel disposes what the panel created and leaves your database open.

## Props

| prop | what |
| --- | --- |
| `url` | the base URL the handler is mounted at, absolute or relative to the page |
| `transport` | `'polling'` (default) or `'socket'`; a socket needs `webSocket.authorizeUpgrade` on the handler |
| `isReadOnly` | hides Retry and Clone; the handler's own `readOnly` is what actually refuses them |
| `db` | your app's `OIMDB`; without it the panel creates and disposes its own |
| `location` | where the panel keeps its navigation: `'memory'` (default) or `'hash'` |
| `className`, `style` | passed to the outer div; the panel renders into an inner div of full height |

Changing `url`, `transport`, `isReadOnly`, `location` or `db` unmounts the panel and mounts it again.

With `'memory'` the panel keeps its navigation inside itself and never touches the
page's URL, so your router's hash is safe and several panels can share a page. With
`'hash'` the panel writes the page's URL hash when it connects (the default time
window the server sends) and on every navigation, so it overwrites your hash; mount
at most one such panel per page.

The panel itself is an Exodra bundle in `@cnstra/devtools-panel-ui`: it does not
render through React.

## License

MIT
