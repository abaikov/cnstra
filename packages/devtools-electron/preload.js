const { contextBridge, ipcRenderer } = require('electron');

function toFileUrl(absPath) {
  // Basic file:// URL for mac/linux (sufficient for our dev env)
  const normalized = absPath.replace(/\\/g, '/');
  return `file://${normalized}`;
}

// We expose a minimal API (if needed later). For now, injection is done from main.js.
contextBridge.exposeInMainWorld('__CNSTRA_DEVTOOLS_BRIDGE__', {
  async list() {
    const items = await ipcRenderer.invoke('mgr:list');
    return items;
  },
  async findPort(startPort) {
    return await ipcRenderer.invoke('mgr:findPort', startPort);
  },
  async start(port) {
    return await ipcRenderer.invoke('mgr:start', port);
  },
  async stop(port) {
    console.log('[CNStra DevTools] Preload: calling stop for port:', port);
    try {
      const result = await ipcRenderer.invoke('mgr:stop', port);
      console.log('[CNStra DevTools] Preload: stop result:', result);
      return result;
    } catch (error) {
      console.error('[CNStra DevTools] Preload: stop error:', error);
      throw error;
    }
  },
  async openPanel(port) {
    return await ipcRenderer.invoke('mgr:openPanel', port);
  },
  async paths() {
    return await ipcRenderer.invoke('mgr:paths');
  },
  async listWindows() {
    return await ipcRenderer.invoke('mgr:listWindows');
  },
  async closeAllWindows(port) {
    return await ipcRenderer.invoke('mgr:closeAllWindows', port);
  },
});


