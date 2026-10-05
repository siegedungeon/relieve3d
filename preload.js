const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  saveFilesToFolder: (opts) => ipcRenderer.invoke('save-files-to-folder', opts),
  confirm: (opts) => ipcRenderer.invoke('confirm', opts),
  onTestImage: (cb) => ipcRenderer.on('test-load-image', (e, d) => cb(d)),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (e, d) => cb(d)),
  installUpdate: () => ipcRenderer.invoke('install-update'),
});
