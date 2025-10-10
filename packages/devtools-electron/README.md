# CNStra DevTools (Electron)

Desktop app bundling the DevTools WebSocket server and the DevTools Panel UI.

- Starts a local HTTP+WS server on a chosen port (default 8080)
- Loads the Panel UI (dev via webpack-dev-server, prod via built dist)
- Injects `window.__CNSTRA_DEVTOOLS_WS__ = "ws://localhost:<port>"`

## Dev

1. In another terminal, start the Panel UI dev server:
   - workspace: `packages/devtools-panel-ui`
   - command: `npm run dev`
2. Run the Electron app:
```bash
cd packages/devtools-electron
npm run dev
```

## Prod

1. Build the Panel UI:
```bash
npm run build --workspace=@cnstra/devtools-panel-ui
```
2. Start Electron in prod mode:
```bash
cd packages/devtools-electron
npm run start:prod
```

## Port selection

- Default port is 8080. Override via env var:
```bash
CNSTRA_DEVTOOLS_PORT=9090 npm run dev
```

## Packaging

Generate icons:
```bash
npm run gen:icons --workspace=@cnstra/devtools-electron
```

Build installers:
```bash
# mac (dmg, zip)
npm run dist:mac --workspace=@cnstra/devtools-electron
# windows (nsis)
npm run dist:win --workspace=@cnstra/devtools-electron
# linux (AppImage)
npm run dist:linux --workspace=@cnstra/devtools-electron
# all
npm run dist --workspace=@cnstra/devtools-electron
```

Mac App Store (MAS):
```bash
npm run dist:mas --workspace=@cnstra/devtools-electron
# Requires entitlements.mas.plist and provisioning configured
```
