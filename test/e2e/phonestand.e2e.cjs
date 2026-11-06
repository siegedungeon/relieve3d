// E2E: «Soporte celular llavero» — the whole user flow, from the home card: default heart stand whose leg turns on the
// print-in-place hinge (printed standing, folds into its slot, opens onto its stop with the phone on it), client's logo
// dropped on the window, every top shape, Mickey-style head with NFC (gold chip seen through the body, 📶 tap sign) +
// can opener + brand name through the form, measurements limited to their range, both sizes and the short model (the
// can opener makes the star longer), colours repainted without rebuilding, the four views + leg slider + opening
// animation, a custom silhouette through the file input, exports with the real buttons (3MF with colours and the NFC
// pause but no chip, STL, photo, project .r3p), reset, project reopened by dropping it, a v1.17 project migrated to
// the hinge, back home and reopened from the home screen, broken project.
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
  const info = () => P(`({shape: ps.res.info.shape.id, grow: ps.res.info.shape.grow, growFor: ps.res.info.shape.growFor, warnings: ps.res.warnings, pauses: ps.res.pauses,
    parts: ps.res.parts.map(p=>({name:p.name, fil:p.filamentIndex, moving:!!p.moving, preview:!!p.preview})), pieces: ps.res.info.parts,
    nfc: ps.res.info.nfc, opener: ps.res.info.opener, art: ps.res.info.art, size: ps.res.info.size, closed: ps.res.info.closedSize, grams: ps.res.info.grams,
    stability: ps.res.info.stability, model: ps.res.info.model, phone: ps.res.info.phone, hinge: ps.res.info.hinge, latch: ps.res.info.latch, cfg: ps.res.cfg})`);
  // value column of a «Resultado» row by its label
  const row = (k) => run(`[...document.querySelectorAll('#phonestand [data-r=list] .hb-pc')].map(r=>[...r.children].map(c=>c.textContent.trim())).find(([a])=>a===${JSON.stringify(k)})?.[1] ?? ''`);
  // the leg in the 3D view: slider amount, pivot rotation (rad), poses (deg from the print pose), phone shown, active tab
  const legState = () => P(`({amt: ps.amt, rot: ps.pivot.rotation.x, range: +ps.root.querySelector('[data-r=amt]').value, poses: ps.res.info.poses,
    phone: !!ps.viewer.extras.get('phone')?.visible, tab: document.querySelector('#phonestand [data-tab].active')?.dataset.tab})`);
  const poseOf = (s) => s.poses.closed + (s.poses.stand - s.poses.closed) * s.amt;
  const D2R = Math.PI / 180;
  // warnings that mean the piece would not print as designed
  const blocking = (w) => w.filter((s) => /sueltas|no cabe|vací|recorta|pegada|pequeño|no se pudo|no se encontró|no hay un borde|no queda espacio|solo caben/i.test(s));
  const shown = () => run(`[document.getElementById('phonestand').hidden, document.getElementById('home').hidden]`);
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const waitFile = async (f, ms = 30000) => {
    const p = path.join(exp, f);
    for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(150)) if (fs.existsSync(p) && fs.statSync(p).size > 0) { await wait(300); return fs.readFileSync(p); }
    return null;
  };

  await win.setSize(1600, 950); await wait(500);

  // 1. open the module from its card on the home screen: the stand prints with its leg standing on the hinge
  await run('(window.__r3d.showHome(), true)');
  await run(`(document.querySelector('#homeGrid3d [data-mod="phonestand"]').click(), true)`);
  ok(await until('!!ps.res && !ps.building'), 'module opens from its home card and builds the default stand');
  let [psHidden, homeHidden] = await shown();
  ok(!psHidden && homeHidden, 'studio on screen, home hidden');
  const i0 = await info();
  log('default', JSON.stringify({ shape: i0.shape, size: i0.size, closed: i0.closed, grams: f1(i0.grams), parts: i0.parts.map((p) => p.name), phone: i0.phone, stability: i0.stability, hinge: i0.hinge, warnings: i0.warnings }));
  ok(i0.shape === 'heart' && i0.parts.map((p) => p.name + (p.moving ? '↻' : '')).join() === 'Cuerpo,Pata (bisagra)↻' && i0.pieces.body === 1 && i0.pieces.leg === 1 && !i0.warnings.length,
    'default: heart on top, body + leg that turns on the hinge, one piece each, no warnings');
  ok(i0.model.size === 'small' && i0.model.variant === 'standard' && i0.model.thickness === 11 && !!i0.latch && i0.hinge.clearance === 0.3 && i0.hinge.gap >= 0.27,
    `small standard model, 11 mm thick, hinge clearance 0.3 mm (leg ${i0.hinge.gap.toFixed(2)} mm from the body), snaps closed`);
  ok(i0.phone.angle > 59 && i0.phone.angle < 62 && i0.phone.tMax >= 11.5 && i0.stability.portrait >= 0 && i0.stability.landscape >= 0,
    `phone leans at ${f1(i0.phone.angle)}°, up to ${f1(i0.phone.tMax)} mm thick with its case, steady upright and sideways`);
  ok(i0.size.h > i0.model.thickness + 10 && i0.closed.h <= i0.model.thickness + 1e-3, `prints with the leg standing (${f1(i0.size.h)} mm tall) and folds flat (${f1(i0.closed.h)} mm)`);
  const l0 = await legState();
  ok(l0.tab === 'print' && Math.abs(l0.rot) < 1e-6 && Math.abs(poseOf(l0)) < 1e-6 && !l0.phone, `opens on «Como se imprime»: leg standing as printed (slider ${l0.amt.toFixed(3)}), no phone`);
  const r0 = [await row('Bisagra'), await row('Cierre'), await row('Celular')];
  ok(/conos Ø/.test(r0[0]) && /clic de 0,3 mm/.test(r0[1]) && /inclinado 6\d/.test(r0[2]), `«Resultado» explains the hinge: ${r0.join(' · ')}`);
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
  ok(i1.parts.some((p) => p.name === 'Logo' && p.fil === 1 && !p.moving), 'logo in the 2nd colour, fixed on the body');
  ok(await run(`!!document.querySelector('#phonestand [data-r=logoBox] img')`), 'logo thumbnail in the panel');
  await S('ps_02_logo_heart');

  // 3. every top shape: each one must print as one body + one hinged leg, with the logo on it
  const shapes = await P(`[...document.querySelectorAll('#phonestand [data-shape]')].map(b=>b.dataset.shape).filter(s=>s!=='custom')`);
  const bad = [];
  for (const s of shapes) {
    await click(`[data-shape="${s}"]`); await idle();
    const r = await info();
    const active = await run(`document.querySelector('#phonestand .ps-shape.active')?.dataset.shape`);
    log(`  ${s}: ${f1(r.size.w)} × ${f1(r.size.l)} × ${f1(r.closed.h)} mm cerrado, ${f1(r.grams)} g, logo ${r.art.top ? `${f1(r.art.top.w)}×${f1(r.art.top.h)}` : '—'}, estable ${r.stability.portrait >= 0 && r.stability.landscape >= 0 ? 'sí' : 'NO'}${r.warnings.length ? ' — ' + r.warnings.join(' | ') : ''}`);
    const hinge = r.parts.filter((p) => (p.name === 'Cuerpo' && !p.moving) || (p.name === 'Pata (bisagra)' && p.moving)).length === 2 && r.pieces.body === 1 && r.pieces.leg === 1;
    if (r.shape !== s || active !== s || !r.art.top?.logo || blocking(r.warnings).length || !hinge || r.stability.portrait < 0) bad.push(s);
    if (['mouse', 'flower', 'bear', 'star'].includes(s)) await S('ps_03_' + s);
  }
  ok(shapes.length === 10 && !bad.length, `all ${shapes.length} shapes build on the hinge with the logo: ${bad.length ? 'problems in ' + bad.join(', ') : 'ok'}`);

  // 4. Mickey-style head + NFC chip + can opener + brand name, through the form
  await click('[data-shape="mouse"]');
  ok((await check('nfc.enabled', true)) && (await check('opener.enabled', true)) && (await check('text.enabled', true)), 'NFC, can opener and text switched on');
  ok(await run(`['nfc','opener','text'].every(k=>!document.querySelector('#phonestand [data-show="'+k+'"]').hidden)`), 'their options appear');
  await setVal('text.value', 'Pabonitas');
  await idle();
  const i2 = await info();
  log('mouse + extras', JSON.stringify({ grow: i2.grow, growFor: i2.growFor, nfc: i2.nfc, opener: i2.opener, top: i2.art.top, bar: i2.art.bar, pauses: i2.pauses, warnings: i2.warnings }));
  ok(i2.shape === 'mouse' && !!i2.art.top?.logo && !!i2.art.bar?.text && i2.parts.some((p) => p.name === 'Texto (barra)'), 'logo on the head, «Pabonitas» on the bar behind the hinge');
  ok(!!i2.nfc && i2.pauses.length === 1 && Math.abs(i2.pauses[0].z - i2.nfc.z1) < 1e-6 && /NFC/.test(i2.pauses[0].msg),
    `NFC pocket ${i2.nfc ? `Ø${f1(2 * i2.nfc.r)} at z ${i2.nfc.z0}–${i2.nfc.z1}` : 'missing'} with a pause at Z = ${i2.pauses[0] ? f1(i2.pauses[0].z) : '?'} mm`);
  // the hidden chip is drawn in gold through the body (x-ray), as a view-only part
  const chip = await P(`(()=>{const i=ps.res.parts.findIndex(p=>p.preview), m=ps.viewer.meshes.get('p'+i); return i<0||!m ? null : {name:ps.res.parts[i].name, fil:ps.res.parts[i].filamentIndex, visible:m.visible, depthTest:m.material.depthTest, transparent:m.material.transparent, color:'#'+m.material.color.getHexString()}})()`);
  ok(chip?.name === 'Chip NFC' && chip.fil === -1 && chip.visible && chip.depthTest === false && chip.transparent && chip.color === '#d9a400', `the chip shows in gold through the body: ${JSON.stringify(chip)}`);
  const nfcRow = await row('Chip NFC 📶');
  ok(i2.nfc.covered ? nfcRow.includes(`toca el ${i2.nfc.under}`) : i2.nfc.mark && nfcRow.includes('señal 📶'), `«Resultado» says where to tap: ${nfcRow}`);
  ok(/solo en la vista/.test(await row('Chip NFC')), 'parts list: the chip is view-only (it goes in at the pause)');
  ok(!!i2.opener && /lado/.test(await row('Abre latas')), `can opener on the ${i2.opener?.side} edge${i2.opener?.angle ? `, turned ${i2.opener.angle}°` : ''}`);
  const forma2 = await row('Forma');
  ok(!i2.grow || (forma2.includes('alargada') && i2.growFor.every((k) => forma2.includes(k === 'nfc' ? 'chip NFC' : 'abre latas'))), `«Forma»: ${forma2}`);
  ok(!blocking(i2.warnings).length, 'no blocking warnings: ' + (i2.warnings.join(' | ') || 'none'));
  // with every extra on, «Resultado» has its longest list: all rows must be visible, none hidden behind an inner scroll bar
  const lst = await run(`(()=>{const l=${q('[data-r=list]')}; return [l.scrollHeight, l.clientHeight, l.querySelectorAll('.hb-pc').length]})()`);
  ok(lst[2] > 5 && lst[0] <= lst[1] + 1, `«Resultado» shows all ${lst[2]} rows without an inner scroll (${lst[1]} of ${lst[0]} px visible)`);
  await S('ps_04_mouse_full');

  // 4b. nothing printed over the chip → the 📶 sign goes there, made like the logo (raised, in its colour by default);
  // it can be turned off. The logo/text/sign are drawn over the see-through chip, the phone glass over everything.
  await check('logo.enabled', false); await check('text.enabled', false); await idle();
  const mk = await info();
  const sign = mk.parts.find((p) => p.name === 'Señal NFC');
  ok(!!mk.nfc && !mk.nfc.covered && mk.nfc.mark && sign?.fil === 1 && !sign.preview && (await row('Chip NFC 📶')).includes('señal 📶 en relieve encima: toca la señal'),
    `no logo over the chip → raised 📶 sign in the logo colour shows where to tap: ${await row('Chip NFC 📶')}`);
  ok((await row('Señal NFC')) === 'filamento 2' && /^2/.test(await row('Filamentos')), '3MF part list: «Señal NFC» on filament 2');
  const order = await P(`(()=>{const o={}; ps.res.parts.forEach((p,i)=>{o[p.name]=ps.viewer.meshes.get('p'+i).renderOrder}); o.phone=ps.viewer.extras.get('phone').renderOrder; return o})()`);
  ok(order['Señal NFC'] > order['Chip NFC'] && order.phone > order['Señal NFC'] && order.Cuerpo < order['Chip NFC'], `drawn in order body → chip → sign → phone glass: ${JSON.stringify(order)}`);
  await click('[data-tab="top"]');
  await S('ps_04b_nfc_sign_top');
  await check('nfc.mark', false); await idle();
  const nm = await info();
  ok(!nm.nfc.mark && !nm.parts.some((p) => p.name === 'Señal NFC') && nm.grams < mk.grams, `the sign can be turned off (−${Math.round((mk.grams - nm.grams) * 1000)} mg of plastic)`);
  await check('nfc.mark', true); await check('logo.enabled', true); await check('text.enabled', true);
  await click('[data-tab="print"]'); await idle();

  // 5. measurements: limited to their range when leaving the field, decimal comma accepted
  const wShown = await setVal('width', '99');
  ok(wShown === '46' && (await P('ps.cfg.width')) === 46, `width 99 → field shows ${wShown} (range 30–46)`);
  await setVal('width', '40');
  await setVal('clearance', '0,4');
  await idle();
  const i3 = await info();
  ok(i3.cfg.width === 40 && i3.cfg.clearance === 0.4 && i3.hinge.clearance === 0.4 && i3.hinge.gap >= 0.36 && i3.size.w >= 40,
    `width 40 mm and clearance «0,4» used (leg ${i3.hinge.gap.toFixed(2)} mm from the body, model ${f1(i3.size.w)} mm wide)`);
  ok(!blocking(i3.warnings).length, 'still printable: ' + (i3.warnings.join(' | ') || 'no warnings'));

  // 5b. sizes and models: large = 12 mm and a longer leg; short = no bar, phone sideways
  await setVal('size', 'large'); await idle();
  const lg = await info();
  ok(lg.model.thickness === 12 && lg.phone.tMax >= 12.5 && lg.pieces.body === 1 && lg.pieces.leg === 1 && /Grande/.test(await row('Modelo')),
    `large: 12 mm thick, phones up to ${f1(lg.phone.tMax)} mm with case`);
  await setVal('size', 'small');
  await setVal('variant', 'short'); await idle();
  const sh = await info();
  const barHidden = await run(`[...document.querySelectorAll('#phonestand [data-show="barOk"]')].every(e=>e.hidden)`);
  ok(sh.model.variant === 'short' && sh.model.thickness === 11 && barHidden && !sh.art.bar && !!sh.art.top?.text && !!sh.art.top.logo && sh.phone.landscape && /horizontal/.test(await row('Estabilidad')),
    'short model: no bar (its «Dónde» options hide), logo and text together on the shape, phone sideways');
  // the star's points leave no straight 16 mm edge right behind the hinge: the shape grows so the can opener fits
  await check('nfc.enabled', false);
  await click('[data-shape="star"]'); await idle();
  const st = await info();
  const forma = await row('Forma');
  ok(!!st.opener && st.grow > 0 && st.growFor.join() === 'opener' && /alargada .*abre latas/.test(forma) && st.pieces.body === 1 && !blocking(st.warnings).length,
    `short star: the shape grows for the can opener («${forma}»)`);
  await click('[data-tab="stand"]');
  await S('ps_05_short_star_stand');
  await setVal('variant', 'standard');
  await check('nfc.enabled', true);
  await click('[data-shape="mouse"]'); await idle();
  await click('[data-tab="print"]');

  // 6. colours only repaint (no rebuild); the NFC chip keeps its gold
  const seq0 = await P('ps.seq');
  await setVal('colors.accent', '#1d4ed8');
  await setVal('colors.body', '#fde68a');
  await wait(400);
  const col = await P(`({seq: ps.seq, parts: ps.res.parts.map((p,i)=>[p.filamentIndex, p.color, '#'+ps.viewer.meshes.get('p'+i).material.color.getHexString(), !!p.preview])})`);
  ok(col.seq === seq0 && col.parts.some(([, , , pv]) => pv) && col.parts.every(([f, c, m, pv]) => (pv ? c === '#d9a400' : c === (f ? '#1d4ed8' : '#fde68a')) && m === c),
    'colours repaint the model without rebuilding (the NFC chip stays gold)');

  // 7. the four views, the leg slider and the opening animation
  for (const t of ['print', 'stand', 'closed', 'top']) {
    await click(`[data-tab="${t}"]`); await wait(300);
    const s = await legState();
    const want = t === 'print' ? s.poses.print : t === 'stand' ? s.poses.stand : s.poses.closed;
    ok(s.tab === t && Math.abs(poseOf(s) - want) < 1e-6 && Math.abs(s.rot - want * D2R) < 1e-6 && Math.abs(s.range - s.amt) < 0.006 && s.phone === (t === 'stand'),
      `tab ${t}: leg at ${f1(want)}° from the print pose, phone ${s.phone ? 'on the stand' : 'hidden'}`);
    await S('ps_06_tab_' + t);
  }
  await run(`(()=>{const e=${q('[data-r=amt]')}; e.value='0.5'; e.dispatchEvent(new Event('input',{bubbles:true})); return true})()`);
  const half = await legState();
  ok(Math.abs(half.amt - 0.5) < 1e-6 && Math.abs(half.rot - poseOf(half) * D2R) < 1e-6 && !half.phone, `«Mover la pata» turns the leg half way (${f1(poseOf(half))}°)`);
  await S('ps_07_leg_half');
  await click('[data-tab="closed"]');
  await click('[data-a="animate"]'); await wait(2600);
  const an = await legState();
  ok(Math.abs(an.amt - 1) < 1e-6 && an.range === 1 && Math.abs(an.rot - an.poses.stand * D2R) < 1e-6 && an.phone,
    `animation opens the leg from closed onto its stop (${f1(an.poses.closed - an.poses.stand)}° turn) and the phone appears`);
  await S('ps_07_animated_open');

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
  ok(i4.shape === 'custom' && cthumb && !!i4.art.top?.logo && i4.pieces.body === 1 && i4.pieces.leg === 1 && !blocking(i4.warnings).length,
    `custom silhouette builds on the hinge with the logo, button shows its outline ${i4.warnings.join(' | ')}`);
  await click('[data-tab="print"]');
  await S('ps_08_custom_silhouette');
  await click('[data-shape="mouse"]'); await idle();

  // 9. exports with the real buttons: the chip is only a preview, never a printed part
  await setVal('name', 'Pabonitas raton');
  const fin = await info();
  const real = fin.parts.filter((p) => !p.preview);
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
    ok(objs.length === real.length && objs.every(([n, f], i) => n === real[i].name && f === real[i].fil) && !objs.some(([n]) => /Chip/.test(n)),
      `3MF: ${objs.length} printed parts with their filament (${objs.map(([n]) => n).join(', ')}), no chip`);
    ok(mats.length === 2 && mats[0] === '#FDE68A' && mats[1] === '#1D4ED8', '3MF filament colours = body + accent');
    const pause = z['Metadata/custom_gcode_per_layer.xml'] ? strFromU8(z['Metadata/custom_gcode_per_layer.xml']) : '';
    const pz = +((pause.match(/top_z="([\d.]+)"/) || [])[1]);
    ok(/gcode="M400 U1"/.test(pause) && /chip NFC/.test(pause) && Math.abs(pz - fin.pauses[0].z) < 0.01, `3MF pauses at Z = ${pz} mm to insert the NFC chip`);
  }
  if (files.stl) {
    const n = files.stl.readUInt32LE(80);
    const tri = await P(`ps.res.parts.filter(p=>!p.preview).reduce((s,p)=>s+(p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count)/3, 0)`);
    ok(n === tri && files.stl.length === 84 + 50 * n, `STL: ${n} triangles = the printed parts only`);
  }
  if (files.png) {
    const wpx = files.png.readUInt32BE(16), hpx = files.png.readUInt32BE(20);
    ok(files.png.readUInt32BE(0) === 0x89504e47 && wpx > 400 && hpx > 300, `photo PNG ${wpx}×${hpx}`);
  }
  let proj = null;
  try { proj = JSON.parse(files.r3p.toString('utf8')); } catch { /* reported below */ }
  ok(proj?.app === 'Relieve3D-SoporteCelular' && proj.version === 2 && proj.cfg.shape === 'mouse' && proj.cfg.size === 'small' && proj.cfg.variant === 'standard'
    && proj.cfg.width === 40 && proj.cfg.nfc.enabled && proj.cfg.opener.enabled && proj.cfg.text.value === 'Pabonitas'
    && /^data:image\/png/.test(proj.logoSrc || '') && /^data:image\/png/.test(proj.shapeSrc || ''), 'project keeps the design, the logo and the silhouette');

  // 10. reset keeps the logo; dropping the .r3p brings the whole design back
  await click('[data-a="reset"]'); await idle();
  const rs = await P(`({shape: ps.cfg.shape, nfc: ps.cfg.nfc.enabled, width: ps.cfg.width, clearance: ps.cfg.clearance, field: ps.root.querySelector('[data-k=width]').value, logo: !!ps.logoImg, art: !!ps.res.info.art.top?.logo})`);
  ok(rs.shape === 'heart' && !rs.nfc && rs.width === 36 && rs.field === '36' && rs.clearance === 0.3 && rs.logo && rs.art, 'reset: default measurements, logo kept');
  if (files.r3p) await dropFile(files.r3p, 'Pabonitas raton.r3p', 'application/json');
  ok(await until(`ps.cfg.shape === 'mouse' && !!ps.res && ps.res.cfg.shape === 'mouse' && !ps.building`), 'dropped .r3p reopens the design');
  const re = await info();
  const same = JSON.stringify(re.cfg) === JSON.stringify(proj?.cfg);
  ok(same && !!re.art.top?.logo && !!re.art.bar?.text && re.pauses.length === 1 && !!re.opener && re.parts.some((p) => p.preview) && Math.abs(re.grams - fin.grams) < 0.01,
    `same settings, logo, text, NFC chip and opener (${f1(re.grams)} g)`);
  await S('ps_09_reopened');

  // 10b. a project saved by v1.17 (flat card with a flap) opens on the hinge: its look is kept
  const v1 = { app: 'Relieve3D-SoporteCelular', version: 1, cfg: { name: 'Llavero viejo', shape: 'bear', width: 52, thickness: 6, flapLength: 34, rail: 1.2, frontBar: 4, ridge: 0.8, phoneAngle: 62,
    clearance: 0.5, opener: { enabled: true }, text: { enabled: true, value: 'Viejo', where: 'flap' }, colors: { body: '#ffffff', accent: '#ff0000' } } };
  await dropFile(Buffer.from(JSON.stringify(v1)), 'viejo.r3p', 'application/json');
  ok(await until(`ps.cfg.shape === 'bear' && !!ps.res && ps.res.cfg.shape === 'bear' && !ps.building`), 'a v1.17 project (flat card + flap) opens');
  const old = await info();
  ok(old.cfg.width === 36 && old.cfg.clearance === 0.3 && old.cfg.size === 'small' && old.cfg.text.where === 'bar' && !!old.art.bar?.text && !!old.opener && old.cfg.colors.body === '#ffffff'
    && old.parts.some((p) => p.name === 'Pata (bisagra)' && p.moving) && old.pieces.body === 1 && !blocking(old.warnings).length,
    'migrated to the hinge: hinge measurements from the defaults; shape, colours, text (now on the bar) and opener kept');
  await S('ps_10_v1_migrated');

  // 11. back home and open the project from the home screen
  await click('[data-a="home"]'); await wait(300);
  [psHidden, homeHidden] = await shown();
  ok(psHidden && !homeHidden, '⌂ Inicio goes back home');
  await run(`(window.__r3d.openProjectFile(new File([${JSON.stringify(files.r3p ? files.r3p.toString('utf8') : '{}')}], 'Pabonitas raton.r3p')), true)`);
  ok(await until(`!document.getElementById('phonestand').hidden && document.getElementById('home').hidden && !!ps.res && ps.res.cfg.shape === 'mouse' && !ps.building`), 'project opened from home shows the studio');
  const hm = await info();
  ok(JSON.stringify(hm.cfg) === JSON.stringify(proj?.cfg) && hm.pauses.length === 1, 'same design after opening from home');
  // a broken project file keeps the screen as it was and explains why
  await run(`(window.__r3d.openProjectFile(new File(['{"app":"Relieve3D-SoporteCelular","version":9,"cfg":{}}'], 'roto.r3p')), true)`); await wait(800);
  const toast = await run(`document.getElementById('toast').textContent`);
  [psHidden] = await shown();
  ok(!psHidden && /no compatible/i.test(toast), `broken project: studio stays, message «${toast}»`);
  await S('ps_11_final');

  ok(!errs.length, 'console errors: ' + (errs.join(' | ') || 'none'));
  log('done');
};
