const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  quoteLoad: () => ipcRenderer.invoke('quote-load'),
  quoteWindow: active => ipcRenderer.invoke('quote-window', active),
  quoteConfig: (config, version) => ipcRenderer.invoke('quote-config', config, version),
  quoteSave: payload => ipcRenderer.invoke('quote-save', payload),
  quoteStatus: payload => ipcRenderer.invoke('quote-status', payload),
  quoteActuals: payload => ipcRenderer.invoke('quote-actuals', payload),
  quoteExport: payload => ipcRenderer.invoke('quote-export', payload),
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  saveFilesToFolder: (opts) => ipcRenderer.invoke('save-files-to-folder', opts),
  pencilBatchProfile: () => ipcRenderer.invoke('pencil-batch-profile'),
  confirm: (opts) => ipcRenderer.invoke('confirm', opts),
  onTestImage: (cb) => ipcRenderer.on('test-load-image', (e, d) => cb(d)),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (e, d) => cb(d)),
  appVersion: () => ipcRenderer.invoke('app-version'),
  listFonts: () => ipcRenderer.invoke('list-fonts'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
});
