// Accesos locales (solo escritorio), flujo completo sobre un HTML de prueba (run.mjs lo prepara en test/out/e2e/local-links):
// Inicio muestra «Solo en este equipo» (acceso válido, uno que falta y el aviso de uno inválido) → «Abrir en el navegador»
// → «Abrir» en su ventana aislada (sandbox, sin Node ni window.api, partición propia) → enlaces https al navegador y nada
// más navega → atrás/adelante, recargar y zoom con teclado → micrófono bloqueado, portapapeles permitido → exportar
// (descarga) → un segundo «Abrir» enfoca la misma ventana → localStorage propio que sigue al cerrar y reabrir → archivo
// movido → cambios en accesos-locales.json → la versión web (solo window.api) no muestra la sección.
const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, ClipboardItem, clipboard, session } = require('electron');

const ID = 'e2e-guia-local';

module.exports = async ({ win, run, shot, wait }) => {
  const out = process.env.E2E_DIR, guide = process.env.E2E_LOCAL_GUIDE, config = process.env.R3D_LOCAL_LINKS_CONFIG;
  const original = fs.readFileSync(config, 'utf8');
  const { windows, opened } = global.__r3dLocalLinks;
  const errors = [];
  const watch = (wc, where) => wc.on('console-message', (e) => {
    if ((e.level === 'error' || e.level >= 3) && !/disk_cache|WebGLProgram/.test(e.message)) errors.push(`${where}: ${e.message}`);
  });
  watch(win.webContents, 'Relieve3D');
  const ok = (value, message) => { console.log('[e2e]', value ? 'ok  ' : 'FAIL', message); if (!value) throw new Error(message); };
  const read = async (expression, wc = win.webContents) =>
    JSON.parse(await wc.executeJavaScript(`Promise.resolve(${expression}).then((v) => JSON.stringify(v))`, true) ?? 'null');
  const until = async (fn, what, ms = 15000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(100)) { const v = await fn(); if (v) return v; }
    throw new Error(`Tiempo agotado esperando: ${what}`);
  };
  const waitOk = async (fn, message, ms) => ok(await until(fn, message, ms).catch(() => false), message);
  const click = (selector) => run(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error(${JSON.stringify(`No existe ${selector}`)}); el.click(); })()`);
  const home = () => read(`(() => { const b = document.getElementById('homeLocal'); return { visible: !b.hidden && !document.getElementById('home').hidden, text: b.textContent,
    cards: [...b.querySelectorAll('[data-local]')].map((c) => ({ id: c.dataset.local, missing: c.classList.contains('missing'), disabled: [...c.querySelectorAll('button')].map((x) => x.disabled), text: c.textContent })),
    warn: b.querySelector('.local-warn')?.textContent || '' }; })()`);
  const toastText = (error) => until(() => read(`(() => { const t = document.getElementById('toast'); return !t.hidden && t.classList.contains('error') === ${error} && t.textContent; })()`), 'el aviso');
  const loaded = (w) => until(() => !w.isDestroyed() && !w.webContents.isLoading() && w.isVisible() && / · Relieve3D$/.test(w.getTitle()) && w, 'que cargue la guía');
  const key = (w, keyCode, modifiers = []) => {
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };
  const ses = session.fromPartition(`persist:local-${ID}`);
  // The partition folder lives in the real profile; run.mjs deletes it once Electron has exited.
  fs.writeFileSync(path.join(out, 'partition-path.txt'), ses.storagePath);
  await ses.clearStorageData();

  // Inicio
  const start = await until(async () => { const s = await home(); return s.visible && s.cards.length === 2 && s; }, 'la sección «Solo en este equipo»');
  ok(/Solo en este equipo/.test(start.text) && /no se publican ni se suben a la nube/.test(start.text), 'Inicio muestra «Solo en este equipo» (no se publica ni se sube a la nube)');
  const [card, missing] = start.cards;
  ok(card.id === ID && !card.missing && /Guía de prueba/.test(card.text) && /HTML local de prueba/.test(card.text) && card.disabled.join() === 'false,false',
    'el acceso válido trae «Abrir» y «Abrir en el navegador»');
  ok(missing.id === 'e2e-movida' && missing.missing && missing.disabled.join() === 'true,true' && /No encuentro el archivo: .*no-existe\.html/.test(missing.text),
    'el acceso cuyo archivo falta se marca y no se puede abrir');
  ok(/«Relativa»: "archivo" debe ser una ruta completa/.test(start.warn) && !/undefined|NaN|\[object Object\]/.test(start.text), 'la entrada inválida sale como aviso, sin textos rotos');
  await shot(path.join(out, '01-inicio.png'));

  // Abrir en el navegador
  await click(`[data-local="${ID}"] [data-open="browser"]`);
  await waitOk(() => opened.includes(guide), '«Abrir en el navegador» lo abre con el navegador predeterminado');
  ok(/navegador predeterminado/.test(await toastText(false)) && windows.size === 0, 'avisa y no crea ventana propia');

  // Abrir en su ventana (clic en la tarjeta)
  const before = BrowserWindow.getAllWindows().length;
  await click(`[data-local="${ID}"] .hc-title`);
  const gw = await loaded(await until(() => windows.get(ID), 'la ventana de la guía'));
  watch(gw.webContents, 'guía');
  const g = (expression) => read(expression, gw.webContents);
  const count = BrowserWindow.getAllWindows().length;
  ok(count === before + 1 && gw.getTitle() === 'Guía de prueba · Relieve3D', `«Abrir» la muestra en su ventana con el título de la guía (${gw.getTitle()})`);
  ok(decodeURIComponent(new URL(gw.webContents.getURL()).pathname).toLowerCase().endsWith('/guía local ñ/guía de prueba.html'), 'carga el archivo (ruta con espacios, tildes y ñ)');
  const iso = await g(`({ require: typeof require, process: typeof process, api: typeof window.api, local: typeof window.r3dLocal, visitas: localStorage.getItem('visitas') })`);
  const prefs = gw.webContents.getLastWebPreferences();
  ok(iso.require === 'undefined' && iso.process === 'undefined' && iso.api === 'undefined' && iso.local === 'undefined'
    && prefs.sandbox && prefs.contextIsolation && !prefs.nodeIntegration && !prefs.preload, 'corre aislada: sandbox, sin Node, sin window.api ni window.r3dLocal');
  ok(gw.webContents.session === ses && ses !== win.webContents.session && /local-e2e-guia-local$/.test(ses.storagePath || ''), 'usa su propia partición persistente');
  const visits = Number(iso.visitas);
  await run(`localStorage.setItem('r3d-e2e-main', 'principal')`);
  const seen = { guia: await g(`localStorage.getItem('r3d-e2e-main')`), main: await read(`localStorage.getItem('visitas')`) };
  await run(`localStorage.removeItem('r3d-e2e-main')`);
  ok(visits === 1 && seen.guia === null && seen.main === null, 'su localStorage está separado del de Relieve3D');

  // Enlaces: https al navegador; la ventana no sale de la guía
  await g(`document.getElementById('ext').click()`);
  await waitOk(() => opened.includes('https://example.com/blank'), 'un enlace https en pestaña nueva se abre en el navegador');
  const url0 = gw.webContents.getURL();
  await g(`document.getElementById('nav').click()`);
  await waitOk(() => opened.includes('https://example.com/nav'), 'un enlace https en la misma ventana también va al navegador');
  await g(`document.getElementById('other').click()`);
  await wait(600);
  ok(gw.webContents.getURL() === url0 && !opened.some((u) => /otra\.html/.test(u)) && BrowserWindow.getAllWindows().length === count,
    'la ventana no navega fuera de la guía ni abre otros archivos o ventanas');
  await g(`document.getElementById('hash').click()`);
  await waitOk(() => gw.webContents.getURL().endsWith('#/simulador'), 'las rutas internas (#/…) funcionan');

  // Teclado (la ventana no tiene menú)
  gw.focus();
  key(gw, 'Left', ['alt']);
  await waitOk(() => !gw.webContents.getURL().includes('#'), 'Alt+← vuelve atrás');
  key(gw, 'Right', ['alt']);
  await waitOk(() => gw.webContents.getURL().endsWith('#/simulador'), 'Alt+→ va adelante');
  key(gw, 'F5');
  await waitOk(async () => !gw.webContents.isLoading() && Number(await g(`localStorage.getItem('visitas')`)) === visits + 1, 'F5 recarga la guía');
  key(gw, '=', ['control']);
  await waitOk(() => gw.webContents.getZoomLevel() === 0.5, 'Ctrl + acerca');
  key(gw, '-', ['control']); key(gw, '-', ['control']);
  await waitOk(() => gw.webContents.getZoomLevel() === -0.5, 'Ctrl − aleja');
  key(gw, '0', ['control']);
  await waitOk(() => gw.webContents.getZoomLevel() === 0, 'Ctrl 0 restablece el zoom');

  // Permisos: micrófono no; portapapeles sí (botones «copiar» de la guía)
  const media = await g(`navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'concedido', (e) => e.name)`);
  const permission = await g(`navigator.permissions.query({ name: 'microphone' }).then((p) => p.state)`);
  ok(media !== 'concedido' && permission === 'denied', `el micrófono queda bloqueado (${media}, ${permission})`);
  const saved = await Promise.all((await clipboard.read()).map(async (item) => {
    const data = {};
    for (const type of item.types) { const value = await item.getType(type).catch(() => null); if (value) data[type] = value; }
    return data;
  }));
  const savedText = await clipboard.readText();
  try {
    gw.show(); gw.focus(); gw.webContents.focus(); await wait(300);
    const copy = await g(`navigator.clipboard.writeText('copiado desde la guía ✓').then(() => 'ok', (e) => e.name + ': ' + e.message)`);
    let pasted = '';
    await until(async () => (pasted = await clipboard.readText()) === 'copiado desde la guía ✓', 'el portapapeles', 3000).catch(() => {});
    ok(copy === 'ok' && pasted === 'copiado desde la guía ✓', `copiar al portapapeles funciona (${copy}; leído: ${JSON.stringify(pasted).slice(0, 80)})`);
  } finally {
    const items = saved.filter((data) => Object.keys(data).length);
    if (items.length) await clipboard.write(items.map((data) => new ClipboardItem(data))); else clipboard.clear();
  }
  ok((await clipboard.readText()) === savedText, 'el portapapeles del usuario queda como estaba');

  // Exportar progreso (descarga: Electron muestra «Guardar como»; aquí se fija la ruta)
  const file = path.join(out, 'progreso.json');
  const download = new Promise((resolve) => ses.once('will-download', (_e, item) => { item.setSavePath(file); item.once('done', (_d, state) => resolve(state)); }));
  await g(`document.getElementById('download').click()`);
  const state = await Promise.race([download, wait(15000).then(() => 'tiempo agotado')]);
  ok(state === 'completed' && JSON.parse(fs.readFileSync(file, 'utf8')).progreso === 1, `«Exportar progreso» descarga el archivo (${state})`);
  fs.writeFileSync(path.join(out, '02-guia.png'), (await gw.webContents.capturePage()).toPNG());

  // Un segundo «Abrir» no duplica; cerrar y reabrir conserva el localStorage
  const again = await read(`window.r3dLocal.open(${JSON.stringify(ID)}, 'app')`);
  ok(again.yaAbierta === true && windows.get(ID) === gw && BrowserWindow.getAllWindows().length === count, 'un segundo «Abrir» enfoca la misma ventana');
  gw.close();
  await waitOk(() => gw.isDestroyed() && !windows.has(ID), 'cerrar la guía la libera');
  await click(`[data-local="${ID}"] [data-open="app"]`);
  const gw2 = await loaded(await until(() => windows.get(ID), 'reabrir la guía'));
  ok(Number(await read(`localStorage.getItem('visitas')`, gw2.webContents)) === visits + 2, 'el progreso (localStorage) sigue al cerrar y volver a abrir');
  gw2.close();
  await until(() => !windows.has(ID), 'cerrar la guía');

  // Archivo movido después de mostrar Inicio
  const moved = `${guide}.movido`;
  fs.renameSync(guide, moved);
  try {
    await click(`[data-local="${ID}"] [data-open="browser"]`);
    const message = await toastText(true);
    ok(/^No encuentro .*guía de prueba\.html\. ¿Se movió o se borró\?$/.test(message), `si el archivo se movió lo dice claro (${message})`);
    await waitOk(async () => { const s = await home(); return s.cards[0]?.missing && s.cards[0].disabled.join() === 'true,true'; }, 'y la tarjeta queda marcada como faltante');
    await shot(path.join(out, '03-falta-archivo.png'));
  } finally { fs.renameSync(moved, guide); }
  await run('window.__r3d.showHome()');
  await waitOk(async () => { const s = await home(); return s.cards[0] && !s.cards[0].missing; }, 'al volver a Inicio se recupera cuando el archivo vuelve');
  const errs = await read(`Promise.all([['e2e-movida', 'app'], ['nadie', 'app'], [${JSON.stringify(ID)}, 'exe']].map(([id, modo]) => window.r3dLocal.open(id, modo).then(() => 'abrió', (e) => e.message)))`);
  ok(/No encuentro .*no-existe\.html/.test(errs[0]) && /ya no está en/.test(errs[1]) && /Modo de apertura inválido/.test(errs[2]) && windows.size === 0 && opened.length === 3,
    'abrir uno que falta, uno que ya no está o con un modo inválido falla sin abrir nada');

  // Cambios en accesos-locales.json con Relieve3D abierto
  fs.writeFileSync(config, JSON.stringify({ accesos: [] }));
  await run(`window.dispatchEvent(new Event('focus'))`);
  await waitOk(async () => !(await home()).visible, 'vaciar accesos-locales.json quita la sección al volver a la ventana');
  fs.writeFileSync(config, '{ "accesos": [');
  await run('window.__r3d.showHome()');
  await waitOk(async () => { const s = await home(); return s.visible && !s.cards.length && /no es un JSON válido/.test(s.warn); }, 'un JSON dañado se avisa en Inicio sin romper nada');
  fs.rmSync(config);
  await run('window.__r3d.showHome()');
  await waitOk(async () => { const s = await home(); return !s.visible && !s.text; }, 'sin accesos-locales.json no aparece nada');
  fs.writeFileSync(config, original);
  await run('window.__r3d.showHome()');
  await waitOk(async () => (await home()).cards.length === 2, 'al restaurarlo vuelve a aparecer');

  // Versión web: el mismo Inicio con solo window.api (sin el puente local) no muestra la sección
  const web = new BrowserWindow({ show: false, width: 1300, height: 900,
    webPreferences: { preload: path.join(__dirname, 'web-like-preload.cjs'), contextIsolation: true, sandbox: false, partition: 'e2e-web-like' } });
  try {
    await web.loadFile(path.join(__dirname, '..', '..', 'src', 'index.html'));
    const st = await until(() => read(`(() => { const b = document.getElementById('homeLocal'), cards = document.querySelectorAll('#homeGrid3d .home-card').length;
      return cards > 0 && { api: typeof window.api, local: typeof window.r3dLocal, hidden: b.hidden, html: b.innerHTML }; })()`, web.webContents), 'Inicio en la versión tipo web');
    await read(`window.dispatchEvent(new Event('focus'))`, web.webContents);
    await wait(300);
    const after = await read(`({ hidden: document.getElementById('homeLocal').hidden, html: document.getElementById('homeLocal').innerHTML })`, web.webContents);
    ok(st.api === 'object' && st.local === 'undefined' && st.hidden && !st.html && after.hidden && !after.html,
      'versión web (solo window.api): Inicio funciona y la sección local no existe, aunque haya accesos en este equipo');
  } finally { web.destroy(); }

  ok(!errors.length, `sin errores en consola${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await ses.clearStorageData();
  console.log('[e2e] done');
};
