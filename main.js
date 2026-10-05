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
  if (process.env.R3D_TEST_FILE) {
    win.webContents.once('did-finish-load', async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const run = (js) => win.webContents.executeJavaScript(js);
      const shot = async (file) => {
        for (let i = 0; ; i++) {
          try { return await fs.writeFile(file, (await win.webContents.capturePage()).toPNG()); }
          catch (err) { if (i > 5) throw err; await wait(1000); }
        }
      };
      try { await wait(4000); await require(process.env.R3D_TEST_FILE)({ win, run, shot, wait }); }
      catch (err) { console.log('[test error]', err.stack || err.message); }
      app.quit();
    });
  }
  if (process.env.R3D_TEST_IMAGE || process.env.R3D_SCREENSHOT) {
    win.webContents.once('did-finish-load', async () => {
      if (process.env.R3D_TEST_IMAGE) {
        const bytes = await fs.readFile(process.env.R3D_TEST_IMAGE);
        win.webContents.send('test-load-image', { name: path.basename(process.env.R3D_TEST_IMAGE), bytes });
      }
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

// Installed font family names (Windows: system + per-user fonts), read from the OpenType 'name' table.
let fontCache = null;
function fontFamilies(buf) {
  const out = [];
  const u32 = (o) => buf.readUInt32BE(o), u16 = (o) => buf.readUInt16BE(o);
  const faces = buf.toString('latin1', 0, 4) === 'ttcf' ? Array.from({ length: Math.min(u32(8), 16) }, (_, i) => u32(12 + i * 4)) : [0];
  for (const off of faces) {
    const n = u16(off + 4);
    for (let i = 0; i < n; i++) {
      const rec = off + 12 + i * 16;
      if (buf.toString('latin1', rec, rec + 4) !== 'name') continue;
      const t = u32(rec + 8), count = u16(t + 2), strOff = t + u16(t + 4);
      const names = {};
      for (let j = 0; j < count; j++) {
        const r = t + 6 + j * 12;
        const pid = u16(r), lang = u16(r + 4), id = u16(r + 6), len = u16(r + 8), so = u16(r + 10);
        if (id !== 1 && id !== 16) continue;
        let s = null;
        if (pid === 3 && (lang === 0x409 || !names[id])) {
          const b = buf.subarray(strOff + so, strOff + so + len);
          s = ''; for (let q = 0; q + 1 < b.length; q += 2) s += String.fromCharCode(b.readUInt16BE(q));
        } else if (pid === 1 && !names[id]) s = buf.toString('latin1', strOff + so, strOff + so + len);
        if (s) names[id] = s;
      }
      const fam = names[16] || names[1];
      if (fam) out.push(fam.trim());
    }
  }
  return out;
}
ipcMain.handle('list-fonts', async () => {
  if (fontCache) return fontCache;
  const dirs = [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts')];
  if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
  const set = new Set();
  for (const d of dirs) {
    let files = [];
    try { files = await fs.readdir(d); } catch { continue; }
    for (const f of files) {
      if (!/\.(ttf|otf|ttc)$/i.test(f)) continue;
      try { for (const n of fontFamilies(await fs.readFile(path.join(d, f)))) if (!n.startsWith('@')) set.add(n); } catch { /* unreadable font */ }
    }
  }
  fontCache = [...set].sort((a, b) => a.localeCompare(b));
  return fontCache;
});
ipcMain.handle('save-file', async (e, { defaultPath, filters, data, extraFiles }) => {
  const r = process.env.R3D_AUTOSAVE_DIR
    ? { filePath: path.join(process.env.R3D_AUTOSAVE_DIR, path.basename(defaultPath)) }
    : await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath, filters });
  if (r.canceled || !r.filePath) return null;
  await fs.writeFile(r.filePath, typeof data === 'string' ? data : Buffer.from(data));
  for (const x of extraFiles || []) {
    const p = path.join(path.dirname(r.filePath), x.name);
    await fs.writeFile(p, typeof x.data === 'string' ? x.data : Buffer.from(x.data));
  }
  return r.filePath;
});

ipcMain.handle('save-files-to-folder', async (e, { files }) => {
  const r = process.env.R3D_AUTOSAVE_DIR ? { filePaths: [process.env.R3D_AUTOSAVE_DIR] } : await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Elige la carpeta de destino',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const dir = r.filePaths[0];
  for (const f of files) await fs.writeFile(path.join(dir, f.name), Buffer.from(f.data));
  return dir;
});

ipcMain.handle('app-version', () => app.getVersion());

ipcMain.handle('confirm', async (e, { message, buttons, cancelId }) => {
  const r = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), {
    type: 'question', message, buttons: buttons || ['Sí', 'No'], defaultId: 0, cancelId: cancelId ?? 1,
  });
  return r.response;
});

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdates();
});
app.on('window-all-closed', () => app.quit());
