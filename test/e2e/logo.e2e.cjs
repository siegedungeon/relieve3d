// E2E: "Logo / figura en relieve" — load an image, vectorize, view 2D/3D, export 3MF, STL and SVG.
// Run through test/e2e/run.mjs (env: E2E_DIR output folder, E2E_INPUT image, R3D_AUTOSAVE_DIR export folder).
const fs = require('fs');
const path = require('path');
module.exports = async ({ win, run, shot, wait }) => {
  const D = process.env.E2E_DIR, exp = process.env.R3D_AUTOSAVE_DIR;
  const errs = [];
  win.webContents.on('console-message', (e) => { if ((e.level === 'error' || e.level >= 3) && !/WebGLProgram|disk_cache/.test(e.message)) errs.push(e.message); });
  const log = (...a) => console.log('[e2e]', ...a);
  const ok = (c, m) => log(c ? 'ok  ' : 'FAIL', m);
  const S = async (n) => { win.show(); win.focus(); win.webContents.invalidate(); await wait(800); await shot(path.join(D, n + '.png')); };
  await win.setSize(1600, 950); await wait(500);
  await run(`window.__r3d.enterModule('logo')`); await wait(1500);
  const img = fs.readFileSync(process.env.E2E_INPUT).toString('base64');
  await run(`(async()=>{const b=new Blob([Uint8Array.from(atob('${img}'),c=>c.charCodeAt(0))],{type:'image/png'});await window.__r3d.loadImageFile(new File([b],'logo.png',{type:'image/png'}));})()`);
  await wait(4000);
  const r = JSON.parse(await run(`JSON.stringify({pal:window.__r3d.S.result?.palette.map(p=>p.hex), n:window.__r3d.S.result?.pieces.length, w:window.__r3d.S.settings.widthMM})`));
  log('vectorized', JSON.stringify(r));
  ok(r.n > 0 && r.pal.length >= 1, `${r.n} pieces in ${r.pal ? r.pal.length : 0} colours`);
  // every enclosed piece whose colour differs from its only neighbour is a counter: it must not be painted over
  const counters = JSON.parse(await run(`JSON.stringify(window.__r3d.S.result.pieces.filter(p=>p.neighbors.length===1).map(p=>[p.cluster, window.__r3d.S.result.pieces[p.neighbors[0]].cluster]))`));
  ok(counters.every(([a, b]) => a !== b), `enclosed pieces keep their own colour (${counters.length})`);
  await run(`window.__r3d.setViewMode('2d')`); await S('logo_01_2d');
  await run(`window.__r3d.setViewMode('3d')`); await wait(1000); await S('logo_02_3d');
  await run(`window.__r3d.viewer.frame(true)`); await wait(1000); await S('logo_03_top');
  for (const k of ['3mf', 'stl-one', 'svg']) { await run(`window.__r3d.doExport('${k}')`); await wait(2500); }
  const files = fs.existsSync(exp) ? fs.readdirSync(exp) : [];
  log('files', files.map((f) => f + ' ' + fs.statSync(path.join(exp, f)).size + 'B').join(', '));
  ok(['.3mf', '.stl', '.svg'].every((x) => files.some((f) => f.endsWith(x) && fs.statSync(path.join(exp, f)).size > 1000)), '3MF, STL and SVG exported');
  ok(!errs.length, 'console errors: ' + (errs.join(' | ') || 'none'));
  log('done');
};
