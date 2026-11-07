// Preload "como la versión web" para el E2E local-links: expone solo window.api (lo que la nube replica) y nunca
// window.r3dLocal. Ejecuta el preload.js real con un contextBridge que deja pasar únicamente 'api'.
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

const bridge = { exposeInMainWorld: (key, api) => { if (key === 'api') electron.contextBridge.exposeInMainWorld(key, api); } };
const code = fs.readFileSync(path.join(__dirname, '..', '..', 'preload.js'), 'utf8');
new Function('require', code)((name) => (name === 'electron' ? { contextBridge: bridge, ipcRenderer: electron.ipcRenderer } : require(name)));
