const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

module.exports = async ({ win, run, shot, wait }) => {
  const dir = process.env.E2E_DIR, exp = process.env.R3D_AUTOSAVE_DIR;
  const errors = [];
  win.webContents.on('console-message', (event) => {
    if ((event.level === 'error' || event.level >= 3) && !/WebGLProgram|disk_cache/.test(event.message)) errors.push(event.message);
  });
  const log = (...args) => console.log('[e2e]', ...args);
  const ok = (condition, text) => log(condition ? 'ok  ' : 'FAIL', text);
  await win.setSize(1500, 900);
  ok(await run(`(() => { const card = document.querySelector('[data-mod="keyring3mf"]'); if (!card) return false; card.click(); return true; })()`), 'the keyring module opens from home');
  await wait(800);
  const b64 = fs.readFileSync(process.env.E2E_INPUT).toString('base64');
  const load = (name) => run(`(async () => { const s = atob('${b64}'), bytes = Uint8Array.from(s, c => c.charCodeAt(0)); await window.__r3d.keyring3mf.loadFile(new File([bytes], ${JSON.stringify(name)})); })()`);
  await load('modelo_pintado.3mf');
  const initial = JSON.parse(await run(`JSON.stringify({ ready: !document.querySelector('#keyring3mf [data-r=export]').disabled, center: window.__r3d.keyring3mf.res?.center, contact: window.__r3d.keyring3mf.res?.attachmentVolume, hole: window.__r3d.keyring3mf.res?.holeBlockedVolume })`));
  ok(initial.ready && initial.contact > 1 && initial.hole < 1e-5, 'the painted 3MF gets a connected ring with a free hole');
  await wait(600);
  await shot(path.join(dir, 'keyring-initial.png'));
  await run(`(() => { const p = document.querySelector('#keyring3mf [data-k=position]'); p.value = '35'; p.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  ok(await run(`document.querySelector('#keyring3mf [data-r=export]').disabled`), 'pending changes cannot be exported');
  await run(`window.__r3d.keyring3mf.rebuild()`);
  const moved = JSON.parse(await run(`JSON.stringify({ ready: !document.querySelector('#keyring3mf [data-r=export]').disabled, center: window.__r3d.keyring3mf.res?.center })`));
  ok(moved.ready && moved.center[0] !== initial.center[0], 'the ring moves to the chosen position');
  await run(`(() => { const p = document.querySelector('#keyring3mf [data-k=inner]'); p.value = '9'; p.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await run(`window.__r3d.keyring3mf.rebuild()`);
  ok(await run(`document.querySelector('#keyring3mf [data-r=export]').disabled && /pared/i.test(document.querySelector('#keyring3mf [data-r=warn]').textContent)`), 'thin rings are blocked with an explanation');
  await run(`(() => { const p = document.querySelector('#keyring3mf [data-k=inner]'); p.value = '4'; p.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await run(`window.__r3d.keyring3mf.rebuild()`);
  await wait(600);
  await shot(path.join(dir, 'keyring-ready.png'));
  await run(`window.__r3d.keyring3mf.export()`);
  await wait(1000);
  const names = fs.readdirSync(exp).filter((name) => /_con_argolla\.3mf$/i.test(name));
  ok(names.length === 1, 'a new 3MF is saved');
  if (names.length === 1) {
    const { read3MF } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'core', 'threemf_read.js')).href);
    const before = read3MF(fs.readFileSync(process.env.E2E_INPUT)), after = read3MF(fs.readFileSync(path.join(exp, names[0])));
    const a = before.parts[0], b = after.parts.find((part) => part.name !== 'Argolla Relieve3D');
    const colors = (model, part) => [...part.tc].map((c) => model.palette[c]).join(',');
    ok(!!b && JSON.stringify([...a.V]) === JSON.stringify([...b.V]) && JSON.stringify([...a.T]) === JSON.stringify([...b.T]) && colors(before, a) === colors(after, b), 'reopened export preserves the original vertices, triangles and painted colours');
    ok(after.parts.some((part) => part.name === 'Argolla Relieve3D'), 'the ring is included in the exported object');
  }
  await load('Vista_armada_NO_IMPRIMIR.3mf');
  ok(await run(`document.querySelector('#keyring3mf [data-r=export]').disabled && /no como placa imprimible/i.test(document.querySelector('#keyring3mf [data-r=warn]').textContent)`), 'reference-only assemblies cannot be exported as printable');
  await run(`document.querySelector('#keyring3mf [data-a=home]').click()`);
  ok(await run(`!document.querySelector('#home').hidden && document.querySelector('#keyring3mf').hidden`), 'returning home closes the module');
  ok(!errors.length, 'console errors: ' + (errors.join(' | ') || 'none'));
  log('done');
};
