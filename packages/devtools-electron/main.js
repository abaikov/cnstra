const { app, BrowserWindow, dialog, ipcMain, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

// Lazy import server core to keep startup fast
let DevToolsCore = null;
const servers = new Map(); // port -> { server, wss, devToolsServer }

// Set human-friendly app name for menus/dock
try { app.setName('CNStra DevTools'); } catch {}

const DEFAULT_PORT = Number(process.env.CNSTRA_DEVTOOLS_PORT || 8080);
const IS_DEV = process.env.DEV === '1' || process.env.DEV === 'true';

/**
 * Ensure a port is available; return the first available starting from desired.
 */
async function findAvailablePort(startPort) {
  const isFree = (port) => new Promise((resolve) => {
    const srv = http.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
  let p = startPort;
  for (let i = 0; i < 50; i++) {
    // try up to 50 ports ahead
    // eslint-disable-next-line no-await-in-loop
    if (await isFree(p)) return p;
    p++;
  }
  return startPort;
}

/**
 * Start HTTP + WS DevTools server using @cnstra/devtools-server core.
 */
async function startDevToolsServer(port) {
  const server = http.createServer(async (req, res) => {
    try {
      // In dev we just redirect to webpack-dev-server assets
      if (IS_DEV) {
        res.writeHead(302, { Location: `http://localhost:5173` });
        res.end();
        return;
      }
      // In prod, serve built panel UI from @cnstra/devtools-panel-ui/dist
      const uiDist = path.resolve(__dirname, '..', 'devtools-panel-ui', 'dist');
      let filePath = path.join(
        uiDist,
        !req?.url || req.url === '/' ? 'index.html' : req.url
      );
      const fs = require('fs');
      if (!fs.existsSync(filePath)) filePath = path.join(uiDist, 'index.html');
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('DevTools Panel UI not found. Build @cnstra/devtools-panel-ui.');
        return;
      }
      const content = fs.readFileSync(filePath);
      const ext = (filePath.split('.').pop() || '').toLowerCase();
      const contentTypes = { html: 'text/html', js: 'application/javascript', css: 'text/css' };
      res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end('Server error');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const wss = new WebSocketServer({ server });

  try {
    if (!DevToolsCore) {
      DevToolsCore = {
        CNSDevToolsServer: require('@cnstra/devtools-server').CNSDevToolsServer,
        CNSDevToolsServerRepositoryInMemory: require('@cnstra/devtools-server-repository-in-memory').CNSDevToolsServerRepositoryInMemory,
      };
    }
    const repository = new DevToolsCore.CNSDevToolsServerRepositoryInMemory();
    const devToolsServer = new DevToolsCore.CNSDevToolsServer(repository);

    const messageBuffer = [];

    async function processMessage(ws, message) {
      const res = await devToolsServer.handleMessage(ws, message);
      if (res) {
        const payload = JSON.stringify(res);
        wss.clients.forEach((client) => {
          if (client.readyState === 1) client.send(payload);
        });
      }
      if (message?.type === 'init') {
        const initPayload = JSON.stringify(message);
        wss.clients.forEach((client) => {
          if (client.readyState === 1) client.send(initPayload);
        });
      }
    }

    wss.on('connection', (ws) => {
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(String(data));
          if (message?.type === 'batch' && Array.isArray(message.items)) {
            for (const item of message.items) {
              const payload = item.payload || item;
              // eslint-disable-next-line no-await-in-loop
              await processMessage(ws, payload);
            }
            return;
          }
          await processMessage(ws, message);
        } catch {
          // ignore
        }
      });
      ws.on('close', () => devToolsServer.handleDisconnect(ws));
    });
  } catch (e) {
    // If devtools-server packages are missing, keep only static hosting
    console.warn('[DevTools] server core not available:', e?.message);
  }

  return { server, wss, port };
}

async function createPanelWindow(effectivePort) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: `CNStra DevTools (${effectivePort})`,
  });

  const wsUrl = `ws://localhost:${effectivePort}`;
  // Ensure WS URL is injected after page load so the renderer reads it reliably
  win.webContents.on('did-finish-load', () => {
    win.webContents
      .executeJavaScript(
        `window.__CNSTRA_DEVTOOLS_WS__ = ${JSON.stringify(wsUrl)};`
      )
      .catch(() => {});
  });

  if (IS_DEV) {
    await win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.resolve(__dirname, '..', 'devtools-panel-ui', 'dist', 'index.html');
    await win.loadFile(indexPath);
  }
}

async function createManagerWindow() {
  // Try to set app icon (mac dock uses app.setIcon on linux/win, mac uses template)
  try {
    const logoPath = path.resolve(__dirname, '..', '..', 'docs', 'static', 'img', 'logo.svg');
    const img = nativeImage.createFromPath(logoPath);
    if (!img.isEmpty()) app.dock?.setIcon?.(img);
  } catch {}

  const win = new BrowserWindow({
    width: 900,
    height: 620,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'CNStra DevTools Manager',
    icon: (() => {
      try {
        const p = path.resolve(__dirname, '..', '..', 'docs', 'static', 'img', 'logo.svg');
        const img = nativeImage.createFromPath(p);
        return img.isEmpty() ? undefined : img;
      } catch { return undefined; }
    })(),
  });
  await win.loadFile(path.join(__dirname, 'manager.html'));
}

// IPC wiring for manager
ipcMain.handle('mgr:list', async () => {
  return Array.from(servers.keys()).map((port) => ({ port, status: 'running' }));
});

ipcMain.handle('mgr:findPort', async (_e, startPort) => {
  const port = await findAvailablePort(Number(startPort || DEFAULT_PORT));
  return { port };
});

ipcMain.handle('mgr:start', async (_e, maybePort) => {
  const desired = Number(maybePort || DEFAULT_PORT);
  const port = await findAvailablePort(desired);
  if (servers.has(port)) return { port, alreadyRunning: true };
  const { server, wss } = await startDevToolsServer(port);
  // store devToolsServer via closure in startDevToolsServer by attaching listener on wss
  servers.set(port, { server, wss });
  return { port };
});

ipcMain.handle('mgr:stop', async (_e, port) => {
  const entry = servers.get(Number(port));
  if (!entry) return { stopped: false };
  try {
    try { entry.wss?.close(); } catch {}
    await new Promise((resolve) => entry.server.close(() => resolve()));
  } catch {}
  servers.delete(Number(port));
  return { stopped: true };
});

ipcMain.handle('mgr:openPanel', async (_e, port) => {
  await createPanelWindow(Number(port));
  return { opened: true };
});

app.whenReady().then(async () => {
  try {
    await createManagerWindow();
  } catch (e) {
    dialog.showErrorBox('CNStra DevTools failed to start', String(e?.message || e));
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createManagerWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  const ports = Array.from(servers.keys());
  for (const p of ports) {
    const entry = servers.get(p);
    try { entry?.wss?.close(); } catch {}
    try { await new Promise((resolve) => entry?.server?.close(() => resolve())); } catch {}
    servers.delete(p);
  }
});


