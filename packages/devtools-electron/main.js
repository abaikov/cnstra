const { app, BrowserWindow, dialog, ipcMain, nativeImage, Menu } = require('electron');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

// Lazy import server core to keep startup fast
let DevToolsCore = null;
const servers = new Map(); // port -> { server, wss, devToolsServer }
const panelWindows = new Map(); // port -> BrowserWindow[]

// Set human-friendly app name for menus/dock
try { app.setName('CNStra DevTools'); } catch {}

const DEFAULT_PORT = Number(process.env.CNSTRA_DEVTOOLS_PORT || 8080);
const IS_DEV = process.env.DEV === '1' || process.env.DEV === 'true';

/**
 * Create application menu with DevTools options
 */
function createMenu() {
  const template = [
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Developer Tools',
          accelerator: 'F12',
          click: () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if (focusedWindow) {
              focusedWindow.webContents.toggleDevTools();
            }
          }
        },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if (focusedWindow) {
              focusedWindow.reload();
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

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
      // In prod, serve built panel UI from resources (copied during build)
      const uiDist = path.resolve(process.resourcesPath, 'devtools-panel-ui', 'dist');
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

  // Register panel window for this port
  if (!panelWindows.has(effectivePort)) {
    panelWindows.set(effectivePort, []);
  }
  panelWindows.get(effectivePort).push(win);

  // Remove window from tracking when it's closed
  win.on('closed', () => {
    const windows = panelWindows.get(effectivePort);
    if (windows) {
      const index = windows.indexOf(win);
      if (index > -1) {
        windows.splice(index, 1);
      }
      if (windows.length === 0) {
        panelWindows.delete(effectivePort);
      }
    }
    console.log(`[CNStra DevTools] Panel window closed for port ${effectivePort}`);
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
    const indexPath = path.resolve(process.resourcesPath, 'devtools-panel-ui', 'dist', 'index.html');
    await win.loadFile(indexPath);
    // Открываем DevTools в production для отладки
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

async function createManagerWindow() {
  // Try to set app icon (mac dock uses app.setIcon on linux/win, mac uses template)
  try {
    const logoPath = IS_DEV
      ? path.resolve(__dirname, '..', '..', 'docs', 'static', 'img', 'logo.svg')
      : path.resolve(process.resourcesPath, 'img', 'logo.svg');
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
        const p = IS_DEV
          ? path.resolve(__dirname, '..', '..', 'docs', 'static', 'img', 'logo.svg')
          : path.resolve(process.resourcesPath, 'img', 'logo.svg');
        const img = nativeImage.createFromPath(p);
        return img.isEmpty() ? undefined : img;
      } catch { return undefined; }
    })(),
  });
  await win.loadFile(path.join(__dirname, 'manager.html'));
  
  // Открываем DevTools для Manager окна
  win.webContents.openDevTools({ mode: 'detach' });
}

// IPC wiring for manager
ipcMain.handle('mgr:list', async () => {
  return Array.from(servers.keys()).map((port) => ({
    port,
    status: 'running',
    windowCount: (panelWindows.get(port) || []).filter((w) => !w.isDestroyed()).length,
  }));
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
  console.log('[CNStra DevTools] Stop request for port:', port);
  const portNum = Number(port);
  const entry = servers.get(portNum);
  if (!entry) {
    console.log('[CNStra DevTools] No server found for port:', port);
    return { stopped: false };
  }
  
  try {
    console.log('[CNStra DevTools] Closing WebSocket server...');
    if (entry.wss) {
      entry.wss.close();
      console.log('[CNStra DevTools] WebSocket server closed');
    }
    
    console.log('[CNStra DevTools] Closing HTTP server...');
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log('[CNStra DevTools] Server close timeout, forcing...');
        resolve();
      }, 2000);
      
      entry.server.close((err) => {
        clearTimeout(timeout);
        if (err) {
          console.log('[CNStra DevTools] Error closing server:', err);
          reject(err);
        } else {
          console.log('[CNStra DevTools] HTTP server closed successfully');
          resolve();
        }
      });
    });
  } catch (e) {
    console.log('[CNStra DevTools] Error stopping server:', e);
  } finally {
    // Close all panel windows for this port
    const windows = panelWindows.get(portNum);
    if (windows && windows.length > 0) {
      console.log(`[CNStra DevTools] Closing ${windows.length} panel window(s) for port ${portNum}`);
      windows.forEach(win => {
        if (!win.isDestroyed()) {
          win.close();
        }
      });
      panelWindows.delete(portNum);
    }
    
    servers.delete(portNum);
    console.log('[CNStra DevTools] Server removed from map');
  }
  
  return { stopped: true };
});

ipcMain.handle('mgr:openPanel', async (_e, port) => {
  await createPanelWindow(Number(port));
  return { opened: true };
});

ipcMain.handle('mgr:listWindows', async () => {
  const result = [];
  for (const [port, windows] of panelWindows.entries()) {
    // Filter out destroyed windows
    const activeWindows = windows.filter(win => !win.isDestroyed());
    if (activeWindows.length > 0) {
      result.push({ port, count: activeWindows.length });
    }
  }
  return result;
});

ipcMain.handle('mgr:closeAllWindows', async (_e, port) => {
  const portNum = Number(port);
  const windows = panelWindows.get(portNum);
  if (!windows || windows.length === 0) {
    return { closed: 0 };
  }
  
  console.log(`[CNStra DevTools] Closing ${windows.length} panel window(s) for port ${portNum}`);
  let closedCount = 0;
  windows.forEach(win => {
    if (!win.isDestroyed()) {
      win.close();
      closedCount++;
    }
  });
  
  // Clean up the array
  panelWindows.delete(portNum);
  
  return { closed: closedCount };
});

ipcMain.handle('mgr:paths', async () => {
  const path = require('path');
  const fs = require('fs');
  const isDev = IS_DEV;
  
  console.log('[CNStra DevTools] Getting paths, isDev:', isDev);
  
  let logoPath, fontPath;
  if (isDev) {
    logoPath = path.resolve(__dirname, '..', '..', 'docs', 'static', 'img', 'logo.svg');
    fontPath = path.resolve(__dirname, '..', '..', 'docs', 'static', 'fonts', 'Px437_IBM_Conv.ttf');
  } else {
    // In packaged app, resources are copied to process.resourcesPath
    logoPath = path.resolve(process.resourcesPath, 'img', 'logo.svg');
    fontPath = path.resolve(process.resourcesPath, 'fonts', 'Px437_IBM_Conv.ttf');
  }
  
  console.log('[CNStra DevTools] Logo path:', logoPath, 'exists:', fs.existsSync(logoPath));
  console.log('[CNStra DevTools] Font path:', fontPath, 'exists:', fs.existsSync(fontPath));
  
  function toFileUrl(absPath) {
    // Check if file exists before creating URL
    if (!fs.existsSync(absPath)) {
      console.log('[CNStra DevTools] File does not exist:', absPath);
      return null;
    }
    
    // Use simple file:// URL - works fine in Electron
    const normalized = absPath.replace(/\\/g, '/');
    const fileUrl = `file://${normalized}`;
    console.log('[CNStra DevTools] Generated file URL:', fileUrl);
    return fileUrl;
  }
  
  const result = {
    logoFileUrl: toFileUrl(logoPath),
    fontFileUrl: toFileUrl(fontPath),
    logoPath,
    fontPath,
  };
  
  console.log('[CNStra DevTools] Returning paths result:');
  console.log('[CNStra DevTools] - logoFileUrl type:', typeof result.logoFileUrl, result.logoFileUrl ? 'data URL' : 'null');
  console.log('[CNStra DevTools] - fontFileUrl type:', typeof result.fontFileUrl, result.fontFileUrl ? 'data URL' : 'null');
  return result;
});

app.whenReady().then(async () => {
  console.log('[CNStra DevTools] App ready, starting...');
  
  // Create application menu
  createMenu();
  
  try {
    console.log('[CNStra DevTools] Creating manager window...');
    await createManagerWindow();
    console.log('[CNStra DevTools] Manager window created successfully');
  } catch (e) {
    console.error('[CNStra DevTools] Failed to start:', e);
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
  
  // Close all panel windows
  for (const [port, windows] of panelWindows.entries()) {
    console.log(`[CNStra DevTools] Closing ${windows.length} panel window(s) for port ${port}`);
    windows.forEach(win => {
      if (!win.isDestroyed()) {
        win.close();
      }
    });
  }
  panelWindows.clear();
});


