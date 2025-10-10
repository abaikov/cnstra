const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

function toFileUrl(absPath) {
  // Basic file:// URL for mac/linux (sufficient for our dev env)
  const normalized = absPath.replace(/\\/g, '/');
  return `file://${normalized}`;
}

// We expose a minimal API (if needed later). For now, injection is done from main.js.
contextBridge.exposeInMainWorld('__CNSTRA_DEVTOOLS_BRIDGE__', {
  async list() {
    const items = await ipcRenderer.invoke('mgr:list');
    return { items };
  },
  async findPort(startPort) {
    return await ipcRenderer.invoke('mgr:findPort', startPort);
  },
  async start(port) {
    return await ipcRenderer.invoke('mgr:start', port);
  },
  async stop(port) {
    return await ipcRenderer.invoke('mgr:stop', port);
  },
  async openPanel(port) {
    return await ipcRenderer.invoke('mgr:openPanel', port);
  },
  paths() {
    const logoPath = path.resolve(__dirname, '..', '..', 'docs', 'static', 'img', 'logo.svg');
    const fontPath = path.resolve(__dirname, '..', '..', 'docs', 'static', 'fonts', 'Px437_IBM_Conv.ttf');
    return {
      logoFileUrl: toFileUrl(logoPath),
      fontFileUrl: toFileUrl(fontPath),
      logoPath,
      fontPath,
    };
  },
});


