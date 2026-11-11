const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  quoteLoad: () => ipcRenderer.invoke('quote-load'),
  quoteWindow: active => ipcRenderer.invoke('quote-window', active),
  quoteConfig: (config, version) => ipcRenderer.invoke('quote-config', config, version),
  quoteSave: payload => ipcRenderer.invoke('quote-save', payload),
  quoteStatus: payload => ipcRenderer.invoke('quote-status', payload),
  quoteActuals: payload => ipcRenderer.invoke('quote-actuals', payload),
  quoteExport: payload => ipcRenderer.invoke('quote-export', payload),
  tiktokLoad: () => ipcRenderer.invoke('tiktok-load'),
  tiktokConfig: value => ipcRenderer.invoke('tiktok-config', value),
  tiktokPickRoot: () => ipcRenderer.invoke('tiktok-pick-root'),
  tiktokRun: args => ipcRenderer.invoke('tiktok-run', args),
  tiktokCreate: payload => ipcRenderer.invoke('tiktok-create', payload),
  tiktokSaveKit: payload => ipcRenderer.invoke('tiktok-save-kit', payload),
  tiktokAppend: payload => ipcRenderer.invoke('tiktok-append', payload),
  tiktokOpen: rel => ipcRenderer.invoke('tiktok-open', rel),
  tiktokPanel: () => ipcRenderer.invoke('tiktok-panel'),
  tiktokUrl: url => ipcRenderer.invoke('tiktok-url', url),
  tiktokLibSave: payload => ipcRenderer.invoke('tiktok-lib-save', payload),
  tiktokTrendFetch: fuente => ipcRenderer.invoke('tiktok-trend-fetch', fuente),
  tiktokTrendSave: list => ipcRenderer.invoke('tiktok-trend-save', list),
  tiktokCcOpen: () => ipcRenderer.invoke('tiktok-cc-open'),
  tiktokCcCapture: () => ipcRenderer.invoke('tiktok-cc-capture'),
  onTiktokLog: cb => ipcRenderer.on('tiktok-log', (e, d) => cb(d)),
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  saveFilesToFolder: (opts) => ipcRenderer.invoke('save-files-to-folder', opts),
  pencilBatchProfile: () => ipcRenderer.invoke('pencil-batch-profile'),
  nameTreeProfile: () => ipcRenderer.invoke('name-tree-profile'),
  clickerBambuProfile: (count) => ipcRenderer.invoke('clicker-bambu-profile', count),
  confirm: (opts) => ipcRenderer.invoke('confirm', opts),
  onTestImage: (cb) => ipcRenderer.on('test-load-image', (e, d) => cb(d)),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (e, d) => cb(d)),
  appVersion: () => ipcRenderer.invoke('app-version'),
  listFonts: () => ipcRenderer.invoke('list-fonts'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
});

// Solo escritorio, fuera de window.api (la versión web replica window.api): accesos locales de este equipo (src/main/local_links.cjs).
contextBridge.exposeInMainWorld('r3dLocal', { list: () => ipcRenderer.invoke('local-links'), open: (id, modo) => ipcRenderer.invoke('local-link-open', { id, modo }) });

// Solo escritorio: Mensajes · Pabonitas. La contraseña del formulario viaja por IPC; el token permanece en el proceso principal.
contextBridge.exposeInMainWorld('r3dInbox', { state: () => ipcRenderer.invoke('inbox-state'), login: form => ipcRenderer.invoke('inbox-login', form), resume: () => ipcRenderer.invoke('inbox-resume'), logout: () => ipcRenderer.invoke('inbox-logout'), request: (method, path, body) => ipcRenderer.invoke('inbox-request', { method, path, body }), media: ref => ipcRenderer.invoke('inbox-media', ref), upload: file => ipcRenderer.invoke('inbox-upload', file), saveMedia: (ref, name) => ipcRenderer.invoke('inbox-save-media', { ref, name }), openWeb: id => ipcRenderer.invoke('inbox-open-web', id), openLink: url => ipcRenderer.invoke('inbox-open-link', url), setNotify: on => ipcRenderer.invoke('inbox-notify', on), onSummary: cb => ipcRenderer.on('inbox-summary', (e, d) => cb(d)), onOpen: cb => ipcRenderer.on('inbox-open', (e, id) => cb(id)) });
