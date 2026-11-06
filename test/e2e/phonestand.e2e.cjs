// E2E: «Soporte celular llavero» — the whole user flow, from the home card: default heart stand whose leg turns on the
// print-in-place hinge (printed standing, folds into its slot, opens onto its stop with the phone on it), client's logo
// dropped on the window and split into its colours (one filament each; «Colores del logo» changes them like the
// keychains' palette: colour, body colour, left out, own height), every top shape, Mickey-style head with NFC (gold
// chip seen through the body, 📶 tap sign; SIM-style tray printed beside the stand that clicks into a side slot, or
// sealed in at a print pause) + can opener + brand name in its own colour and height (AMS limit of 4 colours), the
// measurements limited to their range, both sizes and the short model (the can opener makes the star longer), colours
// repainted at once and followed by the filaments, finishes for small logos (smooth one-layer multicolour like the
// keychains, engraved, thin strokes thickened), the four views + leg slider + opening animation (the tray in its slot),
// a custom silhouette through the file input, exports with the real buttons (3MF with the stand and the tray as
// separate objects, its filaments and no chip; the pause version; STL, photo, project .r3p), reset, project reopened
// by dropping it, a v1.17 project migrated to the hinge, back home and reopened from the home screen, broken project,
// and an SVG logo.
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
  // a field of row i of «Colores del logo» (data-lm = color | mode | height), changed like setVal
  const setLayer = (i, lm, v) => run(`(()=>{const e=${q(`[data-layer="${i}"] [data-lm="${lm}"]`)}; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return e.value})()`);
  const dropFile = (buf, name, type) => run(`(()=>{const b=Uint8Array.from(atob('${buf.toString('base64')}'),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([b],${JSON.stringify(name)},{type:${JSON.stringify(type)}}));document.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return true})()`);
  // parts with their z range as printed (z: [min, max]); logo: the colours found in the logo (core info.logo)
  const info = () => P(`({shape: ps.res.info.shape.id, grow: ps.res.info.shape.grow, growFor: ps.res.info.shape.growFor, warnings: ps.res.warnings, pauses: ps.res.pauses,
    parts: ps.res.parts.map(p=>{p.geometry.computeBoundingBox(); const b=p.geometry.boundingBox; return {name:p.name, fil:p.filamentIndex, moving:!!p.moving, preview:!!p.preview,
      apart:!!p.apart, art:!!p.art, layer:p.layer, color:p.color, height:p.height, z:[b.min.z, b.max.z]}}), pieces: ps.res.info.parts, filaments: ps.res.filaments, logo: ps.res.info.logo,
    nfc: ps.res.info.nfc, opener: ps.res.info.opener, art: ps.res.info.art, size: ps.res.info.size, closed: ps.res.info.closedSize, grams: ps.res.info.grams,
    stability: ps.res.info.stability, model: ps.res.info.model, phone: ps.res.info.phone, hinge: ps.res.info.hinge, latch: ps.res.info.latch, cfg: ps.res.cfg})`);
  const top = (r) => r.parts.find((p) => p.name === 'Cuerpo').z[1];   // the body's face (art stands on it or is flush)
  const near = (a, b, e = 0.01) => Math.abs(a - b) <= e;
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

  // timers keep running while the window is behind other windows (else the waits crawl to one per minute)
  win.webContents.setBackgroundThrottling(false);
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

  // 2. client's logo dropped on the window: split into its colours, each its own piece on its own filament
  const logoBuf = fs.readFileSync(process.env.E2E_INPUT);
  ok(await run(`${q('[data-show="layers"]')}.hidden`), 'no logo yet: no «Colores del logo» panel');
  await dropFile(logoBuf, 'logo-cliente.png', 'image/png');
  ok(await until('!!ps.logoImg'), 'dropped logo is loaded');
  await idle();
  const i1 = await info();
  ok(!!i1.art.top?.logo && !blocking(i1.warnings).length, `logo on the heart: ${i1.art.top ? `${f1(i1.art.top.w)} × ${f1(i1.art.top.h)} mm` : 'missing'} ${i1.warnings.join(' | ')}`);
  const L1 = i1.logo || [], nL = L1.length, lp1 = i1.parts.filter((p) => p.name.startsWith('Logo'));
  ok(nL >= 3 && lp1.length === nL && lp1.every((p, k) => p.name === `Logo · color ${k + 1}` && p.layer === L1[k].key && p.fil === k + 1 && p.color === L1[k].hex && p.art && !p.moving),
    `logo split into its ${nL} colours (${L1.map((e) => `${e.hex} ${Math.round(e.area * 100)} %`).join(', ')}): one piece and one filament each, fixed on the body`);
  const pal = await run(`(()=>{const b=${q('[data-show="layers"]')}; return [b.hidden, b.querySelectorAll('[data-layer]').length, [...b.querySelectorAll('[data-lm=color]')].map(e=>e.value), [...b.querySelectorAll('[data-lm=mode]')].map(e=>e.value)]})()`);
  ok(!pal[0] && pal[1] === nL && pal[2].join() === L1.map((e) => e.color).join() && pal[3].every((m) => m === 'on'), `«Colores del logo» shows ${pal[1]} rows: ${pal[2].join(' ')}`);
  ok(i1.filaments.length === nL + 1 && (await row('Filamentos')) === String(nL + 1), `«Filamentos»: body + ${nL} logo colours`);
  ok(await run(`!!document.querySelector('#phonestand [data-r=logoBox] img')`), 'logo thumbnail in the panel');
  await S('ps_02_logo_heart');

  // 2b. «Colores del logo», like the keychains' palette: a colour printed in the body's colour (one filament less),
  // a colour raised higher than the rest, a colour left out — and back
  await setLayer(0, 'mode', 'body'); await idle();
  const lb = await info();
  const p0 = lb.parts.find((p) => p.layer === L1[0].key);
  ok(p0?.fil === 0 && p0.color === lb.cfg.colors.body && lb.filaments.length === nL && (await run(`${q('[data-layer="0"] [data-lm=color]')}.value`)) === lb.cfg.colors.body,
    `colour 1 → «Color del cuerpo»: printed with the body filament, ${lb.filaments.length} filaments`);
  await setLayer(1, 'height', '1,6'); await idle();
  const lh = await info(), T1 = top(lh);
  const p1 = lh.parts.find((p) => p.layer === L1[1].key), others = lh.parts.filter((p) => p.art && p.layer !== L1[1].key);
  ok(near(p1?.height, 1.6, 1e-6) && near(p1.z[1], T1 + 1.6) && others.every((p) => near(p.z[1], T1 + lh.cfg.logo.height)) && (await run(`${q('[data-layer="1"] [data-lm=height]')}.value`)) === '1.6',
    `colour 2 raised 1.6 mm («1,6»), the rest at the relief height ${lh.cfg.logo.height} mm`);
  await setLayer(nL - 1, 'mode', 'off'); await idle();
  const lo = await info();
  const greyed = await run(`${q(`[data-layer="${nL - 1}"]`)}.classList.contains('off')`);
  ok(!lo.parts.some((p) => p.layer === L1[nL - 1].key) && lo.logo[nL - 1].skipped === 'off' && greyed && lo.filaments.length === nL - 1,
    `colour ${nL} → «Quitar»: no piece, its row greyed, ${lo.filaments.length} filaments`);
  await S('ps_02b_logo_layers');
  await setLayer(nL - 1, 'mode', 'on'); await setLayer(0, 'mode', 'on'); await idle();
  const lr = await info();
  ok(lr.parts.filter((p) => p.name.startsWith('Logo')).length === nL && lr.parts.find((p) => p.layer === L1[0].key)?.color === L1[0].hex && lr.filaments.length === nL + 1,
    'back to «Imprimir»: every colour again, colour 1 in its own colour');

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
  log('mouse + extras', JSON.stringify({ grow: i2.grow, growFor: i2.growFor, nfc: i2.nfc, opener: i2.opener, top: i2.art.top, bar: i2.art.bar, pauses: i2.pauses, filaments: i2.filaments, warnings: i2.warnings }));
  ok(i2.shape === 'mouse' && !!i2.art.top?.logo && !!i2.art.bar?.text && i2.parts.some((p) => p.name === 'Texto (barra)'), 'logo on the head, «Pabonitas» on the bar behind the hinge');
  // the chip goes in a SIM-style tray printed beside the stand that slides into a slot on a side: no print pause
  const tray = i2.parts.find((p) => p.name === 'Bandeja NFC');
  ok(i2.nfc?.mount === 'tray' && ['left', 'right'].includes(i2.nfc.side) && !i2.pauses.length && tray?.apart && tray.fil === 0 && !tray.moving && tray.z[0] > -1e-6,
    `NFC chip Ø${i2.nfc ? f1(2 * i2.nfc.r) : '?'} in a tray printed flat beside the stand (no pause), slot on the ${i2.nfc?.side} side (can opener ${i2.opener?.side})`);
  const trayRow = await row('Bandeja NFC 📶');
  ok(trayRow.includes(`lado ${i2.nfc?.side === 'left' ? 'izquierdo' : 'derecho'}`) && /aparte, sin pausa/.test(trayRow) && (await row('Bandeja NFC')) === 'filamento 1 · objeto aparte',
    `«Resultado»: ${trayRow}; the tray is its own object in the 3MF`);
  // the view re-frames when the tray appears beside the stand: every vertex of every piece projects inside the screen
  const reach = await P(`(()=>{const v=ps.viewer; v.scene.updateMatrixWorld(true); v.camera.updateMatrixWorld(); const q=v.camera.position.clone(), out={};
    ps.res.parts.forEach((p,i)=>{ const m=v.meshes.get('p'+i); if(!m||!m.visible) return; const a=m.geometry.attributes.position; let w=0;
      for(let k=0;k<a.count;k++){ q.fromBufferAttribute(a,k).applyMatrix4(m.matrixWorld).project(v.camera); w=Math.max(w,Math.abs(q.x),Math.abs(q.y)); }
      out[p.name]=Math.round(w*1000)/1000; });
    return out})()`);
  ok(reach['Bandeja NFC'] > 0 && Object.values(reach).every((w) => w <= 1), `view re-framed for the tray beside the stand, nothing cut off (screen reach ${JSON.stringify(reach)})`);
  // the hidden chip is drawn in gold through the body (x-ray), as a view-only part
  const chip = await P(`(()=>{const i=ps.res.parts.findIndex(p=>p.preview), m=ps.viewer.meshes.get('p'+i); return i<0||!m ? null : {name:ps.res.parts[i].name, fil:ps.res.parts[i].filamentIndex, visible:m.visible, depthTest:m.material.depthTest, transparent:m.material.transparent, color:'#'+m.material.color.getHexString()}})()`);
  ok(chip?.name === 'Chip NFC' && chip.fil === -1 && chip.visible && chip.depthTest === false && chip.transparent && chip.color === '#d9a400', `the chip shows in gold through the body: ${JSON.stringify(chip)}`);
  const nfcRow = await row('Chip NFC 📶');
  ok(i2.nfc.covered ? nfcRow.includes(`toca el ${i2.nfc.under}`) : i2.nfc.mark && nfcRow.includes('señal 📶'), `«Resultado» says where to tap: ${nfcRow}`);
  ok(/solo en la vista \(va en la bandeja\)/.test(await row('Chip NFC')), 'parts list: the chip is view-only (it goes in the tray)');
  // the slot side can be chosen
  const other = i2.nfc.side === 'left' ? 'right' : 'left';
  await setVal('nfc.side', other); await idle();
  const sd = await info();
  ok(sd.nfc?.side === other && sd.nfc.mount === 'tray' && !blocking(sd.warnings).length, `slot asked on the ${other}: the tray goes in from the ${sd.nfc?.side}`);
  await setVal('nfc.side', 'auto'); await idle();
  // the other way: the chip sealed inside at a print pause
  await setVal('nfc.mount', 'pause'); await idle();
  const pz = await info();
  const sideHidden = await run(`${q('[data-show="nfcTray"]')}.hidden`);
  ok(pz.nfc?.mount === 'pause' && pz.pauses.length === 1 && Math.abs(pz.pauses[0].z - pz.nfc.z1) < 1e-6 && /NFC/.test(pz.pauses[0].msg) && !pz.parts.some((p) => p.apart) && sideHidden
    && /mete el chip/.test(await row('Pausa NFC')) && /va en la pausa/.test(await row('Chip NFC')) && !blocking(pz.warnings).length,
    `«Sellado con pausa»: pocket at z ${pz.nfc?.z0}–${pz.nfc?.z1} with a pause at Z = ${pz.pauses[0] ? f1(pz.pauses[0].z) : '?'} mm, no tray`);
  await setVal('nfc.mount', 'tray'); await idle();
  ok(!!i2.opener && /lado/.test(await row('Abre latas')), `can opener on the ${i2.opener?.side} edge${i2.opener?.angle ? `, turned ${i2.opener.angle}°` : ''}`);
  const forma2 = await row('Forma');
  ok(!i2.grow || (forma2.includes('alargada') && i2.growFor.every((k) => forma2.includes(k === 'nfc' ? 'chip NFC' : 'abre latas'))), `«Forma»: ${forma2}`);
  ok(!blocking(i2.warnings).length, 'no blocking warnings: ' + (i2.warnings.join(' | ') || 'none'));
  // 3 logo colours + the text in the accent colour = 5 filaments: a notice (an AMS holds 4), not an error
  const ams = i2.warnings.find((w) => /un AMS tiene 4/.test(w));
  ok(i2.filaments.length === nL + 2 && !!ams && !blocking([ams]).length, `${i2.filaments.length} filament colours → «${ams}»`);
  // with every extra on, «Resultado» has its longest list: all rows must be visible, none hidden behind an inner scroll bar
  const lst = await run(`(()=>{const l=${q('[data-r=list]')}; return [l.scrollHeight, l.clientHeight, l.querySelectorAll('.hb-pc').length]})()`);
  ok(lst[2] > 5 && lst[0] <= lst[1] + 1, `«Resultado» shows all ${lst[2]} rows without an inner scroll (${lst[1]} of ${lst[0]} px visible)`);
  await S('ps_04_mouse_full');

  // 4a. the text in its own colour and height; sharing a logo colour's filament keeps the design within 4 colours
  const purple = i2.logo[nL - 1].color;
  await setVal('text.color', purple); await idle();
  const ta = await info();
  const txt = ta.parts.find((p) => p.layer === 'text'), lastLogo = ta.parts.find((p) => p.layer === ta.logo[nL - 1].key);
  ok(txt?.color === purple && txt.fil === lastLogo?.fil && ta.filaments.length === nL + 1 && !ta.warnings.some((w) => /AMS/.test(w)),
    `text in the logo's ${purple}: on that colour's filament, ${ta.filaments.length} filaments, no AMS notice`);
  await setVal('text.height', '1,2'); await idle();
  const tb = await info(), tx = tb.parts.find((p) => p.layer === 'text');
  ok(near(tx?.height, 1.2, 1e-6) && near(tx.z[1], top(tb) + 1.2), `text raised 1.2 mm (logo ${tb.cfg.logo.height} mm)`);
  await click('[data-a="textAccent"]'); await idle();
  const tc = await info();
  ok(tc.cfg.text.color === '' && (await run(`${q('[data-k="text.color"]')}.value`)) === tc.cfg.colors.accent && tc.parts.find((p) => p.layer === 'text')?.color === tc.cfg.colors.accent,
    '↺ puts the text back in the accent colour');
  // the logo's lightest colour printed in the body colour: one filament less, within an AMS again
  await setLayer(0, 'mode', 'body'); await idle();
  const tw = await info();
  ok(tw.filaments.length === nL + 1 && !tw.warnings.some((w) => /AMS/.test(w)) && !blocking(tw.warnings).length, `logo colour 1 in the body colour: ${tw.filaments.length} filaments (${tw.filaments.join(' ')})`);

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

  // 6. colours repaint at once, then the model is rebuilt so the filaments follow: the body colour carries every piece in
  // it (the leg, the NFC tray, the logo colour set to «Color del cuerpo»), the accent the text and the 📶 sign; the
  // logo's own colours stay; the NFC chip keeps its gold
  const c0 = await info(), seq0 = await P('ps.seq');
  await setVal('colors.accent', '#1d4ed8');
  await setVal('colors.body', '#fde68a');
  const quick = await P(`Object.fromEntries(ps.res.parts.map((p,i)=>[p.name, '#'+ps.viewer.meshes.get('p'+i).material.color.getHexString()]))`);
  ok(quick.Cuerpo === '#fde68a' && quick['Texto (barra)'] === '#1d4ed8' && quick['Chip NFC'] === '#d9a400', `repainted at once: ${JSON.stringify(quick)}`);
  await idle();
  const col = await P(`({seq: ps.seq, fil: ps.res.filaments, layers: ps.cfg.logo.layers, mode0: document.querySelector('#phonestand [data-layer="0"] [data-lm=mode]').value,
    parts: ps.res.parts.map((p,i)=>({name:p.name, fil:p.filamentIndex, color:p.color, mesh:'#'+ps.viewer.meshes.get('p'+i).material.color.getHexString(), preview:!!p.preview, layer:p.layer}))})`);
  const own = Object.fromEntries(c0.logo.map((e) => [e.key, e.color]));
  const want = (p) => (p.preview ? '#d9a400' : p.fil === 0 ? '#fde68a' : p.layer && p.layer !== 'text' ? own[p.layer] : '#1d4ed8');
  const wrong = col.parts.filter((p) => p.color !== want(p) || p.mesh !== p.color);
  ok(col.seq !== seq0 && col.fil[0] === '#fde68a' && col.fil.includes('#1d4ed8') && !wrong.length && col.layers[c0.logo[0].key]?.color === '#fde68a' && col.mode0 === 'body'
    && ['Cuerpo', 'Pata (bisagra)', 'Bandeja NFC', c0.parts.find((p) => p.layer === c0.logo[0].key)?.name].every((n) => col.parts.find((p) => p.name === n)?.fil === 0),
    `rebuilt with the new colours (filaments ${col.fil.join(' ')}): body, leg, tray and logo colour 1 in the body colour, text in the accent, the logo's colours kept${wrong.length ? ' — wrong: ' + JSON.stringify(wrong) : ''}`);

  // 6b. finishes for small logos: «Liso multicolor» puts every colour flush in the face's top layers (smooth, like the
  // printed keychains; 0.2 mm = all of them in one layer), a colour in the body's colour is simply body there; engraved
  // = carved in, no extra filament; thin strokes are thickened to the «trazo mínimo»
  await setVal('logo.mode', 'flat');
  ok(await run(`!${q('[data-show="flat"]')}.hidden && ${q('[data-show="relief"]')}.hidden && !document.querySelector('#phonestand [data-lm=height]')`),
    'flat finish: its depth field shows, the relief heights hide');
  await setVal('logo.flatDepth', '0,2'); await idle();
  const fl = await info(), Tf = top(fl), flatArt = fl.parts.filter((p) => p.art);
  const fRow0 = await run(`(()=>{const r=${q('[data-layer="0"]')}; return [r.classList.contains('off'), r.title]})()`);
  ok(flatArt.length > 0 && flatArt.every((p) => near(p.z[1], Tf, 1e-3) && near(p.z[0], Tf - 0.2, 1e-3)) && near(fl.closed.h, Tf, 1e-3),
    `«Liso multicolor» 0.2 mm: ${flatArt.length} colour pieces flush with the face (z ${f1(Tf - 0.2)}–${f1(Tf)}), nothing sticks out (${f1(fl.closed.h)} mm closed)`);
  ok(fl.logo[0].skipped === 'body' && !fl.parts.some((p) => p.layer === fl.logo[0].key) && fRow0[0] && /color del cuerpo/.test(fRow0[1]),
    'the logo colour in the body colour is just the body in the flat finish (its row says so)');
  ok(/liso a ras · color de 0,2 mm \(1 capa\) · trazo mínimo 0,5 mm/.test(await row('Acabado')), `«Acabado»: ${await row('Acabado')}`);
  await setVal('logo.minLine', '0,8'); await idle();
  const ml = await info();
  ok(ml.art.minLine === 0.8 && /trazo mínimo 0,8 mm/.test(await row('Acabado')) && !blocking(ml.warnings).length, `thin strokes thickened to 0.8 mm: «${await row('Acabado')}»`);
  await click('[data-tab="top"]');
  await S('ps_06b_flat_multicolor');
  await setVal('logo.minLine', '0,5');
  await setVal('logo.mode', 'engrave'); await idle();
  const en = await info();
  const carve = await run(`[...document.querySelectorAll('#phonestand [data-layer] [data-lm=mode]')].map(s=>[...s.options].map(o=>o.value).join('/')).concat(document.querySelectorAll('#phonestand [data-layer] [data-lm=color]').length)`);
  ok(!en.parts.some((p) => p.art) && en.filaments.length === 1 && en.grams < fl.grams && near(en.closed.h, top(en), 1e-3) && /grabado 0,6 mm/.test(await row('Acabado')),
    `engraved: logo, text and 📶 carved 0.6 mm into the body, one filament (${f1(en.grams)} g vs ${f1(fl.grams)} g flat)`);
  ok(carve.slice(0, -1).every((s) => s === 'on/off') && carve[carve.length - 1] === 0, '«Colores del logo» when engraved: each colour carved or left out (no filament colours)');
  await S('ps_06c_engraved');
  await setVal('logo.mode', 'relief'); await idle();
  const rl = await info();
  ok(rl.parts.filter((p) => p.name.startsWith('Logo')).length === nL && near(rl.parts.find((p) => p.layer === L1[1].key)?.z[1], top(rl) + 1.6) && (await run(`${q('[data-layer="1"] [data-lm=height]')}.value`)) === '1.6',
    'back to relief: every colour raised again, colour 2 still 1.6 mm');
  await click('[data-tab="print"]');

  // 7. the four views, the leg slider and the opening animation; the NFC tray (and its chip) lie beside the stand as
  // printed and sit in their slot in the other views
  const trayAt = () => P(`(()=>{const at=(f)=>{const i=ps.res.parts.findIndex(f); return i<0 ? null : {pos: ps.viewer.meshes.get('p'+i).position.toArray(), as: ps.res.parts[i].assembled}}; return {tray: at(p=>p.apart), chip: at(p=>p.preview)}})()`);
  const inPlace = (m, put) => !!m?.as && m.pos.every((v, k) => Math.abs(v - (put ? m.as[k] : 0)) < 1e-6);
  for (const t of ['print', 'stand', 'closed', 'top']) {
    await click(`[data-tab="${t}"]`); await wait(300);
    const s = await legState(), tp = await trayAt();
    const want = t === 'print' ? s.poses.print : t === 'stand' ? s.poses.stand : s.poses.closed;
    ok(s.tab === t && Math.abs(poseOf(s) - want) < 1e-6 && Math.abs(s.rot - want * D2R) < 1e-6 && Math.abs(s.range - s.amt) < 0.006 && s.phone === (t === 'stand')
      && inPlace(tp.tray, t !== 'print') && inPlace(tp.chip, t !== 'print'),
      `tab ${t}: leg at ${f1(want)}° from the print pose, phone ${s.phone ? 'on the stand' : 'hidden'}, NFC tray ${t === 'print' ? 'beside the stand' : 'in its slot'}`);
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

  // 9. exports with the real buttons: the chip is only a preview, never a printed part. First the pause version: one
  // object, the chip sealed in at a print pause
  await setVal('nfc.mount', 'pause'); await setVal('name', 'Pabonitas pausa'); await idle();
  const pv = await info();
  await click('[data-a="3mf"]');
  const pf = await waitFile('Pabonitas pausa.3mf');
  if (pf) {
    const z = unzipSync(pf);
    const model = strFromU8(z['3D/3dmodel.model']);
    const pause = z['Metadata/custom_gcode_per_layer.xml'] ? strFromU8(z['Metadata/custom_gcode_per_layer.xml']) : '';
    const pz = +((pause.match(/top_z="([\d.]+)"/) || [])[1]);
    ok((model.match(/<item objectid=/g) || []).length === 1 && !/name="Bandeja NFC"/.test(model) && /gcode="M400 U1"/.test(pause) && /chip NFC/.test(pause) && Math.abs(pz - pv.pauses[0].z) < 0.01,
      `3MF «con pausa»: one object, pauses at Z = ${pz} mm to insert the NFC chip`);
  } else ok(false, '«3mf» saved Pabonitas pausa.3mf');
  await setVal('nfc.mount', 'tray'); await setVal('name', 'Pabonitas raton'); await idle();
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
    const asm = [...model.matchAll(/<object id="\d+" type="model" name="([^"]+)">\n<components>\n((?:<component objectid="\d+"\/>\n)+)/g)].map((m) => [m[1], m[2].split('\n').filter(Boolean).length]);
    log('3MF objects', JSON.stringify(asm), 'parts', JSON.stringify(objs), 'filaments', mats.join(' '));
    ok(objs.length === real.length && objs.every(([n, f], i) => n === real[i].name && f === real[i].fil) && !objs.some(([n]) => /Chip/.test(n)),
      `3MF: ${objs.length} printed parts with their filament (${objs.map(([n]) => n).join(', ')}), no chip`);
    ok(asm.length === 2 && (model.match(/<item objectid=/g) || []).length === 2 && asm[0][0] === 'Pabonitas raton' && asm[0][1] === real.length - 1 && asm[1][0] === 'Bandeja NFC' && asm[1][1] === 1,
      `3MF: the stand (${asm[0]?.[1]} pieces) and the NFC tray are separate objects on the plate`);
    ok(mats.join() === fin.filaments.map((c) => c.toUpperCase()).join() && mats[0] === '#FDE68A' && mats.includes('#1D4ED8'), `3MF filament colours = the design's ${mats.length}: ${mats.join(' ')}`);
    ok(!z['Metadata/custom_gcode_per_layer.xml'], '3MF with the tray: no print pause');
  }
  if (files.stl) {
    const n = files.stl.readUInt32LE(80);
    const tri = await P(`ps.res.parts.filter(p=>!p.preview).reduce((s,p)=>s+(p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count)/3, 0)`);
    ok(n === tri && files.stl.length === 84 + 50 * n, `STL: ${n} triangles = the printed parts only (the tray beside the stand)`);
  }
  if (files.png) {
    const wpx = files.png.readUInt32BE(16), hpx = files.png.readUInt32BE(20);
    ok(files.png.readUInt32BE(0) === 0x89504e47 && wpx > 400 && hpx > 300, `photo PNG ${wpx}×${hpx}`);
  }
  let proj = null;
  try { proj = JSON.parse(files.r3p.toString('utf8')); } catch { /* reported below */ }
  ok(proj?.app === 'Relieve3D-SoporteCelular' && proj.version === 3 && proj.cfg.shape === 'mouse' && proj.cfg.size === 'small' && proj.cfg.variant === 'standard'
    && proj.cfg.width === 40 && proj.cfg.nfc.enabled && proj.cfg.nfc.mount === 'tray' && proj.cfg.opener.enabled && proj.cfg.text.value === 'Pabonitas' && proj.cfg.text.height === 1.2
    && proj.cfg.logo.layers[L1[1].key]?.height === 1.6 && proj.cfg.logo.layers[L1[0].key]?.color === '#fde68a'
    && /^data:image\/png/.test(proj.logoSrc || '') && /^data:image\/png/.test(proj.shapeSrc || ''), 'project keeps the design (logo colours, text height, NFC tray), the logo and the silhouette');

  // 10. reset keeps the logo; dropping the .r3p brings the whole design back
  await click('[data-a="reset"]'); await idle();
  const rs = await P(`({shape: ps.cfg.shape, nfc: ps.cfg.nfc.enabled, width: ps.cfg.width, clearance: ps.cfg.clearance, field: ps.root.querySelector('[data-k=width]').value, logo: !!ps.logoImg, art: !!ps.res.info.art.top?.logo})`);
  ok(rs.shape === 'heart' && !rs.nfc && rs.width === 36 && rs.field === '36' && rs.clearance === 0.3 && rs.logo && rs.art, 'reset: default measurements, logo kept');
  if (files.r3p) await dropFile(files.r3p, 'Pabonitas raton.r3p', 'application/json');
  ok(await until(`ps.cfg.shape === 'mouse' && !!ps.res && ps.res.cfg.shape === 'mouse' && !ps.building`), 'dropped .r3p reopens the design');
  const re = await info();
  const same = JSON.stringify(re.cfg) === JSON.stringify(proj?.cfg);
  ok(same && !!re.art.top?.logo && !!re.art.bar?.text && !re.pauses.length && re.parts.some((p) => p.apart) && !!re.opener && re.parts.some((p) => p.preview) && Math.abs(re.grams - fin.grams) < 0.01
    && re.parts.find((p) => p.layer === L1[1].key)?.height === 1.6 && re.filaments.join() === fin.filaments.join(),
    `same settings, logo colours, text, NFC tray and opener (${f1(re.grams)} g)`);
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
  ok(JSON.stringify(hm.cfg) === JSON.stringify(proj?.cfg) && !hm.pauses.length && hm.parts.some((p) => p.apart), 'same design after opening from home');
  // a broken project file keeps the screen as it was and explains why
  await run(`(window.__r3d.openProjectFile(new File(['{"app":"Relieve3D-SoporteCelular","version":9,"cfg":{}}'], 'roto.r3p')), true)`); await wait(800);
  const toast = await run(`document.getElementById('toast').textContent`);
  [psHidden] = await shown();
  ok(!psHidden && /no compatible/i.test(toast), `broken project: studio stays, message «${toast}»`);
  await S('ps_11_final');

  // 12. an SVG logo (vector, sized only by its viewBox) is drawn sharp at full size and split into its colours too
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"><path d="M60 94 L14 48 A24 24 0 0 1 60 16 A24 24 0 0 1 106 48 Z" fill="#e11d48"/>'
    + '<circle cx="60" cy="50" r="17" fill="#1e3a8a"/></svg>';
  await dropFile(Buffer.from(svg), 'logo-vector.svg', 'image/svg+xml');
  ok(await until(`ps.logoName === 'logo-vector.svg' && !!ps.res && !ps.building`), 'dropped SVG logo is loaded');
  await idle();
  const sv = await info();
  const sz = await P('[ps.logoImg.width, ps.logoImg.height]');
  const svRows = await run(`document.querySelectorAll('#phonestand [data-layer]').length`);
  ok(sv.logo?.length === 2 && sv.parts.filter((p) => p.name.startsWith('Logo')).length === 2 && svRows === 2 && Math.max(...sz) === 1000 && !Object.keys(sv.cfg.logo.layers).length && !blocking(sv.warnings).length,
    `SVG logo drawn at ${sz.join('×')} px: ${sv.logo?.map((e) => e.hex).join(' + ')} → 2 colour pieces and 2 rows (the old logo's colour settings cleared)`);
  await S('ps_12_svg_logo');

  ok(!errs.length, 'console errors: ' + (errs.join(' | ') || 'none'));
  log('done');
};
