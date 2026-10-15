// E2E: "Separar colores 3D" — open a multicolor 3MF, split it, inspect views and plates, export.
// Run through test/e2e/run.mjs (env: E2E_DIR output folder, E2E_INPUT 3MF file, R3D_AUTOSAVE_DIR export folder).
// Optional env: E2E_MODE mode under test (default carve), E2E_FIRST_MODE a mode to run first (it may fail: the next run
// must still work), E2E_BODIES base pieces expected in carve mode (default 1).
const fs = require('fs');
const path = require('path');
module.exports = async ({ win, run, shot, wait }) => {
  const D = process.env.E2E_DIR, exp = process.env.R3D_AUTOSAVE_DIR;
  const errs = [];
  win.webContents.on('console-message', (e) => { if ((e.level === 'error' || e.level >= 3) && !/WebGLProgram|disk_cache/.test(e.message)) errs.push(e.message); });
  const log = (...a) => console.log('[e2e]', ...a);
  const ok = (c, m) => log(c ? 'ok  ' : 'FAIL', m);
  const S = async (n) => { win.show(); win.focus(); win.webContents.invalidate(); await wait(800); await shot(path.join(D, n + '.png')); };
  await win.setSize(1500, 900); await wait(500);
  await S('cs_00_home');
  ok(await run(`(() => { const b = document.querySelector('[data-mod="colorsplit"]'); if (!b) return false; b.click(); return true; })()`), 'module card opens');
  await wait(1500);
  const b64 = fs.readFileSync(process.env.E2E_INPUT).toString('base64');
  const name = path.basename(process.env.E2E_INPUT);
  const loaded = JSON.parse(await run(`(async () => { const bin = atob('${b64}'); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    await window.__r3d.colorsplit.loadFile(new File([u], ${JSON.stringify(name)})); const c = window.__r3d.colorsplit;
    return JSON.stringify({ palette: c.model.palette, names: c.model.names, split: !c.root.querySelector('[data-r=btnSplit]').disabled }); })()`));
  log('load', JSON.stringify(loaded));
  ok(loaded.palette.length >= 2 && loaded.split, `3MF read with ${loaded.palette.length} colours, split enabled`);
  await wait(1500);
  await S('cs_01_original');
  const rows = `JSON.stringify({ mode: window.__r3d.colorsplit.opts.mode, sel: document.querySelector('#colorsplit [data-k=mode]').value,
    skinRow: !document.querySelector('#colorsplit [data-r=skinRow]').hidden, carveRow: !document.querySelector('#colorsplit [data-r=carveRow]').hidden,
    sculptRow: !document.querySelector('#colorsplit [data-r=sculptRow]').hidden })`;
  const st0 = JSON.parse(await run(rows));
  ok(st0.mode === 'carve' && st0.sel === 'carve' && st0.carveRow && !st0.skinRow, `default mode is carve ("Tallado"), its thickness row shown (${JSON.stringify(st0)})`);
  const mode = process.env.E2E_MODE || 'carve';
  if (process.env.E2E_MODE) {
    const m = process.env.E2E_MODE;
    const st = JSON.parse(await run(`(() => { const s = document.querySelector('#colorsplit [data-k=mode]'); s.value = ${JSON.stringify(m)}; s.dispatchEvent(new Event('change', { bubbles: true }));
      return ${rows}; })()`));
    ok(st.mode === m && st.skinRow === ['skin', 'sculpt'].includes(m) && st.carveRow === (m === 'carve') && st.sculptRow === (m === 'sculpt'), `mode "${m}" selected in the UI (skin row ${st.skinRow ? 'shown' : 'hidden'}, carve row ${st.carveRow ? 'shown' : 'hidden'})`);
  }
  const setMode = (m) => run(`(() => { const s = document.querySelector('#colorsplit [data-k=mode]'); s.value = ${JSON.stringify(m)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  if (process.env.E2E_FIRST_MODE) {
    // a run in another mode first (one that may fail on this model, even inside the 3D engine): the next run must work
    const f = process.env.E2E_FIRST_MODE, nErr = errs.length, t1 = Date.now();
    await setMode(f);
    await run(`document.querySelector('#colorsplit [data-a=split]').click()`);
    for (let i = 0; i < 900; i++) { if (await run(`!window.__r3d.colorsplit._busy`)) break; await wait(1000); }
    const r1 = JSON.parse(await run(`JSON.stringify({ n: window.__r3d.colorsplit.res?.parts.length || 0, status: document.querySelector('#colorsplit [data-r=status]').textContent })`));
    log(`first run in ${f}`, ((Date.now() - t1) / 1000).toFixed(1) + ' s', JSON.stringify(r1));
    if (!r1.n) ok(!/Aborted/.test(r1.status) || /Tallado/.test(r1.status), `a failed ${f} run tells what to do (${r1.status})`);
    errs.splice(nErr); // its error is expected
    await run(`window.__r3d.colorsplit.res = null`);
    await setMode(mode);
  }
  const t0 = Date.now();
  await run(`document.querySelector('#colorsplit [data-a=split]').click()`);
  for (let i = 0; i < 600; i++) { if (await run(`!window.__r3d.colorsplit._busy`)) break; await wait(1000); }
  const res = JSON.parse(await run(`(() => { const c = window.__r3d.colorsplit, r = c.res; if (!r) return JSON.stringify({ error: document.querySelector('#colorsplit [data-r=status]').textContent });
    const k = {}; for (const p of r.parts) k[p.kind] = (k[p.kind] || 0) + 1;
    return JSON.stringify({ n: r.parts.length, k, warnings: r.warnings, covers: !!r.covers, skin: !!r.skin, carve: !!r.carve, sculpt: !!r.sculpt, previewOnly: !!r.previewOnly, plates: c.plates.length, summary: c.root.querySelector('[data-r=summary]').textContent }); })()`));
  log('split', ((Date.now() - t0) / 1000).toFixed(1) + ' s', JSON.stringify(res));
  ok(!res.error && res.n > 0, `split produced ${res.n || 0} parts`);
  const nBody = +(process.env.E2E_BODIES || 1); // base pieces expected (white letters on a pink layer are pieces of base)
  if (mode === 'carve') ok(res.carve && res.k.body === nBody && /tallados/.test(res.summary), `carve mode: ${nBody} base piece(s) (${res.k.body}) + carved colour pieces, summary explains it`);
  if (process.env.E2E_MODE === 'skin') ok(res.skin && res.k.body === 1 && /capas de color/.test(res.summary), 'skin mode: one whole base + colour skins, summary explains it');
  if (mode === 'sculpt') ok(res.sculpt && res.previewOnly && /Vista previa/.test(res.summary) && /reconstruidos/.test(res.summary) && !/original entero/.test(res.summary), 'sculpt is explicitly a reconstructed, non-printable preview');
  ok(!res.covers || (res.k.body || 0) >= 1, 'covers mode keeps a base body');
  if (res.carve || (res.covers && !res.skin)) ok(res.summary.includes(`base: ${res.k.body} pieza(s)`) && !/figura queda exacta/.test(res.summary), 'summary reports the actual base count, without promising a perfect fit');
  ok(!(res.warnings || []).some((w) => /piezas \(paredes|no se pudieron/.test(w)), 'no broken-base / failed-cover warnings');
  await S('cs_02_split');
  await run(`(() => { const e = document.querySelector('#colorsplit [data-r=explode]'); e.value = 0; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await S('cs_03_assembled');
  await run(`(() => { const e = document.querySelector('#colorsplit [data-r=explode]'); e.value = 0.8; e.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#colorsplit [data-pc="1"]')?.click(); })()`);
  await S('cs_04_exploded');
  await run(`document.querySelector('#colorsplit [data-tab=plates]').click()`);
  await wait(1200);
  await S('cs_05_plates');
  log('plates', await run(`[...document.querySelectorAll('#colorsplit [data-r=plateSel] option')].map((o) => o.textContent).join(' | ')`));
  await run(`window.__r3d.colorsplit.export()`);
  await wait(3000);
  const files = fs.existsSync(exp) ? fs.readdirSync(exp) : [];
  log('files', files.join(', '));
  if (res.previewOnly) {
    ok(!files.length, 'unfinished sculpt geometry is not exported, including programmatic export');
    ok(await run(`document.querySelector('#colorsplit [data-r=btnExport]').disabled`), 'preview export button stays disabled');
  } else ok(files.filter((f) => f.endsWith('.3mf')).length >= 2 && files.some((f) => f.endsWith('.txt')), 'plates 3MF + instructions exported');
  if (res.covers && !res.previewOnly) {
    const instructions = files.filter((f) => f.endsWith('.txt')).map((f) => fs.readFileSync(path.join(exp, f), 'utf8')).join('\n');
    ok(instructions.includes(`La BASE incluye ${res.k.body} pieza(s)`) && /bordes afinados/.test(instructions), 'export describes actual base pieces and the need to inspect tapered edges');
  }
  ok(!errs.length, 'console errors: ' + (errs.join(' | ') || 'none'));
  log('done');
};
