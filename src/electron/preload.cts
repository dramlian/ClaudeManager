const electron = require('electron');

function on<T>(channel: string, cb: (tabId: string, payload: T) => void) {
  const listener = (_: Electron.IpcRendererEvent, tabId: string, payload: T) => cb(tabId, payload);
  electron.ipcRenderer.on(channel, listener);
  return () => {
    electron.ipcRenderer.off(channel, listener);
  };
}

electron.contextBridge.exposeInMainWorld('electron', {
  startSession: (tabId, cwd, cols, rows) => electron.ipcRenderer.invoke('session:start', tabId, cwd, cols, rows),
  closeSession: (tabId) => electron.ipcRenderer.invoke('session:close', tabId),
  writeToPty: (tabId, data) => electron.ipcRenderer.send('pty:input', tabId, data),
  resizePty: (tabId, cols, rows) => electron.ipcRenderer.send('pty:resize', tabId, cols, rows),
  setWindowTitle: (title) => electron.ipcRenderer.send('window:title', title),
  pickFolder: () => electron.ipcRenderer.invoke('folder:pick'),
  clipboardRead: () => electron.ipcRenderer.invoke('clipboard:read'),
  clipboardWrite: (text) => electron.ipcRenderer.send('clipboard:write', text),
  openInVSCode: (folder) => electron.ipcRenderer.invoke('vscode:open', folder),
  getRecentFolders: () => electron.ipcRenderer.invoke('folder:recent'),
  removeRecentFolder: (folder) => electron.ipcRenderer.invoke('folder:removeRecent', folder),
  getSavedFolders: () => electron.ipcRenderer.invoke('saved:list'),
  addSavedFolder: () => electron.ipcRenderer.invoke('saved:add'),
  removeSavedFolder: (folder) => electron.ipcRenderer.invoke('saved:remove', folder),
  sendFrameAction: (action) => electron.ipcRenderer.send('frame:action', action),
  onPtyData: (cb) => on<string>('pty:data', cb),
  onSessionStatus: (cb) => on<SessionStatus>('session:status', cb),
  onContext: (cb) => on<ContextInfo>('context:update', cb),
  onUsage: (cb) => on<PlanUsage>('usage:update', cb),
} satisfies Window['electron']);
