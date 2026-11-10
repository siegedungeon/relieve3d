const { app, BrowserWindow, ipcMain, dialog, Menu, shell, session, Notification, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');
const { createQuoteStore } = require('./src/main/quote_store.cjs');
const { exportCommercial } = require('./src/main/quote_export.cjs');
const { writeNewExportFolder } = require('./src/main/export_folder.cjs');
const { getBambuPencilProfile, getBambuNameTreeProfile, normalizePencilPlates } = require('./src/main/bambu_profile.cjs');
const { createTiktokWorkspace } = require('./src/main/tiktok_workspace.cjs');
const { createLocalLinks } = require('./src/main/local_links.cjs');
const { createInboxClient, newInboundAlert, inboundTime, cleanFileName } = require('./src/main/inbox_client.cjs');

if (process.platform === 'win32') app.setAppUserModelId('com.relieve3d.app');
if (process.env.R3D_TEST_FILE && process.env.R3D_TEST_USER_DATA) app.setPath('userData', process.env.R3D_TEST_USER_DATA);

let win;
let updateReadyToInstall = false;
let updateVersion = '';
let installingUpdate = false;

function sendUpdateStatus(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('update-status', payload);
}

function setupAutoUpdates() {
  // No-op fuera de un empaquetado instalado (evita ruido en `npm start`/dev).
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  // The built-in install-on-quit runs the installer silently without relaunching and kills any window opened
  // meanwhile, which looks like a crash. Closing with a ready update is handled in createWindow instead.
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdateStatus({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'up-to-date' }));
  autoUpdater.on('download-progress', (p) => sendUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    updateReadyToInstall = true;
    updateVersion = info.version;
    sendUpdateStatus({ state: 'ready', version: info.version });
  });
  autoUpdater.on('error', (err) => sendUpdateStatus({ state: 'error', message: err.message }));

  autoUpdater.checkForUpdates().catch((err) => sendUpdateStatus({ state: 'error', message: err.message }));
  // Revisa periódicamente mientras la app sigue abierta (cada 4 horas).
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

ipcMain.handle('install-update', () => {
  // silent install + relaunch: otherwise the window just closes and the app does not come back
  if (updateReadyToInstall) installUpdateAndRelaunch();
});

function installUpdateAndRelaunch() {
  installingUpdate = true;
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}

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
  win.on('close', (e) => {
    if (!updateReadyToInstall || installingUpdate || process.env.R3D_TEST_FILE || process.env.R3D_SCREENSHOT) return;
    const r = dialog.showMessageBoxSync(win, {
      type: 'info', title: 'Relieve3D', noLink: true, defaultId: 0, cancelId: 1,
      message: `Hay una actualización lista (versión ${updateVersion}).`,
      detail: 'Se instala en unos segundos y Relieve3D vuelve a abrirse solo. No lo abras mientras tanto.',
      buttons: ['Actualizar y volver a abrir', 'Cerrar sin actualizar'],
    });
    if (r === 0) { e.preventDefault(); installUpdateAndRelaunch(); }
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.error('render-process-gone', d.reason);
    if (d.reason !== 'clean-exit' && !win.isDestroyed()) setTimeout(() => !win.isDestroyed() && win.reload(), 500);
  });
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
      try {
        await wait(4000);
        if (process.env.R3D_TEST_THEME) await run(`(() => {
          const select = document.getElementById('themeSelect');
          select.value = ${JSON.stringify(process.env.R3D_TEST_THEME)};
          select.dispatchEvent(new Event('change'));
        })()`);
        await require(process.env.R3D_TEST_FILE)({ win, run, shot, wait });
      }
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

// Local shortcut window (src/main/local_links.cjs): the HTML runs sandboxed, without preload (no window.api) and in its
// own persistent partition, so its localStorage survives restarts and stays apart from Relieve3D's. It can only use the
// clipboard and fullscreen; http(s) links go to the default browser and nothing else is opened.
const LOCAL_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);
function localSession(id) {
  const ses = session.fromPartition(`persist:local-${id}`);
  ses.setPermissionRequestHandler((_wc, permission, done) => done(LOCAL_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => LOCAL_PERMISSIONS.has(permission));
  return ses;
}
function sameFile(url, fileUrl) {
  try {
    const a = new URL(url), b = new URL(fileUrl);
    return a.protocol === 'file:' && decodeURIComponent(a.pathname).toLowerCase() === decodeURIComponent(b.pathname).toLowerCase();
  } catch { return false; }
}
function openLocalWindow(link, openUrl) {
  const fileUrl = pathToFileURL(link.archivo).href;
  const w = new BrowserWindow({
    width: 1400, height: 920, minWidth: 720, minHeight: 520, show: false, title: `${link.titulo} · Relieve3D`,
    icon: path.join(__dirname, 'build', 'icon.png'), autoHideMenuBar: true,
    webPreferences: { session: localSession(link.id), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  const reveal = () => { if (!w.isDestroyed() && !w.isVisible()) w.show(); };
  w.once('ready-to-show', reveal);
  setTimeout(reveal, 4000);
  w.on('page-title-updated', (e, title) => { e.preventDefault(); w.setTitle(title ? `${title} · Relieve3D` : `${link.titulo} · Relieve3D`); });
  const external = (url) => { if (/^https?:\/\//i.test(url)) openUrl(url); };
  w.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, url) => {
    if (sameFile(url, fileUrl)) return;
    e.preventDefault();
    external(url);
  });
  // No application menu: zoom (Ctrl +/−/0 and Ctrl+wheel), reload, fullscreen, back/forward and DevTools by hand.
  const zoom = (step) => { const wc = w.webContents; wc.setZoomLevel(step ? Math.max(-3, Math.min(4, wc.getZoomLevel() + step)) : 0); };
  w.webContents.on('zoom-changed', (_e, direction) => zoom(direction === 'in' ? 0.5 : -0.5));
  const history = (back) => { const h = w.webContents.navigationHistory; if (back ? h.canGoBack() : h.canGoForward()) back ? h.goBack() : h.goForward(); };
  w.on('app-command', (_e, command) => { if (command === 'browser-backward') history(true); else if (command === 'browser-forward') history(false); });
  w.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key, ctrl = input.control || input.meta;
    let done = true;
    if (ctrl && (key === '+' || key === '=')) zoom(0.5);
    else if (ctrl && key === '-') zoom(-0.5);
    else if (ctrl && key === '0') zoom(0);
    else if (key === 'F5' || (ctrl && key.toLowerCase() === 'r')) w.webContents.reload();
    else if (key === 'F11') w.setFullScreen(!w.isFullScreen());
    else if (key === 'F12') w.webContents.toggleDevTools();
    else if (input.alt && (key === 'ArrowLeft' || key === 'ArrowRight')) history(key === 'ArrowLeft');
    else done = false;
    if (done) e.preventDefault();
  });
  w.loadFile(link.archivo).catch((err) => console.error('local link', link.id, err.message));
  return w;
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

ipcMain.handle('save-files-to-folder', async (e, { files, folderName, bambuPlates }) => {
  if (bambuPlates && !folderName) throw new Error('Las placas necesitan una carpeta nueva de lote.');
  const r = process.env.R3D_AUTOSAVE_DIR ? { filePaths: [process.env.R3D_AUTOSAVE_DIR] } : await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Elige la carpeta de destino',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const dir = r.filePaths[0];
  if (folderName !== undefined) return writeNewExportFolder(dir, folderName, files,
    bambuPlates ? folder => normalizePencilPlates(folder, bambuPlates) : null);
  for (const f of files) await fs.writeFile(path.join(dir, f.name), Buffer.from(f.data));
  return dir;
});

ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('pencil-batch-profile', () => getBambuPencilProfile());
ipcMain.handle('name-tree-profile', () => getBambuNameTreeProfile());

ipcMain.handle('confirm', async (e, { message, buttons, cancelId }) => {
  const r = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), {
    type: 'question', message, buttons: buttons || ['Sí', 'No'], defaultId: 0, cancelId: cancelId ?? 1,
  });
  return r.response;
});

app.whenReady().then(() => {
  const quoteDirectory = process.env.R3D_TEST_FILE && process.env.R3D_QUOTE_TEST_DIR
    ? process.env.R3D_QUOTE_TEST_DIR : path.join(app.getPath('userData'), 'quotations');
  const quotes = createQuoteStore(quoteDirectory);
  const quoteHandle = (channel, action) => ipcMain.handle(channel, (event, ...args) => {
    if (!win || event.sender !== win.webContents) throw new Error('Origen de cotización no autorizado.');
    return action(...args);
  });
  quoteHandle('quote-load', () => quotes.load());
  quoteHandle('quote-window', active => {
    if (typeof active !== 'boolean') throw new Error('Modo de ventana inválido.');
    win.setMinimumSize(active ? 360 : 1100, active ? 600 : 680);
    if (!active) {
      const [width, height] = win.getSize();
      if (width < 1100 || height < 680) win.setSize(Math.max(width, 1100), Math.max(height, 680));
    }
  });
  quoteHandle('quote-config', (value, version) => quotes.saveConfig(value, version));
  quoteHandle('quote-save', payload => quotes.save(payload));
  quoteHandle('quote-status', payload => quotes.status(payload));
  quoteHandle('quote-actuals', payload => quotes.actuals(payload));
  quoteHandle('quote-export', async ({ id, version, format }) => exportCommercial(BrowserWindow, await quotes.commercial(id, version), format));

  const tiktok = createTiktokWorkspace({ configFile: process.env.R3D_TEST_FILE && process.env.R3D_TIKTOK_CONFIG
    ? process.env.R3D_TIKTOK_CONFIG : path.join(app.getPath('userData'), 'tiktok-studio.json') });
  const tiktokNoOpen = !!process.env.R3D_TIKTOK_NO_OPEN;
  const tiktokOpened = global.__r3dTiktokOpened = [];
  const tiktokLog = (line, tag) => { if (win && !win.isDestroyed()) win.webContents.send('tiktok-log', { line, tag }); };
  const openInside = async (abs) => {
    if (tiktokNoOpen) { tiktokOpened.push(abs); return abs; }
    const error = await shell.openPath(abs);
    if (error) throw new Error(error);
    return abs;
  };
  quoteHandle('tiktok-load', () => tiktok.load());
  quoteHandle('tiktok-config', value => tiktok.saveConfig(value));
  quoteHandle('tiktok-pick-root', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Elige la carpeta TikTok-Impresion3D', properties: ['openDirectory'] });
    return r.canceled || !r.filePaths[0] ? null : tiktok.saveConfig({ root: r.filePaths[0] });
  });
  quoteHandle('tiktok-run', args => tiktok.run(args, tiktokLog));
  quoteHandle('tiktok-create', payload => tiktok.createVideo(payload, tiktokLog));
  quoteHandle('tiktok-save-kit', ({ carpeta, md } = {}) => tiktok.saveKit(carpeta, md));
  quoteHandle('tiktok-append', ({ kind, row } = {}) => tiktok.appendCsv(kind, row));
  quoteHandle('tiktok-open', async rel => openInside(await tiktok.resolveInside(rel)));
  quoteHandle('tiktok-panel', async () => {
    const res = await tiktok.run(['panel'], tiktokLog);
    const file = res.stdout.trim().split(/\r?\n/).pop() || '';
    if (!res.ok || !/\.html$/i.test(file)) throw new Error((res.stderr || res.stdout || 'No pude generar el panel').trim());
    return openInside(await tiktok.resolveInside(path.relative((await tiktok.settings()).root, file)));
  });
  quoteHandle('tiktok-url', async url => {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') throw new Error('Solo se abren enlaces https.');
    if (!tiktokNoOpen) await shell.openExternal(u.href);
    else tiktokOpened.push(u.href);
    return u.href;
  });
  quoteHandle('tiktok-lib-save', ({ col, archivo, resumen } = {}) => tiktok.saveBiblioteca(col, archivo, resumen));
  quoteHandle('tiktok-trend-fetch', fuente => tiktok.fetchTrend(fuente));
  quoteHandle('tiktok-trend-save', list => tiktok.saveTrends(list));
  // Creative Center en su propia ventana (sesión persistente: si inicias sesión ahí, se recuerda y puedes elegir Colombia).
  const CC_URL = 'https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/es?countryCode=CO&period=7';
  let ccWin = null;
  quoteHandle('tiktok-cc-open', async () => {
    if (ccWin && !ccWin.isDestroyed()) {
      if (!tiktokNoOpen) { ccWin.show(); ccWin.focus(); }
      return { url: ccWin.webContents.getURL(), abierta: true };
    }
    ccWin = new BrowserWindow({
      width: 1280, height: 900, show: !tiktokNoOpen, title: 'TikTok Creative Center · Relieve3D', autoHideMenuBar: true,
      webPreferences: { partition: 'persist:tiktok-cc', contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    ccWin.webContents.setWindowOpenHandler(({ url }) => (/^https:\/\//.test(url) ? { action: 'allow' } : { action: 'deny' }));
    ccWin.on('closed', () => { ccWin = null; });
    if (win && !win.isDestroyed()) win.once('closed', () => { if (ccWin && !ccWin.isDestroyed()) ccWin.destroy(); });
    await ccWin.loadURL(CC_URL).catch(() => {});
    return { url: ccWin && !ccWin.isDestroyed() ? ccWin.webContents.getURL() : CC_URL, abierta: false };
  });
  quoteHandle('tiktok-cc-capture', async () => {
    if (!ccWin || ccWin.isDestroyed()) throw new Error('Primero abre el Creative Center (botón «Abrir Creative Center»).');
    const url = ccWin.webContents.getURL();
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    if (!/(^|\.)tiktok\.com$/i.test(host)) throw new Error('La ventana del Creative Center no está en tiktok.com.');
    const texto = await ccWin.webContents.executeJavaScript('document.body ? document.body.innerText : ""', true);
    return { url, texto: String(texto || '').slice(0, 200_000) };
  });
  // Accesos locales: HTML de este equipo listados en <userData>/accesos-locales.json (solo escritorio, ver preload.js).
  const localLinks = createLocalLinks({ configFile: process.env.R3D_TEST_FILE && process.env.R3D_LOCAL_LINKS_CONFIG
    ? process.env.R3D_LOCAL_LINKS_CONFIG : path.join(app.getPath('userData'), 'accesos-locales.json') });
  const localNoOpen = !!process.env.R3D_LOCAL_LINKS_NO_OPEN;
  const localWindows = new Map();
  const localOpened = [];
  global.__r3dLocalLinks = { windows: localWindows, opened: localOpened };
  const localUrl = (url) => (localNoOpen ? localOpened.push(url) : shell.openExternal(url).catch(() => {}));
  quoteHandle('local-links', () => localLinks.list());
  quoteHandle('local-link-open', async ({ id, modo } = {}) => {
    if (modo !== 'app' && modo !== 'browser') throw new Error('Modo de apertura inválido.');
    const link = await localLinks.find(String(id ?? ''));
    if (modo === 'browser') {
      if (localNoOpen) localOpened.push(link.archivo);
      else { const error = await shell.openPath(link.archivo); if (error) throw new Error(error); }
      return { modo, archivo: link.archivo };
    }
    const open = localWindows.get(link.id);
    if (open && !open.isDestroyed()) {
      if (open.isMinimized()) open.restore();
      open.show(); open.focus();
      return { modo, archivo: link.archivo, yaAbierta: true };
    }
    const w = openLocalWindow(link, localUrl);
    localWindows.set(link.id, w);
    w.on('closed', () => { if (localWindows.get(link.id) === w) localWindows.delete(link.id); });
    return { modo, archivo: link.archivo, yaAbierta: false };
  });
  // Mensajes · Pabonitas (src/main/inbox_client.cjs): la bandeja de WhatsApp, Messenger, Instagram y TikTok de la web.
  // La contraseña del formulario viaja por IPC; el token permanece aquí. El renderer solo pide rutas permitidas por window.r3dInbox.
  // Cada 30 s se lee el resumen: actualiza el contador de Inicio y, si llega un mensaje nuevo con la ventana en segundo
  // plano, muestra una notificación de Windows (clic = abre ese chat) y hace parpadear el ícono de la barra de tareas.
  const inbox = createInboxClient({ safeStorage, configFile: process.env.R3D_TEST_FILE && process.env.R3D_INBOX_CONFIG
    ? process.env.R3D_INBOX_CONFIG : path.join(app.getPath('userData'), 'mensajes.json') });
  const inboxTest = !!(process.env.R3D_TEST_FILE && process.env.R3D_INBOX_TEST_CAPTURE);
  const inboxPollMs = Math.max(1000, Number(process.env.R3D_TEST_FILE && process.env.R3D_INBOX_POLL_MS) || 30_000);
  let inboxLast; // hora del último mensaje de cliente ya visto; undefined = sin línea base (no se avisa lo que ya había)
  let inboxPolling = false;
  let inboxPollAfter = false;
  let inboxEpoch = 0;
  const inboxSend = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
  const openInboxChat = (id) => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    inboxSend('inbox-open', id);
  };
  // Pruebas E2E: avisos y enlaces quedan aquí en vez de salir a Windows o al navegador.
  const inboxCapture = inboxTest ? { client: inbox, notifications: [], opened: [], poll: () => pollInbox(),
    click: (index) => openInboxChat(inboxCapture.notifications[index]?.conversationId) } : null;
  if (inboxCapture) global.__r3dInbox = inboxCapture;
  async function pollInbox() {
    if (inboxPolling || !inbox.signedIn()) return;
    inboxPolling = true;
    const epoch = inboxEpoch;
    try {
      const res = await inbox.request('GET', '/inbox/summary');
      if (epoch !== inboxEpoch) return;
      if (!res.ok) { if (res.status === 401) inboxSend('inbox-summary', { summary: null, alert: null, signedIn: false }); return; }
      const alert = inboxLast === undefined ? null : newInboundAlert(inboxLast, res.data);
      inboxLast = inboundTime(res.data?.latest_inbound_at);
      inboxSend('inbox-summary', { summary: res.data, alert, signedIn: true });
      const background = !win || win.isDestroyed() || !win.isFocused();
      if (!alert || !inbox.notifyEnabled() || (!background && !inboxTest)) return;
      if (inboxCapture) inboxCapture.notifications.push(alert);
      if (background && win && !win.isDestroyed()) win.flashFrame(true);
      if (inboxTest || !Notification.isSupported()) return;
      const note = new Notification({ title: alert.title, body: alert.body, icon: path.join(__dirname, 'build', 'icon.png') });
      note.on('click', () => openInboxChat(alert.conversationId));
      note.show();
    } catch (err) {
      console.error('[mensajes]', err.message);
    } finally {
      inboxPolling = false;
      if (inboxPollAfter) { inboxPollAfter = false; pollInbox(); }
    }
  }
  const inboxSignedIn = (res) => {
    if (res.ok) {
      inboxEpoch++;
      inboxLast = undefined;
      if (inboxPolling) inboxPollAfter = true;
      else pollInbox();
    }
    return res;
  };
  quoteHandle('inbox-state', () => inbox.state());
  quoteHandle('inbox-login', async (form) => inboxSignedIn(await inbox.login(form)));
  quoteHandle('inbox-resume', async () => inboxSignedIn(await inbox.resume()));
  quoteHandle('inbox-logout', () => { inboxEpoch++; inboxPollAfter = false; inboxLast = undefined; return inbox.logout(); });
  quoteHandle('inbox-request', ({ method, path: route, body } = {}) => inbox.request(method, route, body));
  quoteHandle('inbox-media', (ref) => inbox.media(ref));
  quoteHandle('inbox-upload', (file) => inbox.upload(file));
  quoteHandle('inbox-save-media', async ({ ref, name } = {}) => {
    const res = await inbox.media(ref);
    if (!res.ok) return res;
    const fileName = cleanFileName(name) || res.data.name;
    const r = process.env.R3D_AUTOSAVE_DIR
      ? { filePath: path.join(process.env.R3D_AUTOSAVE_DIR, fileName) }
      : await dialog.showSaveDialog(win, { title: 'Guardar archivo del chat', defaultPath: path.join(app.getPath('downloads'), fileName) });
    if (r.canceled || !r.filePath) return { ok: true, data: null };
    await fs.writeFile(r.filePath, res.data.bytes);
    return { ok: true, data: { path: r.filePath } };
  });
  quoteHandle('inbox-open-web', async (id) => {
    const url = inbox.webUrl(id);
    if (inboxTest) inboxCapture.opened.push(url);
    else await shell.openExternal(url);
    return { ok: true, data: { url } };
  });
  // Enlaces de los mensajes y de las herramientas (catálogo, archivos): solo http(s), en el navegador del sistema.
  quoteHandle('inbox-open-link', async (url) => {
    let u = null;
    try { u = new URL(String(url ?? '')); } catch { u = null; }
    if (!u || !['http:', 'https:'].includes(u.protocol)) return { ok: false, status: 400, detail: 'Solo se abren enlaces http o https.' };
    if (inboxTest) inboxCapture.opened.push(u.href);
    else await shell.openExternal(u.href);
    return { ok: true, data: { url: u.href } };
  });
  quoteHandle('inbox-notify', (value) => inbox.setNotify(value));
  createWindow();
  win.once('closed', () => { for (const w of localWindows.values()) if (!w.isDestroyed()) w.destroy(); });
  win.on('focus', () => win.flashFrame(false));
  setInterval(() => pollInbox(), inboxPollMs);
  // Con «Recordarme», Mensajes entra solo al abrir Relieve3D para avisar de mensajes nuevos aunque no abras el módulo.
  inbox.state().then((s) => (s.hasSavedPassword ? inbox.resume().then(inboxSignedIn) : null)).catch(() => {});
  setupAutoUpdates();
});
app.on('window-all-closed', () => app.quit());
