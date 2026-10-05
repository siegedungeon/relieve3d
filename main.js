const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { autoUpdater } = require('electron-updater');

let win;
let updateReadyToInstall = false;

function sendUpdateStatus(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('update-status', payload);
}

function setupAutoUpdates() {
  // No-op fuera de un empaquetado instalado (evita ruido en `npm start`/dev).
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdateStatus({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'up-to-date' }));
  autoUpdater.on('download-progress', (p) => sendUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    updateReadyToInstall = true;
    sendUpdateStatus({ state: 'ready', version: info.version });
  });
  autoUpdater.on('error', (err) => sendUpdateStatus({ state: 'error', message: err.message }));

  autoUpdater.checkForUpdates().catch((err) => sendUpdateStatus({ state: 'error', message: err.message }));
  // Revisa periódicamente mientras la app sigue abierta (cada 4 horas).
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

ipcMain.handle('install-update', () => {
  if (updateReadyToInstall) autoUpdater.quitAndInstall();
});

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#f3f4f7',
    title: 'Relieve3D',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });

  // Automation hooks used for testing: R3D_DEBUG prints console; R3D_TEST_IMAGE + R3D_SCREENSHOT capture a screenshot.
  if (process.env.R3D_DEBUG) {
    win.webContents.on('console-message', (e) => {
      console.log('[renderer]', e.message);
    });
  }
  if (process.env.R3D_TEST_IMAGE) {
    win.webContents.once('did-finish-load', async () => {
      const bytes = await fs.readFile(process.env.R3D_TEST_IMAGE);
      win.webContents.send('test-load-image', { name: path.basename(process.env.R3D_TEST_IMAGE), bytes });
      if (process.env.R3D_SCREENSHOT) {
        setTimeout(async () => {
          if (process.env.R3D_TEST_SCRIPT) {
            try { console.log('[test]', await win.webContents.executeJavaScript(process.env.R3D_TEST_SCRIPT)); }
            catch (err) { console.log('[test error]', err.message); }
            await new Promise((r) => setTimeout(r, 1500));
          }
          const img = await win.webContents.capturePage();
          await fs.writeFile(process.env.R3D_SCREENSHOT, img.toPNG());
          app.quit();
        }, Number(process.env.R3D_WAIT || 5000));
      }
    });
  }
}

ipcMain.handle('save-file', async (e, { defaultPath, filters, data, extraFiles }) => {
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath, filters });
  if (r.canceled || !r.filePath) return null;
  await fs.writeFile(r.filePath, typeof data === 'string' ? data : Buffer.from(data));
  for (const x of extraFiles || []) {
    const p = path.join(path.dirname(r.filePath), x.name);
    await fs.writeFile(p, typeof x.data === 'string' ? x.data : Buffer.from(x.data));
  }
  return r.filePath;
});

ipcMain.handle('save-files-to-folder', async (e, { files }) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Elige la carpeta de destino',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const dir = r.filePaths[0];
  for (const f of files) await fs.writeFile(path.join(dir, f.name), Buffer.from(f.data));
  return dir;
});

ipcMain.handle('confirm', async (e, { message, buttons }) => {
  const r = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), {
    type: 'question', message, buttons: buttons || ['Sí', 'No'], defaultId: 0, cancelId: 1,
  });
  return r.response;
});

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdates();
});
app.on('window-all-closed', () => app.quit());
