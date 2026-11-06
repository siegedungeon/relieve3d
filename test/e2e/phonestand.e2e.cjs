// E2E: «Soporte celular llavero» — the whole user flow, from the home card: default heart stand, client's logo dropped
// on the window, every top shape, Mickey-style head with NFC + can opener + brand name through the form, measurements
// limited to their range, colours repainted without rebuilding, the three views + opening animation, a custom
// silhouette through the file input, exports with the real buttons (3MF with colours and the NFC pause, STL, photo,
// project .r3p), reset, project reopened by dropping it, back home and reopened from the home screen.
// Run through test/e2e/run.mjs (env: E2E_DIR output folder, E2E_INPUT logo image, R3D_AUTOSAVE_DIR export folder).
const fs = require('fs');
const path = require('path');
const { unzipSync, strFromU8 } = require('fflate');

module.exports = async ({ win, run, shot, wait }) => {
  const D = process.env.E2E_DIR, exp = process.env.R3D_AUTOSAVE_DIR;
  const errs = [];
  win.webContents.on('console-message', (e) => { if ((e.level === 'error' || e.level >= 3) && !/WebGLProgram|disk_cache/.test(e.message)) errs.push(e.message); });
  const log = (...a) => console.log('[e2e]', ...a);
  const ok = (c, m) => log(c ? 'ok  ' : 'FAIL', m);
  const S = async (n) => { win.show(); win.focus(); win.webContents.invalidate(); await wait(600); await shot(path.join(D, n + '.png')); };
  // evaluate `expr` in the page with ps = the studio; returns plain JSON data
  const P = (expr) => run(`(async(ps)=>JSON.stringify(await (${expr})))(window.__r3d.phonestand)`).then((t) => (t === undefined ? undefined : JSON.parse(t)));
  const idle = () => run('window.__r3d.phonestand.whenIdle().then(()=>true)');
  const until = async (expr, ms = 30000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(150)) if (await P(expr)) return true; return false; };
  const q = (sel) => `document.querySelector('#phonestand ${sel}')`;
  const click = (sel) => run(`(${q(sel)}.click(), true)`);
  // types a value like the user: input while typing, change when leaving the field; returns what the field shows after
  const setVal = (k, v) => run(`(()=>{const e=${q(`[data-k="${k}"]`)}; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return e.value})()`);
  const check = (k, on) => run(`(()=>{const e=${q(`[data-k="${k}"]`)}; if (e.checked !== ${on}) e.click(); return e.checked})()`);
  const dropFile = (buf, name, type) => run(`(()=>{const b=Uint8Array.from(atob('${buf.toString('base64')}'),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([b],${JSON.stringify(name)},{type:${JSON.stringify(type)}}));document.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return true})()`);
  const info = () => P(`({shape: ps.res.info.shape.id, warnings: ps.res.warnings, parts: ps.res.parts.map(p=>({name:p.name, fil:p.filamentIndex, moving:!!p.moving})), pauses: ps.res.pauses,
    nfc: ps.res.info.nfc, opener: ps.res.info.opener, art: ps.res.info.art, size: ps.res.info.size, grams: ps.res.info.grams, stability: ps.res.info.stability, cfg: ps.res.cfg})`);
  // warnings that mean the piece would not print as designed
  const blocking = (w) => w.filter((s) => /sueltas|no cabe|vací|recorta|pegada|pequeño|no se pudo|no se encontró/i.test(s));
  const shown = () => run(`[document.getElementById('phonestand').hidden, document.getElementById('home').hidden]`);
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const waitFile = async (f, ms = 30000) => {
    const p = path.join(exp, f);
    for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(150)) if (fs.existsSync(p) && fs.statSync(p).size > 0) { await wait(300); return fs.readFileSync(p); }
    return null;
  };

  await win.setSize(1600, 950); await wait(500);

  // 1. open the module from its card on the home screen
  await run('(window.__r3d.showHome(), true)');
  await run(`(document.querySelector('#homeGrid3d [data-mod="phonestand"]').click(), true)`);
  ok(await until('!!ps.res && !ps.building'), 'module opens from its home card and builds the default stand');
  let [psHidden, homeHidden] = await shown();
  ok(!psHidden && homeHidden, 'studio on screen, home hidden');
  const i0 = await info();
  log('default', JSON.stringify({ shape: i0.shape, size: i0.size, grams: f1(i0.grams), parts: i0.parts.map((p) => p.name), stability: i0.stability, warnings: i0.warnings }));
  ok(i0.shape === 'heart' && i0.parts.some((p) => p.name === 'Cuerpo' && !p.moving) && i0.parts.some((p) => p.name === 'Tapa (bisagra)' && p.moving) && !i0.warnings.length,
    'default: heart on top, body + hinged flap, no warnings');
  ok(i0.stability.portrait >= 0 && i0.stability.landscape >= 0, 'default stand holds the phone upright and sideways');
  const thumbs = await run(`document.querySelectorAll('#phonestand [data-shape] svg path').length`);
  const up = await run(`!!document.querySelector('#phonestand [data-shape="custom"] .ps-up')`);
  ok(thumbs === 10 && up, `shape buttons show the live outline of each shape (${thumbs}/10) and «Tu silueta» an upload button`);
  await S('ps_01_default');

  // 2. client's logo dropped on the window
  const logoBuf = fs.readFileSync(process.env.E2E_INPUT);
  await dropFile(logoBuf, 'logo-cliente.png', 'image/png');
  ok(await until('!!ps.logoImg'), 'dropped logo is loaded');
  await idle();
  const i1 = await info();
  ok(!!i1.art.top?.logo && !blocking(i1.warnings).length, `logo on the heart: ${i1.art.top ? `${f1(i1.art.top.w)} × ${f1(i1.art.top.h)} mm` : 'missing'} ${i1.warnings.join(' | ')}`);
  ok(i1.parts.some((p) => p.fil === 1), 'logo in the 2nd colour');
  ok(await run(`!!document.querySelector('#phonestand [data-r=logoBox] img')`), 'logo thumbnail in the panel');
  await S('ps_02_logo_heart');

  // 3. every top shape: each one must print as one body + one flap, with the logo on it
  const shapes = await P(`[...document.querySelectorAll('#phonestand [data-shape]')].map(b=>b.dataset.shape).filter(s=>s!=='custom')`);
  const bad = [];
  for (const s of shapes) {
    await click(`[data-shape="${s}"]`); await idle();
    const r = await info();
    const active = await run(`document.querySelector('#phonestand .ps-shape.active')?.dataset.shape`);
    log(`  ${s}: ${f1(r.size.w)} × ${f1(r.size.l)} × ${f1(r.size.h)} mm, ${f1(r.grams)} g, logo ${r.art.top ? `${f1(r.art.top.w)}×${f1(r.art.top.h)}` : '—'}, estable ${r.stability.portrait >= 0 && r.stability.landscape >= 0 ? 'sí' : 'NO'}${r.warnings.length ? ' — ' + r.warnings.join(' | ') : ''}`);
    if (r.shape !== s || active !== s || !r.art.top?.logo || blocking(r.warnings).length || r.parts.filter((p) => /^Cuerpo|^Tapa/.test(p.name)).length !== 2) bad.push(s);
    if (['mouse', 'flower', 'bear', 'star'].includes(s)) await S('ps_03_' + s);
  }
  ok(shapes.length === 10 && !bad.length, `all ${shapes.length} shapes build with the logo: ${bad.length ? 'problems in ' + bad.join(', ') : 'ok'}`);

  // 4. Mickey-style head + NFC chip + can opener + brand name, through the form
  await click('[data-shape="mouse"]');
  ok((await check('nfc.enabled', true)) && (await check('opener.enabled', true)) && (await check('text.enabled', true)), 'NFC, can opener and text switched on');
  ok(await run(`['nfc','opener','text'].every(k=>!document.querySelector('#phonestand [data-show="'+k+'"]').hidden)`), 'their options appear');
  await setVal('text.value', 'Pabonitas');
  await idle();
  const i2 = await info();
  log('mouse + extras', JSON.stringify({ nfc: i2.nfc, opener: i2.opener, top: i2.art.top, flap: i2.art.flap, pauses: i2.pauses, warnings: i2.warnings }));
  ok(i2.shape === 'mouse' && !!i2.art.top?.logo && !!i2.art.flap?.text, 'logo on the head, «Pabonitas» on the flap');
  ok(!!i2.nfc && i2.pauses.length === 1 && Math.abs(i2.pauses[0].z - i2.nfc.z1) < 1e-6 && /NFC/.test(i2.pauses[0].msg), `NFC pocket ${i2.nfc ? `${i2.nfc.where} Ø${f1(2 * i2.nfc.r)}` : 'missing'} with a pause at Z = ${i2.pauses[0] ? f1(i2.pauses[0].z) : '?'} mm`);
  ok(!!i2.opener, `can opener on the ${i2.opener?.side} edge`);
  ok(!blocking(i2.warnings).length, 'no blocking warnings: ' + (i2.warnings.join(' | ') || 'none'));
  // with every extra on, «Resultado» has its longest list: all rows must be visible, none hidden behind an inner scroll bar
  const lst = await run(`(()=>{const l=${q('[data-r=list]')}; return [l.scrollHeight, l.clientHeight, l.querySelectorAll('.hb-pc').length]})()`);
  ok(lst[2] > 5 && lst[0] <= lst[1] + 1, `«Resultado» shows all ${lst[2]} rows without an inner scroll (${lst[1]} of ${lst[0]} px visible)`);
  await S('ps_04_mouse_full');

  // 5. measurements: limited to their range when leaving the field, decimal comma accepted
  const wShown = await setVal('width', '99');
  ok(wShown === '60' && (await P('ps.cfg.width')) === 60, `width 99 → field shows ${wShown} (range 38–60)`);
  await setVal('width', '50');
  await setVal('clearance', '0,5');
  await idle();
  const i3 = await info();
  ok(i3.cfg.width === 50 && i3.cfg.clearance === 0.5 && i3.size.w >= 50 - 0.01, `width 50 mm and clearance «0,5» used (model ${f1(i3.size.w)} mm wide)`);
  ok(!blocking(i3.warnings).length, 'still printable: ' + (i3.warnings.join(' | ') || 'no warnings'));

  // 6. colours only repaint (no rebuild)
  const seq0 = await P('ps.seq');
  await setVal('colors.accent', '#1d4ed8');
  await setVal('colors.body', '#fde68a');
  await wait(400);
  const col = await P(`({seq: ps.seq, parts: ps.res.parts.map((p,i)=>[p.filamentIndex, p.color, '#'+ps.viewer.meshes.get('p'+i).material.color.getHexString()])})`);
  ok(col.seq === seq0 && col.parts.every(([f, c, m]) => c === (f ? '#1d4ed8' : '#fde68a') && m === c), 'colours repaint the model without rebuilding');

  // 7. the three views and the opening animation
  for (const t of ['print', 'stand', 'top']) {
    await click(`[data-tab="${t}"]`); await wait(300);
    const st = await P(`({amt: ps.amt, phone: ps.viewer.extras.get('phone')?.visible, active: document.querySelector('#phonestand [data-tab].active')?.dataset.tab})`);
    ok(st.active === t && st.amt === (t === 'stand' ? 1 : 0) && st.phone === (t === 'stand'), `tab ${t}: flap ${st.amt ? 'open' : 'closed'}, phone ${st.phone ? 'on the stand' : 'hidden'}`);
    await S('ps_05_tab_' + t);
  }
  await click('[data-tab="print"]');
  await click('[data-a="animate"]'); await wait(2200);
  const an = await P(`({amt: ps.amt, rot: ps.pivot.rotation.x, theta: ps.res.info.thetaOpen, range: +ps.root.querySelector('[data-r=amt]').value})`);
  ok(Math.abs(an.amt - 1) < 1e-6 && an.range === 1 && Math.abs(an.rot + (an.theta * Math.PI) / 180) < 1e-6, `animation opens the flap ${f1(an.theta)}° on the hinge`);
  await S('ps_06_animated_open');

  // 8. «Tu silueta»: a cat silhouette drawn on a canvas, given to the file input like the file picker does
  await run(`(async()=>{const c=document.createElement('canvas');c.width=c.height=400;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,400,400);x.fillStyle='#111';
    x.beginPath();x.arc(200,235,135,0,Math.PI*2);x.fill();
    for(const s of [1,-1]){x.beginPath();x.moveTo(200-s*130,190);x.lineTo(200-s*115,25);x.lineTo(200-s*20,110);x.closePath();x.fill();}
    const b=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([b],'gato.png',{type:'image/png'}));
    const inp=document.querySelector('#phonestand [data-r=fileShape]');inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  ok(await until('!!ps.shapeImg && ps.cfg.shape === "custom"'), 'custom silhouette loaded and selected');
  await idle();
  const i4 = await info();
  const cthumb = await run(`!!document.querySelector('#phonestand [data-shape="custom"] svg path')`);
  ok(i4.shape === 'custom' && cthumb && !!i4.art.top?.logo && !blocking(i4.warnings).length, `custom silhouette builds with the logo, button shows its outline ${i4.warnings.join(' | ')}`);
  await click('[data-tab="print"]');
  await S('ps_07_custom_silhouette');
  await click('[data-shape="mouse"]'); await idle();

  // 9. exports with the real buttons
  await setVal('name', 'Pabonitas raton');
  const fin = await info();
  const files = {};
  for (const [a, ext] of [['3mf', '3mf'], ['stl', 'stl'], ['photo', 'png'], ['saveCfg', 'r3p']]) {
    await click(`[data-a="${a}"]`);
    files[ext] = await waitFile('Pabonitas raton.' + ext);
    ok(!!files[ext], `«${a}» saved Pabonitas raton.${ext}${files[ext] ? ` (${Math.round(files[ext].length / 1024)} KB)` : ''}`);
  }
  if (files['3mf']) {
    const z = unzipSync(files['3mf']);
    const model = strFromU8(z['3D/3dmodel.model']);
    const objs = [...model.matchAll(/<object id="\d+" type="model" name="([^"]+)" pid="1" pindex="(\d)"/g)].map((m) => [m[1], +m[2]]);
    const mats = [...model.matchAll(/<base name="[^"]+" displaycolor="(#[0-9A-F]{6})FF"/g)].map((m) => m[1]);
    log('3MF objects', JSON.stringify(objs), 'filaments', mats.join(' '));
    ok(objs.length === fin.parts.length && objs.every(([n, f], i) => n === fin.parts[i].name && f === fin.parts[i].fil), `3MF: ${objs.length} parts with their filament`);
    ok(mats.length === 2 && mats[0] === '#FDE68A' && mats[1] === '#1D4ED8', '3MF filament colours = body + accent');
    const pause = z['Metadata/custom_gcode_per_layer.xml'] ? strFromU8(z['Metadata/custom_gcode_per_layer.xml']) : '';
    const pz = +((pause.match(/top_z="([\d.]+)"/) || [])[1]);
    ok(/gcode="M400 U1"/.test(pause) && /chip NFC/.test(pause) && Math.abs(pz - fin.pauses[0].z) < 0.01, `3MF pauses at Z = ${pz} mm to insert the NFC chip`);
  }
  if (files.stl) {
    const n = files.stl.readUInt32LE(80);
    ok(n > 1000 && files.stl.length === 84 + 50 * n, `STL: ${n} triangles`);
  }
  if (files.png) {
    const wpx = files.png.readUInt32BE(16), hpx = files.png.readUInt32BE(20);
    ok(files.png.readUInt32BE(0) === 0x89504e47 && wpx > 400 && hpx > 300, `photo PNG ${wpx}×${hpx}`);
  }
  let proj = null;
  try { proj = JSON.parse(files.r3p.toString('utf8')); } catch { /* reported below */ }
  ok(proj?.app === 'Relieve3D-SoporteCelular' && proj.cfg.shape === 'mouse' && proj.cfg.nfc.enabled && proj.cfg.opener.enabled && proj.cfg.text.value === 'Pabonitas'
    && /^data:image\/png/.test(proj.logoSrc || '') && /^data:image\/png/.test(proj.shapeSrc || ''), 'project keeps the design, the logo and the silhouette');

  // 10. reset keeps the logo; dropping the .r3p brings the whole design back
  await click('[data-a="reset"]'); await idle();
  const rs = await P(`({shape: ps.cfg.shape, nfc: ps.cfg.nfc.enabled, width: ps.cfg.width, logo: !!ps.logoImg, art: !!ps.res.info.art.top?.logo})`);
  ok(rs.shape === 'heart' && !rs.nfc && rs.width === 46 && rs.logo && rs.art, 'reset: default measurements, logo kept');
  if (files.r3p) await dropFile(files.r3p, 'Pabonitas raton.r3p', 'application/json');
  ok(await until(`ps.cfg.shape === 'mouse' && !!ps.res && ps.res.cfg.shape === 'mouse' && !ps.building`), 'dropped .r3p reopens the design');
  const re = await info();
  const same = JSON.stringify(re.cfg) === JSON.stringify(proj?.cfg);
  ok(same && !!re.art.top?.logo && !!re.art.flap?.text && re.pauses.length === 1 && !!re.opener && Math.abs(re.grams - fin.grams) < 0.01, `same settings, logo, text, NFC and opener (${f1(re.grams)} g)`);
  await S('ps_08_reopened');

  // 11. back home and open the project from the home screen
  await click('[data-a="home"]'); await wait(300);
  [psHidden, homeHidden] = await shown();
  ok(psHidden && !homeHidden, '⌂ Inicio goes back home');
  await run(`(window.__r3d.openProjectFile(new File([${JSON.stringify(files.r3p ? files.r3p.toString('utf8') : '{}')}], 'Pabonitas raton.r3p')), true)`);
  ok(await until(`!document.getElementById('phonestand').hidden && document.getElementById('home').hidden && !!ps.res && !ps.building`), 'project opened from home shows the studio');
  const hm = await info();
  ok(JSON.stringify(hm.cfg) === JSON.stringify(proj?.cfg) && hm.pauses.length === 1, 'same design after opening from home');
  // a broken project file keeps the screen as it was and explains why
  await run(`(window.__r3d.openProjectFile(new File(['{"app":"Relieve3D-SoporteCelular","version":9,"cfg":{}}'], 'roto.r3p')), true)`); await wait(800);
  const toast = await run(`document.getElementById('toast').textContent`);
  [psHidden] = await shown();
  ok(!psHidden && /no compatible/i.test(toast), `broken project: studio stays, message «${toast}»`);
  await S('ps_09_final');

  ok(!errs.length, 'console errors: ' + (errs.join(' | ') || 'none'));
  log('done');
};
