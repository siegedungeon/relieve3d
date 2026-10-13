// E2E: "Hablador acrílico" — measurements, calibres and sheets through the form, generate from a frontal mockup,
// every tab, QR label edit, export of the cut SVGs, project save + reopen.
// Run through test/e2e/run.mjs (env: E2E_DIR output folder, E2E_INPUT mockup image, R3D_AUTOSAVE_DIR export folder).
const fs = require('fs');
const path = require('path');
module.exports = async ({ win, run, shot, wait }) => {
  const D = process.env.E2E_DIR, exp = process.env.R3D_AUTOSAVE_DIR;
  const errs = [];
  win.webContents.on('console-message', (e) => { if ((e.level === 'error' || e.level >= 3) && !/WebGLProgram|disk_cache/.test(e.message)) errs.push(e.message); });
  const log = (...a) => console.log('[e2e]', ...a);
  const ok = (c, m) => log(c ? 'ok  ' : 'FAIL', m);
  const S = async (n) => { win.show(); win.focus(); win.webContents.invalidate(); await wait(600); await shot(path.join(D, n + '.png')); };
  const setVal = (sel, v) => run(`(()=>{const e=document.querySelector('#hablador ${sel}'); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true})()`);
  const M = async (expr) => JSON.parse(await run(`JSON.stringify((m=>(${expr}))(window.__r3d.hablador.model))`));
  const tab = async (t) => { await run(`document.querySelector('#hablador [data-tab="${t}"]').click()`); await wait(800); };
  await win.setSize(1600, 950); await wait(500);
  await run(`window.__r3d.enterModule('hablador')`); await wait(3000);
  // 1. target measurements, calibres (black 3 mm, white 4 mm), sheets and the -0.2 mm press fit
  for (const [k, v] of [['height', '250'], ['width', '170'], ['depth', '80'], ['black.t', '3'], ['white.t', '4'], ['black.sheet.w', '450'], ['black.sheet.h', '300'], ['white.sheet.w', '120'], ['white.sheet.h', '300'], ['clearance', '-0.2'], ['sheet.gap', '2']]) await setVal(`[data-k="${k}"]`, v);
  await wait(2000);
  const slots = await M(`m.slots.map(s=>Math.min(s.w,s.h))`);
  log('slot widths', slots.map((v) => +v.toFixed(2)).join(' '));
  ok(slots.length > 0 && slots.every((w) => [2.8, 3.8].some((t) => Math.abs(w - t) < 0.02)), 'slots are calibre − 0.2 mm (2.8 black / 3.8 white)');
  await S('hb_01_param_assembly');
  // 2. generate from the frontal mockup
  const mock = fs.readFileSync(process.env.E2E_INPUT).toString('base64');
  await run(`window.__r3d.hablador._genAfterLoad = true`);
  await run(`(async()=>{const b=new Blob([Uint8Array.from(atob('${mock}'),c=>c.charCodeAt(0))],{type:'image/png'});await window.__r3d.hablador.loadMockup(new File([b],'mockup.png',{type:'image/png'}));})()`);
  await wait(2500);
  const mm = await M(`{source:m.cfg.source, white:m.pieces.filter(p=>p.mat==='white').length, black:m.pieces.filter(p=>p.mat==='black').length, qr:m.cfg.qr.items.length, warn:m.warnings}`);
  log('from mockup', JSON.stringify(mm));
  ok(mm.source === 'mockup' && mm.white > 0 && mm.black > 0, `mockup traced: ${mm.white} white + ${mm.black} black pieces, ${mm.qr} QR plates`);
  await S('hb_02_mockup_assembly');
  await tab('mockup'); await S('hb_03_mockup_compare');
  for (const t of ['white', 'black', 'jig', 'print']) {
    await tab(t);
    const n = await run(`document.querySelectorAll('#hablador .hb-page > svg').length`);
    ok(t === 'print' || n > 0, `tab ${t}: ${n} sheet(s)`);
    await S('hb_04_' + t);
  }
  // 3. export + project round trip
  await run(`window.__r3d.hablador.export()`); await wait(1500);
  await run(`window.__r3d.hablador.saveProject()`); await wait(800);
  const files = fs.existsSync(exp) ? fs.readdirSync(exp) : [];
  log('files', files.join(', '));
  const cuts = files.filter((f) => /_corte_/.test(f));
  for (const f of cuts) { const t = fs.readFileSync(path.join(exp, f), 'utf8'); log(' ', f, (t.match(/width="[\d.]+mm" height="[\d.]+mm"/) || ['?'])[0], (t.match(/<path /g) || []).length, 'paths'); }
  ok(cuts.some((f) => /_white_/.test(f)) && cuts.some((f) => /_black_/.test(f)), 'cut SVGs for white and black sheets');
  ok(cuts.filter((f) => !/_jig_/.test(f)).every((f) => new RegExp(/_black_/.test(f) ? 'width="450mm" height="300mm"' : 'width="120mm" height="300mm"').test(fs.readFileSync(path.join(exp, f), 'utf8'))), 'cut SVGs use the sheet sizes (450×300, 120×300)');
  const proj = files.find((f) => f.endsWith('.r3h'));
  ok(!!proj, 'project saved');
  await run(`document.querySelector('#hablador [data-a="reset"]').click()`); await wait(1500);
  if (proj) await run(`window.__r3d.hablador.openProject(${fs.readFileSync(path.join(exp, proj), 'utf8')})`);
  await wait(3000);
  const re = await M(`{source:m.cfg.source, white:m.pieces.filter(p=>p.mat==='white').length}`);
  ok(re.source === 'mockup' && re.white === mm.white, 'project reopens with the same pieces');
  await tab('assembly'); await S('hb_05_reopened');
  ok(!errs.length, 'console errors: ' + (errs.join(' | ') || 'none'));
  log('done');
};
