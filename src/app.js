import { processImage, DEFAULT_PROC } from './core/processing.js';
import { imageReady } from './core/imageload.js';
import { shapesToGeometry, toWorld } from './core/geometry.js';
import { stlBinary, threeMF, objWithMtl, svg, mergeToIndexed } from './core/exporters.js';
import { buildFeatures, DEFAULT_SETTINGS, pencilAcross } from './core/features.js';
import { renderTextImage, ensureFont, BUNDLED_FONTS, DEFAULT_TEXT } from './core/text.js';
import { MODULES, MIC_PRESETS, CAKE_PRESETS, mergeDeep } from './modules.js';
import { detectElements, presetSelection, composeLayout, qrCanvas } from './core/elements.js';
import { nearestBambu, luminance, labDist } from './core/bambu.js';
import { BODY_PRESETS, BODY_SHAPES, fitSlotY, parseSTL, autoOrient, placeCustomBody } from './core/micbody.js';
import { Viewer3D } from './viewer3d.js';
import { View2D, isTyping } from './view2d.js';
import { Studio } from './studio.js';

const $ = (id) => document.getElementById(id);
const fmt = (v) => String(Math.round(v * 100) / 100);
const parseNum = (s) => parseFloat(String(s).trim().replace(',', '.'));

// Al entrar a un campo numérico se selecciona todo el valor para reemplazarlo directamente (p. ej. escribir "5").
const isNumField = (t) => t?.tagName === 'INPUT' && (t.type === 'number' || t.inputMode === 'decimal');
document.addEventListener('mousedown', (e) => {
  const t = e.target;
  if (isNumField(t) && document.activeElement !== t) { e.preventDefault(); t.focus(); t.select(); }
});
document.addEventListener('focusin', (e) => { if (isNumField(e.target)) e.target.select(); });
// rAF is paused while the window is hidden/occluded: never wait more than 100 ms for it.
const nextFrame = () => new Promise((r) => { const t = setTimeout(r, 100); requestAnimationFrame(() => setTimeout(() => { clearTimeout(t); r(); }, 0)); });
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const textOn = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150 ? '#1f2430' : '#ffffff';
};

const moduleDef = (id) => MODULES.find((m) => m.id === id) || MODULES.find((m) => m.id === 'logo');
const moduleSettings = (id) => mergeDeep(DEFAULT_SETTINGS(), JSON.parse(JSON.stringify(moduleDef(id).patch || {})));
const withDefaults = (s) => mergeDeep(DEFAULT_SETTINGS(), JSON.parse(JSON.stringify(s || {})));

const S = {
  module: 'logo',
  source: 'image',           // 'image' | 'text'
  text: DEFAULT_TEXT(),
  image: null,               // { name, dataURL, el }
  proc: { ...DEFAULT_PROC },
  result: null,
  pieces: [],                // per piece: { height, elevation, filament, enabled }
  filaments: [],             // { id, name, color }
  clusterFilament: [],       // detected color index -> filament id
  groups: [],                // { id, name, pieces: [ids] }
  settings: DEFAULT_SETTINGS(),
  selection: new Set(),
  tab: 'color',
  explode: false,
};
let nextId = 1;
const pieceGeoms = new Map();
let feat = null;             // buildFeatures() output
let featParts = [];          // [{ key, name, fil, geometry, height, z, solid }]
let ringDragPos = null;
let bodyDragPos = null;

// ---------------------------------------------------------------- views
const view2d = new View2D($('canvas2d'), {
  getDrawData,
  onClick: (pid, additive) => {
    if (pid < 0) { if (!additive) setSelection([]); return; }
    if (additive) toggleSelection([pid]); else setSelection([pid]);
  },
  onRect: ([x0, y0, x1, y1], additive) => {
    const ids = S.result.pieces.filter((p) => p.bbox[0] >= x0 && p.bbox[1] >= y0 && p.bbox[2] <= x1 && p.bbox[3] <= y1).map((p) => p.id);
    setSelection(additive ? [...S.selection, ...ids] : ids);
  },
  onHover: (pid) => renderHover(pid),
  onPlace: (x, y, o) => { const p = ringSnap(x, y, o?.free); ringDragPos = null; stopPlacing(); placeRing(p.x, p.y); },
  onRingMove: (x, y, o) => { ringDragPos = x == null ? null : [x, y, !!o?.free]; },
  onRingDrop: (x, y) => { const p = ringSnap(x, y, ringDragPos?.[2]); ringDragPos = null; placeRing(p.x, p.y); },
  onBodyMove: (x, y) => { bodyDragPos = [x, y]; },
  onBodyDrop: (x, y) => { bodyDragPos = null; placeBody(x, y); },
});
// Body centre (image px) → offset of the body relative to the design centre (mm, y-up).
function placeBody(x, y) {
  const [cx, cy] = center(), s = scale();
  Object.assign(S.settings.micBody, { ox: Math.round((x - cx) * s * 10) / 10, oy: Math.round((cy - y) * s * 10) / 10 });
  onSettingChanged('micBody.ox');
}
function placeRing(x, y) {
  Object.assign(S.settings.ring, { x, y, enabled: true, pos: 'manual' });
  rebuildFeatures();
  syncSettingsInputs();
  refresh();
  commit();
}
// Ring dimensions in image px (same formulas as features.js)
function ringDims() {
  const R = S.settings.ring, s = scale();
  const hr = Math.min(R.inner, R.outer - 0.8) / 2, wall = Math.max(0.8, R.outer / 2 - hr);
  const half = R.style === 'slot' ? Math.max(0, Math.max(R.slotW, R.inner) / 2 - hr) : 0;
  return { ro: (hr + wall) / s, ri: hr / s, half: half / s, off: (hr + Math.max(1.2, wall * 0.6)) / s };
}
// Snaps a cursor position to the outline of the keychain: the ring sits just outside the nearest edge.
function ringSnap(x, y, free = false) {
  const d = ringDims(), ref = feat?.ringRef;
  if (!ref?.length || free || S.settings.ring.snap === false) {
    let q = null;
    if (ref?.length) q = nearestOnShapes(ref, x, y);
    const L = q ? Math.hypot(q.x - x, q.y - y) || 1 : 1;
    const u = q ? [(q.x - x) / L, (q.y - y) / L] : [0, 1];
    return { x, y, ...d, tx: -u[1], ty: u[0], qx: q?.x, qy: q?.y, snapped: false };
  }
  const q = nearestOnShapes(ref, x, y);
  const inside = pointInShapes(ref, x, y);
  let nx = x - q.x, ny = y - q.y, L = Math.hypot(nx, ny);
  if (L < 1e-6) { nx = q.nx; ny = q.ny; L = 1; } else if (inside) { nx = -nx; ny = -ny; }
  nx /= L; ny /= L;
  const px = q.x + nx * d.off, py = q.y + ny * d.off;
  return { x: px, y: py, ...d, tx: ny, ty: -nx, qx: q.x, qy: q.y, snapped: true };
}
function nearestOnShapes(shapes, x, y) {
  let best = null, bd = Infinity;
  for (const sh of shapes) for (const loop of [sh.outer, ...sh.holes]) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [ax, ay] = loop[j], [bx, by] = loop[i], ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2));
      const qx = ax + ex * t, qy = ay + ey * t, dd = (qx - x) ** 2 + (qy - y) ** 2;
      if (dd < bd) { bd = dd; const el = Math.sqrt(l2); best = { x: qx, y: qy, nx: ey / el, ny: -ex / el }; }
    }
  }
  return best;
}
function pointInShapes(shapes, x, y) {
  let c = false;
  for (const sh of shapes) for (const loop of [sh.outer, ...sh.holes]) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [ax, ay] = loop[i], [bx, by] = loop[j];
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) c = !c;
    }
  }
  return c;
}

const viewer = new Viewer3D($('view3d'), {
  onPick: (pid, additive) => {
    if (pid == null) { if (!additive) setSelection([]); return; }
    if (additive) toggleSelection([pid]); else setSelection([pid]);
  },
});

// ---------------------------------------------------------------- helpers
const scale = () => {
  const b = S.result.fgBBox;
  return S.settings.widthMM / Math.max(1, b[2] - b[0]);
};
const center = () => {
  const b = S.result.fgBBox;
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
};
const filament = (id) => S.filaments.find((f) => f.id === id) || S.filaments[0];
const filamentIndex = (id) => Math.max(0, S.filaments.findIndex((f) => f.id === id));
const baseZ = () => feat?.pieceZ ?? 0;
const filFor = (fil) => {
  const set = S.settings;
  const id = fil === 'ring' ? set.ring.filament : fil === 'pencil' ? set.pencil.filament : fil === 'micBody' ? set.micBody.filament
    : fil === 'rim' ? set.rim.filament : fil === 'accent' ? set.accent.filament : set.base.filament;
  return S.filaments.some((f) => f.id === id) ? id : (S.filaments.some((f) => f.id === set.base.filament) ? set.base.filament : S.filaments[0]?.id);
};
const FIL_KEYS = ['base', 'ring', 'pencil', 'micBody', 'rim', 'accent'];

function getDrawData() {
  if (!S.result) return null;
  const r = feat?.ring;
  let ring = r && S.settings.ring.enabled ? r : null;
  if (ringDragPos) {
    const g = ringSnap(ringDragPos[0], ringDragPos[1], ringDragPos[2]);
    ring = { ...g, ghost: { qx: g.qx, qy: g.qy, snapped: g.snapped, color: filament(filFor('ring')).color } };
  }
  return {
    pieces: S.pieces.map((p) => ({ color: filament(p.filament).color, enabled: p.enabled })),
    selection: S.selection,
    hidePieces: !!feat?.hidePieces,
    marks: feat?.magnets || null,
    ring,
    body: bodyDraw(),
  };
}
function bodyDraw() {
  const b = feat?.body;
  if (!b) return null;
  const dx = bodyDragPos ? bodyDragPos[0] - b.x : 0, dy = bodyDragPos ? bodyDragPos[1] - b.y : 0;
  return { x: b.x + dx, y: b.y + dy, outline: dx || dy ? b.outline.map(([x, y]) => [x + dx, y + dy]) : b.outline, color: filament(filFor('micBody')).color };
}

function showBusy(text) { $('busyText').textContent = text; $('busy').hidden = false; }
function hideBusy() { $('busy').hidden = true; }
let toastTimer;
function toast(msg, error = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (error ? ' error' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), error ? 6000 : 3000);
}

// ---------------------------------------------------------------- loading & processing
async function loadImageFile(file) {
  if (!file) return;
  if (/\.(r3d|r3s|json)$/i.test(file.name)) return openProjectFile(file);
  if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) {
    toast('Formato no soportado: ' + file.name, true);
    return;
  }
  const dataURL = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  if (S.source === 'text') S.proc = { ...DEFAULT_PROC };
  await loadImage(dataURL, file.name, null);
}

// opts.keep: keep the current settings (text re-render / module switch with the same design)
async function loadImage(dataURL, name, state, { keep = false, source = 'image', composed = false } = {}) {
  const el = new Image();
  el.src = dataURL;
  try { await imageReady(el); } catch { toast('No se pudo leer la imagen.', true); return; }
  S.image = { name, dataURL, el, composed };
  S.source = source;
  $('docName').textContent = source === 'text' ? '' : '· ' + name;
  $('dropZone').classList.add('hidden');
  if (!keep) { hist.stack = []; hist.idx = -1; }
  if (!state && !keep) { S.settings = moduleSettings(S.module); S.groups = []; }
  await runProcessing(state, { keepSettings: keep });
  syncProcInputs();
  syncSettingsInputs();
  syncTextInputs();
}

function getImageData(el, maxRes) {
  const k = Math.min(1, maxRes / Math.max(el.naturalWidth, el.naturalHeight));
  const w = Math.max(1, Math.round(el.naturalWidth * k)), h = Math.max(1, Math.round(el.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(el, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// state: editable snapshot to apply after processing (undo / project); otherwise defaults are used.
async function runProcessing(state = null, { keepSettings = false } = {}) {
  if (!S.image) return;
  showBusy('Vectorizando imagen…');
  await nextFrame();
  try {
    const t0 = performance.now();
    const res = processImage(getImageData(S.image.el, S.proc.maxRes), { ...S.proc, widthMM: S.settings?.widthMM });
    const prevSettings = S.settings;
    S.result = res;
    S.selection.clear();
    setDefaults(res);
    if (keepSettings) {
      const fresh = S.settings;
      S.settings = withDefaults(prevSettings);
      for (const k of FIL_KEYS) S.settings[k].filament = fresh[k].filament;
    }
    if (state && state.pieces?.length === res.pieces.length) applyEditable(state);
    else if (state) { S.settings = withDefaults(state.settings); }

    viewer.clear();
    pieceGeoms.clear();
    featParts = [];
    const [cx, cy] = center();
    for (const p of res.pieces) {
      const g = shapesToGeometry(p.shapes, cx, cy);
      if (g) { pieceGeoms.set(p.id, g); viewer.addPiece(p.id, g); }
    }
    view2d.setContent(res, S.image.el);
    if (S.source === 'image' && !S.image.composed) setOrig();
    rebuildFeatures();
    if (!state && !keepSettings && S.source === 'image' && kcModule()) applyTier(S.settings.kc.tier || 'medium', { commit: false, silent: true });
    view2d.resize();
    view2d.fit();
    refresh();
    viewer.frame();
    if (!state || !hist.stack.length) commit();
    console.log(`Procesado en ${Math.round(performance.now() - t0)} ms: ${res.palette.length} colores, ${res.pieces.length} piezas`);
  } catch (err) {
    console.error(err);
    toast(err.message || String(err), true);
  } finally {
    hideBusy();
  }
}

function setDefaults(res) {
  S.filaments = res.palette.map((p, i) => ({ id: i + 1, name: `Color ${i + 1}`, color: p.hex }));
  nextId = S.filaments.length + 1;
  S.clusterFilament = res.palette.map((p, i) => i + 1);
  S.pieces = res.pieces.map((p) => ({
    height: Math.round((1.5 + Math.min(p.level, 5) * 0.6) * 10) / 10,
    elevation: 0,
    filament: S.clusterFilament[p.cluster],
    enabled: true,
  }));
  const outer = res.pieces.filter((p) => p.depth === 0).sort((a, b) => b.area - a.area)[0] || res.pieces[0];
  let fid = S.clusterFilament[outer.cluster];
  if (S.source === 'text') {
    const bc = S.text.baseColor.toLowerCase();
    const same = S.filaments.find((f) => f.color.toLowerCase() === bc);
    if (same) fid = same.id;
    else { fid = nextId++; S.filaments.push({ id: fid, name: 'Base', color: S.text.baseColor }); }
  }
  S.settings.base.filament = fid;
  S.settings.ring.filament = fid;
  S.settings.pencil.filament = fid;
  S.settings.micBody.filament = fid;
  S.settings.rim.filament = fid;
  S.settings.accent.filament = fid;
  S.groups = [];
}

// ---------------------------------------------------------------- 3D sync & extras
function sync3D() {
  if (!S.result) return;
  const s = scale(), bz = baseZ();
  viewer.setScaleXY(s);
  let rank = null;
  if (S.explode) {
    const fids = [...new Set(S.pieces.filter((p) => p.enabled).map((p) => p.filament))].sort((a, b) => filamentIndex(a) - filamentIndex(b));
    rank = new Map(fids.map((f, i) => [f, i]));
  }
  for (const p of S.result.pieces) {
    const st = S.pieces[p.id];
    const off = rank ? (rank.get(st.filament) + 1) * 5 : 0;
    viewer.updatePiece(p.id, {
      color: filament(st.filament).color,
      height: st.height,
      z: bz + st.elevation + off,
      visible: st.enabled && !feat?.hidePieces,
      selected: S.selection.has(p.id),
    });
  }
  for (const fp of featParts) viewer.updateExtra(fp.key, { color: filament(filFor(fp.fil)).color });
  viewer.requestRender();
}

// Rebuilds base / ring / sleeve / magnets… from the current settings.
// Back engraving: text rendered to a 0/1 mask (mm sized). Cached by its parameters.
let backCache = { key: '', mask: null };
function backMask() {
  const b = S.settings.back;
  if (!b?.enabled || !String(b.text || '').trim()) return null;
  const key = [b.text, b.font, b.heightMM].join('|');
  if (backCache.key === key) return backCache.mask;
  const lines = String(b.text).split(/\r?\n/), FS = 120;
  const c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently: true });
  const font = `700 ${FS}px "${b.font}", sans-serif`;
  ctx.font = font;
  const ms = lines.map((l) => ctx.measureText(l || ' '));
  const asc = Math.max(...ms.map((m) => m.actualBoundingBoxAscent), FS * 0.6), desc = Math.max(...ms.map((m) => m.actualBoundingBoxDescent), 0);
  const w = Math.ceil(Math.max(...ms.map((m) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight), 10)) + 8;
  const step = FS * 1.15, h = Math.ceil(asc + desc + step * (lines.length - 1)) + 8;
  c.width = w; c.height = h;
  ctx.font = font; ctx.fillStyle = '#000'; ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, w / 2, 4 + asc + i * step));
  const d = ctx.getImageData(0, 0, w, h).data, data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = d[i * 4 + 3] > 110 ? 1 : 0;
  const pxPerMM = (asc + desc) / Math.max(1.5, b.heightMM);
  const mask = { data, w, h, mmW: w / pxPerMM, mmH: h / pxPerMM };
  backCache = { key, mask };
  return mask;
}

function rebuildFeatures() {
  for (const fp of featParts) viewer.setExtra(fp.key, null);
  featParts = [];
  feat = null;
  if (!S.result) { view2d.setUnderlays([]); view2d.setBounds(null); renderWarnings(); return; }
  try {
    feat = buildFeatures(S.result, S.settings, {
      scale: scale(), center: center(), detail: S.proc.detail, smooth: S.proc.smooth, customBody: customBodyFor(S.settings.micBody),
      enabled: S.pieces.map((p) => p.enabled), backMask: backMask(),
    });
  } catch (err) {
    console.error(err);
    toast('No se pudieron generar los accesorios: ' + err.message, true);
  }
  const [cx, cy] = center();
  const under = [];
  if (feat) {
    for (const L of feat.layers) {
      const g = shapesToGeometry(L.shapes, cx, cy);
      if (!g) continue;
      const key = 'L:' + L.key, color = filament(filFor(L.fil)).color;
      viewer.setExtra(key, g, { color, height: L.height, z: L.z });
      featParts.push({ key, name: L.name, fil: L.fil, geometry: g, height: L.height, z: L.z, shapes: L.shapes });
      under.push({ shapes: L.shapes, color });
    }
    for (const so of feat.solids) {
      const key = 'S:' + so.key, color = filament(filFor(so.fil)).color;
      viewer.setExtra(key, so.geometry, { color, height: 1, z: 0 });
      featParts.push({ key, name: so.name, fil: so.fil, geometry: so.geometry, solid: true, shapes: so.footprint });
      if (so.fil !== 'micBody') under.push({ shapes: so.footprint, color, alpha: 0.85, dashed: true });
    }
  }
  view2d.setUnderlays(under);
  view2d.setBounds(feat?.bounds || null);
  renderWarnings();
}

let featTimer;
function rebuildFeaturesDebounced() {
  clearTimeout(featTimer);
  featTimer = setTimeout(() => { rebuildFeatures(); refresh(); }, 120);
}

function renderWarnings() {
  const w = feat?.warnings || [];
  const el = $('featWarn');
  el.hidden = !w.length;
  el.innerHTML = w.map((x) => `<div>⚠️ ${escHtml(x)}</div>`).join('');
}

// ---------------------------------------------------------------- selection
function setSelection(ids) {
  S.selection = new Set(ids.filter((id) => id >= 0));
  onSelectionChanged();
}
function toggleSelection(ids) {
  const allIn = ids.every((id) => S.selection.has(id));
  for (const id of ids) allIn ? S.selection.delete(id) : S.selection.add(id);
  onSelectionChanged();
}
function onSelectionChanged() {
  view2d.draw();
  sync3D();
  renderSelectionPanel();
  renderGroups();
  renderStatus();
}

// ---------------------------------------------------------------- editing
function setPropFor(ids, prop, value) {
  for (const id of ids) S.pieces[id][prop] = value;
  if (prop === 'enabled') rebuildFeatures();
  refresh();
}
function setSelProp(prop, value, doCommit = true) {
  if (!S.selection.size) return;
  setPropFor(S.selection, prop, value);
  if (doCommit) commit();
}

function refresh() {
  sync3D();
  view2d.draw();
  renderGroups();
  renderSelectionPanel();
  renderFilaments();
  renderStatus();
  updateUndoButtons();
}

// ---------------------------------------------------------------- history
const hist = { stack: [], idx: -1 };
function snapshot() {
  return JSON.stringify({
    proc: S.proc, pieces: S.pieces, filaments: S.filaments, clusterFilament: S.clusterFilament,
    groups: S.groups, settings: S.settings, module: S.module, source: S.source, text: S.text,
  });
}
function commit() {
  if (!S.result) return;
  const s = snapshot();
  if (hist.stack[hist.idx] === s) return;
  hist.stack = hist.stack.slice(0, hist.idx + 1);
  hist.stack.push(s);
  if (hist.stack.length > 150) hist.stack.shift();
  hist.idx = hist.stack.length - 1;
  updateUndoButtons();
}
function applyEditable(s) {
  S.pieces = s.pieces.map((p) => ({ ...p }));
  S.filaments = s.filaments.map((f) => ({ ...f }));
  S.clusterFilament = [...s.clusterFilament];
  S.groups = s.groups.map((g) => ({ ...g, pieces: [...g.pieces] }));
  S.settings = withDefaults(s.settings);
  nextId = Math.max(0, ...S.filaments.map((f) => f.id), ...S.groups.map((g) => g.id)) + 1;
  S.selection = new Set([...S.selection].filter((id) => id < S.pieces.length));
}
async function restore(json) {
  const s = JSON.parse(json);
  const textChanged = s.source === 'text' && JSON.stringify(s.text) !== JSON.stringify(S.text);
  if (textChanged || s.source !== S.source) {
    S.text = { ...DEFAULT_TEXT(), ...s.text };
    S.proc = { ...s.proc };
    if (s.source === 'text') {
      await ensureFont(S.text.font, S.text.weight);
      const r = renderTextImage(S.text, s.settings.widthMM);
      const el = new Image(); el.src = r.dataURL; await imageReady(el);
      S.image = { name: 'texto.png', dataURL: r.dataURL, el };
    }
    S.source = s.source;
    await runProcessing(s);
    syncTextInputs();
  } else if (JSON.stringify(s.proc) !== JSON.stringify(S.proc)) {
    S.proc = { ...s.proc };
    syncProcInputs();
    await runProcessing(s);
  } else {
    applyEditable(s);
    rebuildFeatures();
  }
  syncSettingsInputs();
  refresh();
}
async function undo() { if (hist.idx > 0) { hist.idx--; await restore(hist.stack[hist.idx]); } }
async function redo() { if (hist.idx < hist.stack.length - 1) { hist.idx++; await restore(hist.stack[hist.idx]); } }
function updateUndoButtons() {
  $('btnUndo').disabled = hist.idx <= 0;
  $('btnRedo').disabled = hist.idx >= hist.stack.length - 1;
}

// ---------------------------------------------------------------- panels: groups
let rowIds = new Map();
function groupRows() {
  const r = S.result;
  if (!r) return [];
  const rows = [];
  if (S.tab === 'color') {
    for (const f of S.filaments) {
      const ids = r.pieces.filter((p) => S.pieces[p.id].filament === f.id).map((p) => p.id);
      if (ids.length) rows.push({ key: 'f' + f.id, name: f.name, color: f.color, ids });
    }
  } else if (S.tab === 'level') {
    const levels = [...new Set(r.pieces.map((p) => p.level))].sort((a, b) => a - b);
    const label = (l) => (l === 0 ? 'Nivel 1 · borde exterior' : `Nivel ${l + 1}`);
    for (const l of levels) {
      const ids = r.pieces.filter((p) => p.level === l).map((p) => p.id);
      rows.push({ key: 'l' + l, name: label(l), color: null, ids });
    }
  } else if (S.tab === 'custom') {
    for (const g of S.groups) rows.push({ key: 'g' + g.id, name: g.name, color: null, ids: g.pieces, custom: g });
  } else {
    const s = scale();
    for (const p of [...r.pieces].sort((a, b) => b.area - a.area)) {
      rows.push({ key: 'p' + p.id, name: `Pieza ${p.id + 1} · ${fmt(p.area * s * s)} mm²`, color: filament(S.pieces[p.id].filament).color, ids: [p.id] });
    }
  }
  return rows;
}

function renderGroups() {
  const list = $('groupList');
  const rows = groupRows();
  rowIds = new Map(rows.map((r) => [r.key, r.ids]));
  if (!S.result) { list.innerHTML = '<div class="empty-note">Carga una imagen para empezar.</div>'; return; }
  if (!rows.length) {
    list.innerHTML = S.tab === 'custom'
      ? '<div class="empty-note">Aún no hay grupos.<br>Selecciona piezas y pulsa «Crear grupo» (Ctrl+G).</div>'
      : '<div class="empty-note">Sin elementos.</div>';
    return;
  }
  const html = rows.map((row) => {
    const hs = [...new Set(row.ids.map((id) => S.pieces[id].height))];
    const enabled = row.ids.some((id) => S.pieces[id].enabled);
    const active = row.ids.length && row.ids.length === S.selection.size && row.ids.every((id) => S.selection.has(id));
    const sw = row.color ? `<span class="sw" style="background:${row.color}"></span>` : `<span class="sw" style="background:linear-gradient(135deg,#e5e7eb,#9ca3af)"></span>`;
    return `<div class="grow-row ${active ? 'active' : ''} ${enabled ? '' : 'off'}" data-key="${row.key}">
      ${sw}
      <span class="name" title="${escHtml(row.name)}">${escHtml(row.name)}</span>
      <span class="cnt">${row.ids.length}</span>
      <span class="h-wrap"><input class="h" type="text" inputmode="decimal" title="Altura (mm) para todo el grupo · Enter para aplicar" value="${hs.length === 1 ? fmt(hs[0]) : ''}" data-orig="${hs.length === 1 ? fmt(hs[0]) : ''}" placeholder="—" /><span class="unit">mm</span></span>
      <button class="eye" title="Incluir / excluir del modelo">${enabled ? '👁' : '◌'}</button>
      ${row.custom ? '<button class="x" title="Eliminar grupo">✕</button>' : ''}
    </div>`;
  }).join('');
  list.innerHTML = html;
}

$('groupList').addEventListener('click', (e) => {
  const row = e.target.closest('.grow-row');
  if (!row) return;
  const ids = rowIds.get(row.dataset.key) || [];
  if (e.target.classList.contains('h') || e.target.tagName === 'INPUT') return;
  if (e.target.classList.contains('eye')) {
    const anyOn = ids.some((id) => S.pieces[id].enabled);
    setPropFor(ids, 'enabled', !anyOn);
    commit();
    return;
  }
  if (e.target.classList.contains('x')) {
    S.groups = S.groups.filter((g) => 'g' + g.id !== row.dataset.key);
    renderGroups();
    commit();
    return;
  }
  if (e.shiftKey || e.ctrlKey) toggleSelection(ids); else setSelection(ids);
});
$('groupList').addEventListener('change', (e) => {
  if (!e.target.classList.contains('h')) return;
  const row = e.target.closest('.grow-row');
  const v = parseNum(e.target.value);
  if (!(v > 0)) { e.target.value = e.target.dataset.orig; return; }
  setPropFor(rowIds.get(row.dataset.key) || [], 'height', Math.round(v * 100) / 100);
  commit();
});
$('groupList').addEventListener('keydown', (e) => {
  if (!e.target.classList.contains('h')) return;
  if (e.key === 'Enter') e.target.blur();
  else if (e.key === 'Escape') { e.target.value = e.target.dataset.orig; e.target.blur(); }
});
$('groupList').addEventListener('dblclick', (e) => {
  const row = e.target.closest('.grow-row');
  if (!row || !row.dataset.key.startsWith('g') || !e.target.classList.contains('name')) return;
  const g = S.groups.find((x) => 'g' + x.id === row.dataset.key);
  const span = e.target;
  span.innerHTML = `<input value="${escHtml(g.name)}" />`;
  const inp = span.querySelector('input');
  inp.focus(); inp.select();
  const done = () => { g.name = inp.value.trim() || g.name; renderGroups(); commit(); };
  inp.addEventListener('blur', done, { once: true });
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = g.name; inp.blur(); } });
});
$('groupTabs').addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (!t) return;
  S.tab = t.dataset.tab;
  document.querySelectorAll('#groupTabs .tab').forEach((b) => b.classList.toggle('active', b === t));
  renderGroups();
});
function createGroup() {
  if (!S.selection.size) { toast('Primero selecciona algunas piezas.'); return; }
  S.groups.push({ id: nextId++, name: `Grupo ${S.groups.length + 1}`, pieces: [...S.selection] });
  S.tab = 'custom';
  document.querySelectorAll('#groupTabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'custom'));
  renderGroups();
  commit();
  toast('Grupo creado. Doble clic en el nombre para renombrarlo.');
}
$('btnCreateGroup').onclick = createGroup;

// ---------------------------------------------------------------- panels: selection
function renderSelectionPanel() {
  const n = S.selection.size;
  $('selCount').textContent = n;
  $('selEmpty').hidden = n > 0;
  $('selProps').hidden = n === 0;
  if (!n) return;
  const sel = [...S.selection].map((id) => S.pieces[id]);
  const uniq = (k) => [...new Set(sel.map((p) => p[k]))];
  const hs = uniq('height'), es = uniq('elevation'), fs = uniq('filament'), en = uniq('enabled');
  const hEl = $('selHeight');
  if (document.activeElement !== hEl) { hEl.value = hs.length === 1 ? hs[0] : ''; hEl.placeholder = 'mixto'; }
  $('selHeightRange').value = hs.length === 1 ? hs[0] : sel.reduce((a, p) => a + p.height, 0) / sel.length;
  if (document.activeElement !== $('selElev')) { $('selElev').value = es.length === 1 ? es[0] : ''; $('selElev').placeholder = 'mixto'; }
  const fSel = $('selFilament');
  fSel.innerHTML = (fs.length > 1 ? '<option value="">— mixto —</option>' : '') +
    S.filaments.map((f, i) => `<option value="${f.id}">${i + 1}. ${escHtml(f.name)}</option>`).join('');
  fSel.value = fs.length === 1 ? fs[0] : '';
  $('selEnabled').checked = en.length === 1 ? en[0] : true;
  $('selEnabled').indeterminate = en.length > 1;
}
$('selHeight').addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (v > 0) setSelProp('height', v, false); });
$('selHeight').addEventListener('change', () => commit());
$('selHeightRange').addEventListener('input', (e) => setSelProp('height', parseFloat(e.target.value), false));
$('selHeightRange').addEventListener('change', () => commit());
$('selElev').addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (v >= 0) setSelProp('elevation', v, false); });
$('selElev').addEventListener('change', () => commit());
$('selFilament').addEventListener('change', (e) => { if (e.target.value) setSelProp('filament', Number(e.target.value)); });
$('selEnabled').addEventListener('change', (e) => setSelProp('enabled', e.target.checked));
document.querySelectorAll('[data-hstep]').forEach((b) => b.addEventListener('click', () => {
  const d = parseFloat(b.dataset.hstep);
  for (const id of S.selection) S.pieces[id].height = Math.max(0.1, Math.round((S.pieces[id].height + d) * 100) / 100);
  refresh(); commit();
}));
document.querySelectorAll('[data-hset]').forEach((b) => b.addEventListener('click', () => setSelProp('height', parseFloat(b.dataset.hset))));

// ---------------------------------------------------------------- panels: filaments
function renderFilaments() {
  const list = $('filamentList');
  if (document.activeElement && list.contains(document.activeElement) && document.activeElement.type === 'text') return;
  const counts = new Map();
  for (const p of S.pieces) counts.set(p.filament, (counts.get(p.filament) || 0) + 1);
  list.innerHTML = S.filaments.map((f, i) => `
    <div class="filament-row" data-id="${f.id}">
      <span class="num" style="background:${f.color};color:${textOn(f.color)}">${i + 1}</span>
      <input type="color" value="${f.color}" title="Color del filamento" />
      <input type="text" value="${escHtml(f.name)}" />
      <span class="muted small">${counts.get(f.id) || 0}</span>
      ${S.filaments.length > 1 ? '<button class="x" title="Eliminar filamento">✕</button>' : ''}
    </div>`).join('');

  const opts = S.filaments.map((f, i) => `<option value="${f.id}">${i + 1}. ${escHtml(f.name)}</option>`).join('');
  $('colorMatch').innerHTML = S.result ? S.result.palette.map((p, c) => `
    <div class="cm-item" data-c="${c}" title="Color detectado ${p.hex}">
      <span class="sw" style="background:${p.hex}"></span>→
      <select>${opts}</select>
    </div>`).join('') : '';
  $('colorMatch').querySelectorAll('.cm-item').forEach((el) => { el.querySelector('select').value = S.clusterFilament[+el.dataset.c]; });
  document.querySelectorAll('.fil-select').forEach((el) => { el.innerHTML = opts; el.value = getPath(S.settings, el.dataset.set) ?? ''; });
}
$('filamentList').addEventListener('input', (e) => {
  const row = e.target.closest('.filament-row');
  if (!row) return;
  const f = S.filaments.find((x) => x.id === +row.dataset.id);
  if (e.target.type === 'color') {
    f.color = e.target.value;
    row.querySelector('.num').style.background = f.color;
    row.querySelector('.num').style.color = textOn(f.color);
    sync3D(); view2d.draw();
  } else if (e.target.type === 'text') f.name = e.target.value;
});
$('filamentList').addEventListener('change', (e) => {
  if (e.target.type === 'text') { e.target.blur(); }
  refresh(); commit();
});
$('filamentList').addEventListener('click', (e) => {
  if (!e.target.classList.contains('x')) return;
  const id = +e.target.closest('.filament-row').dataset.id;
  const fallback = S.filaments.find((f) => f.id !== id).id;
  S.filaments = S.filaments.filter((f) => f.id !== id);
  for (const p of S.pieces) if (p.filament === id) p.filament = fallback;
  S.clusterFilament = S.clusterFilament.map((f) => (f === id ? fallback : f));
  for (const k of FIL_KEYS) if (S.settings[k].filament === id) S.settings[k].filament = fallback;
  refresh(); commit();
});
$('btnAddFilament').onclick = () => {
  S.filaments.push({ id: nextId++, name: `Filamento ${S.filaments.length + 1}`, color: '#888888' });
  refresh(); commit();
};
$('colorMatch').addEventListener('change', (e) => {
  const c = +e.target.closest('.cm-item').dataset.c;
  const fid = Number(e.target.value);
  S.clusterFilament[c] = fid;
  S.result.pieces.forEach((p) => { if (p.cluster === c) S.pieces[p.id].filament = fid; });
  refresh(); commit();
});

// ---------------------------------------------------------------- panels: settings
function syncProcInputs() {
  const p = S.proc;
  $('procColorsAuto').checked = !(p.colors > 0);
  $('procColors').disabled = !(p.colors > 0);
  $('procColors').value = p.colors > 0 ? p.colors : (S.result?.palette.length || 4);
  $('procDetail').value = p.detail;
  $('procSmooth').value = p.smooth;
  $('procMinArea').value = p.minArea;
  $('procMinWidth').value = String(p.minWidth ?? 0);
  $('procMinHole').value = String(p.minHoleMM ?? 0);
  $('procBg').value = p.removeBg;
  $('procTol').value = p.tolerance;
  $('procRes').value = p.maxRes;
  updateOutputs();
}
function updateOutputs() {
  $('procDetailOut').textContent = $('procDetail').value;
  $('procSmoothOut').textContent = $('procSmooth').value;
  $('procMinAreaOut').textContent = +$('procMinArea').value ? $('procMinArea').value : 'auto';
  $('procTolOut').textContent = $('procTol').value;
}
function readProcInputs() {
  S.proc = {
    colors: $('procColorsAuto').checked ? 0 : Math.max(2, Math.min(16, parseInt($('procColors').value) || 4)),
    detail: parseFloat($('procDetail').value),
    smooth: parseInt($('procSmooth').value),
    minArea: parseInt($('procMinArea').value),
    minWidth: parseFloat($('procMinWidth').value),
    minHoleMM: parseFloat($('procMinHole').value),
    removeBg: $('procBg').value,
    tolerance: parseInt($('procTol').value),
    maxRes: parseInt($('procRes').value),
  };
}
for (const id of ['procDetail', 'procSmooth', 'procMinArea', 'procTol']) $(id).addEventListener('input', updateOutputs);
for (const id of ['procColors', 'procDetail', 'procSmooth', 'procMinArea', 'procMinWidth', 'procMinHole', 'procBg', 'procTol', 'procRes', 'procColorsAuto']) {
  $(id).addEventListener('change', async () => {
    $('procColors').disabled = $('procColorsAuto').checked;
    readProcInputs();
    if (S.image) { await runProcessing(null, { keepSettings: true }); syncProcInputs(); syncSettingsInputs(); }
  });
}
$('btnReprocess').onclick = async () => { readProcInputs(); if (S.image) { await runProcessing(null, { keepSettings: true }); syncProcInputs(); syncSettingsInputs(); } };

const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
const evalWhen = (expr) => {
  const neg = expr.includes('!=');
  const [path, vals] = expr.split(neg ? '!=' : '=');
  const v = String(getPath(S.settings, path));
  const hit = vals.split('|').includes(v);
  return neg ? !hit : hit;
};

function syncSettingsInputs() {
  document.querySelectorAll('[data-set]').forEach((el) => {
    if (el === document.activeElement && el.type === 'text') return;
    const v = getPath(S.settings, el.dataset.set);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.dataset.str) el.value = v ?? '';
    else if (el.tagName === 'SELECT') { if (!el.classList.contains('fil-select')) el.value = String(v); }
    else el.value = v == null ? '' : fmt(v);
  });
  document.querySelectorAll('[data-when]').forEach((el) => { el.hidden = !evalWhen(el.dataset.when); });
  const p = S.settings.pencil;
  $('pencilValueLabel').textContent = p.measure === 'circumference' ? 'Circunferencia (mm)' : p.type === 'hex' ? 'Ancho entre caras (mm)' : 'Diámetro / ancho (mm)';
  const across = pencilAcross(p);
  $('pencilInfo').textContent = `Lápiz ≈ ${fmt(across)} mm de ancho · ${fmt(across * (p.type === 'round' ? Math.PI : p.type === 'hex' ? 6 / Math.sqrt(3) : 0) + (p.type === 'triangle' ? 2 * Math.sqrt(3) * Math.max(0.5, across - 2) + 2 * Math.PI : 0))} mm de circunferencia · canal interior ${fmt(across + p.tolerance)} mm`;
  renderFilaments();
  try { renderMicBodyUI(); } catch { /* not initialised yet during startup */ }
  try { renderTierUI(); syncBackFont(); } catch { /* idem */ }
  document.body.classList.toggle('has-micbody', !!S.settings.micBody?.enabled);
  renderStatus();
}

function onSettingChanged(path) {
  if (path === 'ring.pos' && S.settings.ring.pos === 'manual' && S.settings.ring.x == null && feat?.ring) Object.assign(S.settings.ring, { x: feat.ring.x, y: feat.ring.y });
  if (path === 'widthMM' && S.source === 'text' && (S.text.thicken > 0 || S.text.outline)) { applyText(); return; }
  const set = S.settings;
  if (S.result && (path === 'accent.enabled' || path === 'rim.enabled')) {
    const k = path.split('.')[0];
    if (set[k].enabled && filFor(k) === filFor('base')) {
      const color = k === 'accent' ? '#e4bd68' : (S.filaments.find((f) => f.id !== filFor('base'))?.color || '#c12e1f');
      const same = S.filaments.find((f) => f.id !== filFor('base') && f.color.toLowerCase() === color);
      if (same) set[k].filament = same.id;
      else { const id = nextId++; S.filaments.push({ id, name: k === 'accent' ? 'Acento ≈ Gold' : 'Borde', color }); set[k].filament = id; }
    }
  }
  if (path.startsWith('back.') && set.back.enabled) {
    backCache.key = '';
    ensureFont(set.back.font, 700).catch(() => {}).then(() => { backCache.key = ''; syncSettingsInputs(); if (S.result) { rebuildFeatures(); refresh(); commit(); } });
    return;
  }
  syncSettingsInputs();
  if (!S.result) return;
  rebuildFeatures();
  refresh();
  if (path === 'widthMM') viewer.frame();
  commit();
}
document.querySelectorAll('[data-set]').forEach((el) => {
  const path = el.dataset.set;
  el.addEventListener('change', () => {
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.dataset.str) v = el.value;
    else if (el.tagName === 'SELECT') v = /^-?\d+(\.\d+)?$/.test(el.value) ? Number(el.value) : el.value;
    else {
      v = parseNum(el.value);
      if (!Number.isFinite(v)) { syncSettingsInputs(); return; }
      if (!el.dataset.allowneg) v = Math.max(el.dataset.min ? parseFloat(el.dataset.min) : 0, v);
      v = Math.round(v * 100) / 100;
    }
    setPath(S.settings, path, v);
    onSettingChanged(path);
  });
  if (el.type === 'text') el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
});
document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
  mergeDeep(S.settings, JSON.parse(b.dataset.preset));
  onSettingChanged('preset');
}));
$('micPreset').innerHTML = '<option value="">— elegir —</option>' + Object.entries(MIC_PRESETS).map(([k, p]) => `<option value="${k}">${escHtml(p.name)}</option>`).join('');
$('micPreset').addEventListener('change', (e) => {
  const p = MIC_PRESETS[e.target.value];
  if (!p) return;
  const set = S.settings;
  mergeDeep(set, { magnets: p.magnets, tongue: p.tongue });
  set.base.enabled = true;
  if (set.base.shape !== 'contour') { set.base.plateW = p.plate; set.base.plateH = p.plate; }
  set.widthMM = Math.round(p.plate * 0.78);
  if (set.base.thickness < 3) set.base.thickness = 3;
  onSettingChanged('widthMM');
});
$('cakePreset').innerHTML = '<option value="">— elegir —</option>' + Object.entries(CAKE_PRESETS).map(([k, p]) => `<option value="${k}">${escHtml(p.name)}</option>`).join('');
$('cakePreset').addEventListener('change', (e) => {
  const p = CAKE_PRESETS[e.target.value];
  if (!p) return;
  S.settings.widthMM = p.widthMM;
  mergeDeep(S.settings.sticks, { ...p.sticks, enabled: true });
  onSettingChanged('widthMM');
});
// ---------------------------------------------------------------- mic body
const MB_LIB_KEY = 'r3d.micBodies';
const mbRaw = new Map(), mbPlaced = new Map();
const mbLib = () => { try { return JSON.parse(localStorage.getItem(MB_LIB_KEY) || '[]'); } catch { return []; } };
const f32ToB64 = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToF32 = (b) => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float32Array(u.buffer); };
function customBodyFor(mb) {
  if (!mb?.enabled || mb.shape !== 'custom' || !mb.customId) return null;
  const key = mb.customId + '|' + (mb.customRot || [0, 0, 0]).join(',');
  if (mbPlaced.has(key)) return mbPlaced.get(key);
  let raw = mbRaw.get(mb.customId);
  if (!raw) {
    const e = mbLib().find((x) => x.id === mb.customId);
    if (!e) return null;
    raw = b64ToF32(e.data);
    mbRaw.set(mb.customId, raw);
  }
  const r = { positions: placeCustomBody(raw, mb.customRot).body };
  mbPlaced.set(key, r);
  return r;
}
function renderMicBodyUI() {
  $('micBodyPreset').innerHTML = '<option value="">— elegir —</option>' + Object.entries(BODY_PRESETS).map(([k, p]) => `<option value="${k}">${escHtml(p.name)}</option>`).join('')
    + mbLib().map((e) => `<option value="custom:${e.id}">📦 ${escHtml(e.name)}</option>`).join('');
  $('micBodyShape').innerHTML = Object.entries(BODY_SHAPES).map(([k, n]) => `<option value="${k}">${escHtml(n)}</option>`).join('');
  $('micBodyCustom').innerHTML = mbLib().map((e) => `<option value="${e.id}">${escHtml(e.name)}</option>`).join('') || '<option value="">(ninguno cargado)</option>';
  const mb = S.settings.micBody;
  $('micBodyShape').value = mb.shape;
  $('micBodyCustom').value = mb.customId || '';
  $('micBodyPreset').value = mb.shape === 'custom' ? (mb.customId ? 'custom:' + mb.customId : '') : (mb.preset && BODY_PRESETS[mb.preset] ? mb.preset : '');
}
renderMicBodyUI();
$('micBodyPreset').addEventListener('change', (e) => {
  const v = e.target.value, mb = S.settings.micBody;
  if (!v) return;
  if (v.startsWith('custom:')) {
    const id = v.slice(7), ent = mbLib().find((x) => x.id === id);
    Object.assign(mb, { shape: 'custom', customId: id, customRot: ent?.rot || [0, 0, 0], preset: null });
  } else {
    const keep = { enabled: true, filament: mb.filament, ox: mb.ox, oy: mb.oy, rot: mb.rot, customId: mb.customId, customRot: mb.customRot };
    Object.assign(mb, structuredClone(BODY_PRESETS[v]), keep, { preset: v });
    delete mb.name;
  }
  renderMicBodyUI();
  onSettingChanged('micBody.preset');
});
$('micBodyShape').addEventListener('change', () => { S.settings.micBody.preset = null; renderMicBodyUI(); });
$('micBodyCustom').addEventListener('change', (e) => {
  const ent = mbLib().find((x) => x.id === e.target.value);
  if (!ent) return;
  Object.assign(S.settings.micBody, { customId: ent.id, customRot: ent.rot || [0, 0, 0] });
  renderMicBodyUI();
  onSettingChanged('micBody.customId');
});
$('btnMicBodyLoad').onclick = () => $('micBodyFile').click();
$('micBodyFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const raw = parseSTL(await file.arrayBuffer());
    if (!raw.length) throw new Error('El STL no tiene triángulos.');
    const rot = autoOrient(raw), id = 'b' + Date.now().toString(36);
    const name = file.name.replace(/\.stl$/i, '');
    const lib = mbLib().filter((x) => x.name !== name);
    lib.push({ id, name, rot, data: f32ToB64(raw) });
    try { localStorage.setItem(MB_LIB_KEY, JSON.stringify(lib)); } catch { toast('El STL es muy grande para guardarlo en la biblioteca; se usará solo en esta sesión.', true); }
    mbRaw.set(id, raw);
    Object.assign(S.settings.micBody, { enabled: true, shape: 'custom', customId: id, customRot: rot, preset: null });
    renderMicBodyUI();
    onSettingChanged('micBody.customId');
    const size = placeCustomBody(raw, rot).size;
    toast(`Cuerpo cargado: ${size.map((v) => fmt(v)).join(' × ')} mm`);
  } catch (err) { toast('No se pudo leer el STL: ' + err.message, true); }
});
const rotCustom = (axis) => {
  const mb = S.settings.micBody;
  if (!mb.customId) return;
  const r = [...(mb.customRot || [0, 0, 0])];
  r[axis] = (r[axis] + 90) % 360;
  mb.customRot = r;
  const lib = mbLib(), ent = lib.find((x) => x.id === mb.customId);
  if (ent) { ent.rot = r; try { localStorage.setItem(MB_LIB_KEY, JSON.stringify(lib)); } catch { /* keep in memory */ } }
  onSettingChanged('micBody.customRot');
};
$('btnMicBodyRotX').onclick = () => rotCustom(0);
$('btnMicBodyRotY').onclick = () => rotCustom(1);
$('btnMicBodyDel').onclick = async () => {
  const mb = S.settings.micBody;
  if (!mb.customId) return;
  const r = await window.api.confirm({ message: '¿Quitar este cuerpo de la biblioteca?', buttons: ['Quitar', 'Cancelar'], cancelId: 1 });
  if (r !== 0) return;
  localStorage.setItem(MB_LIB_KEY, JSON.stringify(mbLib().filter((x) => x.id !== mb.customId)));
  mbRaw.delete(mb.customId);
  Object.assign(mb, structuredClone(BODY_PRESETS.square), { shape: 'rect', preset: 'square', customId: null });
  delete mb.name;
  renderMicBodyUI();
  onSettingChanged('micBody.shape');
};
$('btnMicSlotFit').onclick = () => {
  const mb = S.settings.micBody;
  const r = fitSlotY(mb);
  mb.slotY = r.slotY;
  onSettingChanged('micBody.slotY');
  toast(r.wall >= 1.2 ? `Hueco centrado: pared mínima ${fmt(r.wall)} mm` : 'El hueco no cabe en esta forma: reduce la ranura o agranda el cuerpo.', r.wall < 1.2);
};
$('btnMicBodyCenter').onclick = () => {
  Object.assign(S.settings.micBody, { ox: 0, oy: 0 });
  onSettingChanged('micBody.ox');
};

$('btnPlaceRing').onclick = () => {
  if (!S.result) return;
  if (!S.settings.ring.enabled) { S.settings.ring.enabled = true; rebuildFeatures(); syncSettingsInputs(); refresh(); }
  view2d.placing = true;
  $('placeHint').hidden = false;
  if ($('views').classList.contains('mode-3d')) setViewMode('split');
};
function stopPlacing() { view2d.placing = false; $('placeHint').hidden = true; }

// ---------------------------------------------------------------- status
function modelBounds() {
  return feat?.bounds || S.result.fgBBox;
}
function renderStatus() {
  if (!S.result) { $('stPieces').textContent = 'Sin diseño'; $('stSize').textContent = ''; return; }
  const s = scale();
  const [x0, y0, x1, y1] = modelBounds();
  const pieceTop = feat?.hidePieces ? 0 : Math.max(0, ...S.pieces.filter((p) => p.enabled).map((p) => p.height + p.elevation)) + baseZ();
  const zMax = Math.max(pieceTop, feat?.zTop || 0);
  $('stPieces').textContent = `${S.result.pieces.length} piezas · ${S.filaments.length} filamentos`;
  $('stSelection').textContent = S.selection.size ? `${S.selection.size} seleccionadas` : '';
  $('stSize').textContent = `Tamaño: ${fmt((x1 - x0) * s)} × ${fmt((y1 - y0) * s)} × ${fmt(zMax)} mm` + (kcModule() ? ` · ≈ ${fmt(gramsEstimate())} g` : '');
  if (kcModule()) $('gramsInfo').textContent = `Peso estimado ≈ ${fmt(gramsEstimate())} g de PLA (macizo). Útil para cotizar por unidad.`;
  const fb = S.result.fgBBox;
  $('setHeightOut').textContent = fmt((fb[3] - fb[1]) * s);
}function renderHover(pid) {
  if (pid < 0 || !S.result) { $('stHover').textContent = ''; return; }
  const p = S.result.pieces[pid], st = S.pieces[pid], s = scale();
  $('stHover').textContent = `Pieza ${pid + 1} · ${filament(st.filament).name} · altura ${fmt(st.height)} mm · ${fmt(p.area * s * s)} mm²`;
}

// ---------------------------------------------------------------- project files
async function saveProject() {
  if (!S.image) return;
  const data = JSON.stringify({ app: 'Relieve3D', version: 1, image: { name: S.image.name, dataURL: S.image.dataURL }, state: JSON.parse(snapshot()) });
  const p = await window.api.saveFile({ defaultPath: baseName() + '.r3d', filters: [{ name: 'Proyecto Relieve3D', extensions: ['r3d'] }], data });
  if (p) toast('Proyecto guardado: ' + p);
}
async function openProjectFile(file) {
  try {
    const j = JSON.parse(await file.text());
    if (j.app === 'Relieve3D-Studio') { hideHome(); studio.openProject(j); return; }
    if (j.app !== 'Relieve3D') throw new Error('No es un proyecto de Relieve3D');
    S.module = j.state.module || 'logo';
    S.text = { ...DEFAULT_TEXT(), ...(j.state.text || {}) };
    S.proc = { ...DEFAULT_PROC, ...j.state.proc };
    hideHome();
    $('studio').hidden = true;
    S.source = j.state.source || 'image';
    applyModuleUI();
    syncProcInputs();
    if (S.source === 'text') await ensureFont(S.text.font, S.text.weight);
    await loadImage(j.image.dataURL, j.image.name, j.state, { source: S.source });
    toast('Proyecto abierto');
  } catch (err) {
    toast('No se pudo abrir el proyecto: ' + err.message, true);
  }
}
const baseName = () => (S.image?.name || 'modelo').replace(/\.[^.]+$/, '');

// ---------------------------------------------------------------- export
function exportParts() {
  const s = scale(), bz = baseZ();
  const byFil = new Map();
  const add = (fid, g) => { if (!byFil.has(fid)) byFil.set(fid, []); byFil.get(fid).push(g); };
  const parts = [];
  if (!feat?.hidePieces) {
    for (const p of S.result.pieces) {
      const st = S.pieces[p.id], g = pieceGeoms.get(p.id);
      if (!st.enabled || !g) continue;
      add(st.filament, toWorld(g, s, st.height, bz + st.elevation));
    }
    S.filaments.forEach((f, i) => {
      if (byFil.has(f.id)) parts.push({ name: f.name, color: f.color, filamentIndex: i, filamentId: f.id, geometry: mergeToIndexed(byFil.get(f.id)) });
    });
  }
  // accessories (base, ring, sleeve…): one part per layer/solid, never merged, so stacked layers stay manifold
  for (const fp of featParts) {
    const fid = filFor(fp.fil);
    const geometry = mergeToIndexed([fp.solid ? toWorld(fp.geometry, s, 1, 0) : toWorld(fp.geometry, s, fp.height, fp.z)]);
    parts.push({ name: fp.name || fp.key, color: filament(fid).color, filamentIndex: filamentIndex(fid), filamentId: fid, geometry });
  }
  return parts;
}
async function doExport(kind) {
  if (!S.result) { toast('Primero carga una imagen.'); return; }
  showBusy('Generando archivo…');
  await nextFrame();
  try {
    const name = baseName();
    let saved = null;
    if (kind === 'svg') {
      const layers = [];
      const s = scale();
      for (const fp of featParts) if (fp.key !== 'S:micrings') layers.push({ name: fp.name, color: filament(filFor(fp.fil)).color, items: [fp.shapes] });
      if (!feat?.hidePieces) for (const f of S.filaments) {
        const items = S.result.pieces.filter((p) => S.pieces[p.id].enabled && S.pieces[p.id].filament === f.id).map((p) => p.shapes);
        if (items.length) layers.push({ name: f.name, color: f.color, items });
      }
      const [x0, y0, x1, y1] = modelBounds();
      saved = await window.api.saveFile({ defaultPath: name + '.svg', filters: [{ name: 'SVG', extensions: ['svg'] }], data: svg(layers, [x0 - 2, y0 - 2, x1 + 2, y1 + 2], s) });
    } else {
      const parts = exportParts();
      if (!parts.length) throw new Error('No hay piezas incluidas en el modelo.');
      if (kind === '3mf') {
        saved = await window.api.saveFile({ defaultPath: name + '.3mf', filters: [{ name: '3MF', extensions: ['3mf'] }], data: threeMF(parts, name, { pauses: feat?.pauses }) });
      } else if (kind === 'stl-one') {
        saved = await window.api.saveFile({ defaultPath: name + '.stl', filters: [{ name: 'STL', extensions: ['stl'] }], data: stlBinary(parts.map((p) => p.geometry)) });
      } else if (kind === 'stl-folder') {
        const byF = new Map();
        for (const p of parts) { if (!byF.has(p.filamentId)) byF.set(p.filamentId, []); byF.get(p.filamentId).push(p.geometry); }
        const files = [...byF].map(([fid, geoms]) => {
          const i = filamentIndex(fid), f = filament(fid);
          return { name: `${name}_${i + 1}_${f.name.replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '').trim() || 'color'}.stl`, data: stlBinary(geoms) };
        });
        saved = await window.api.saveFilesToFolder({ files });
      } else if (kind === 'obj') {
        const mtlName = name + '.mtl';
        const o = objWithMtl(parts, mtlName);
        saved = await window.api.saveFile({ defaultPath: name + '.obj', filters: [{ name: 'OBJ', extensions: ['obj'] }], data: o.obj, extraFiles: [{ name: mtlName, data: o.mtl }] });
      }
    }
    if (saved) toast('Exportado: ' + saved);
  } catch (err) {
    console.error(err);
    toast('Error al exportar: ' + err.message, true);
  } finally {
    hideBusy();
  }
}

// ---------------------------------------------------------------- top bar & misc UI
function setViewMode(mode) {
  $('views').className = 'views mode-' + mode;
  document.querySelectorAll('#viewMode .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  setTimeout(() => { view2d.resize(); viewer.resize(); if (mode !== '2d' && S.result) viewer.frame(); }, 0);
}
$('viewMode').addEventListener('click', (e) => { const b = e.target.closest('.seg-btn'); if (b) setViewMode(b.dataset.mode); });

$('btnOpenImage').onclick = $('btnOpenImage2').onclick = () => $('fileImage').click();
$('fileImage').onchange = (e) => { loadImageFile(e.target.files[0]); e.target.value = ''; };
$('btnOpenProject').onclick = () => $('fileProject').click();
$('fileProject').onchange = (e) => { if (e.target.files[0]) openProjectFile(e.target.files[0]); e.target.value = ''; };
$('btnSaveProject').onclick = saveProject;
$('btnUndo').onclick = undo;
$('btnRedo').onclick = redo;

$('btnExport').onclick = (e) => { e.stopPropagation(); $('exportMenu').classList.toggle('open'); };
document.addEventListener('click', () => $('exportMenu').classList.remove('open'));
$('exportMenu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-exp]');
  if (b) { $('exportMenu').classList.remove('open'); doExport(b.dataset.exp); }
});

document.querySelectorAll('.tool[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
function setTool(t) {
  view2d.tool = t;
  document.querySelectorAll('.tool[data-tool]').forEach((x) => x.classList.toggle('active', x.dataset.tool === t));
}
$('btnZoomIn').onclick = () => view2d.zoomCenter(1.25);
$('btnZoomOut').onclick = () => view2d.zoomCenter(0.8);
$('btnFit').onclick = () => view2d.fit();
$('btnShowOriginal').onclick = (e) => { view2d.showOriginal = !view2d.showOriginal; e.currentTarget.classList.toggle('active', view2d.showOriginal); view2d.draw(); };
$('btnShowEdges').onclick = (e) => { view2d.showEdges = !view2d.showEdges; e.currentTarget.classList.toggle('active', view2d.showEdges); view2d.draw(); };
$('btn3dFit').onclick = () => viewer.frame();
$('btn3dTop').onclick = () => viewer.frame(true);
$('btn3dExplode').onclick = (e) => { S.explode = !S.explode; e.currentTarget.classList.toggle('active', S.explode); sync3D(); viewer.frame(); };

const allIds = () => S.result ? S.result.pieces.map((p) => p.id) : [];
$('selAll').onclick = () => setSelection(allIds());
$('selNone').onclick = () => setSelection([]);
$('selInvert').onclick = () => setSelection(allIds().filter((id) => !S.selection.has(id)));
$('selSameColor').onclick = () => {
  const fs = new Set([...S.selection].map((id) => S.pieces[id].filament));
  if (!fs.size) return toast('Selecciona al menos una pieza.');
  setSelection(allIds().filter((id) => fs.has(S.pieces[id].filament)));
};
$('selSameLevel').onclick = () => {
  const ls = new Set([...S.selection].map((id) => S.result.pieces[id].level));
  if (!ls.size) return toast('Selecciona al menos una pieza.');
  setSelection(allIds().filter((id) => ls.has(S.result.pieces[id].level)));
};

// drag & drop
const dz = $('dropZone');
document.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.remove('hidden'); dz.classList.add('drag'); });
document.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) { dz.classList.remove('drag'); if (S.image || S.source === 'text' || !$('home').hidden || !$('studio').hidden) dz.classList.add('hidden'); } });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dz.classList.remove('drag');
  if (S.image || S.source === 'text') dz.classList.add('hidden');
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (!$('studio').hidden) { studio.loadFile(f); return; }
  if (/\.(r3d|r3s|json)$/i.test(f.name)) { openProjectFile(f); return; }
  if (!$('home').hidden) { S.module = 'logo'; clearDesign(); hideHome(); applyModuleUI(); }
  loadImageFile(f);
});

// keyboard
window.addEventListener('keydown', (e) => {
  if (isTyping(e) || !$('home').hidden || !$('studio').hidden) return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (ctrl && k === 's') { e.preventDefault(); saveProject(); }
  else if (ctrl && k === 'o') { e.preventDefault(); $('fileImage').click(); }
  else if (ctrl && k === 'a') { e.preventDefault(); setSelection(allIds()); }
  else if (ctrl && k === 'g') { e.preventDefault(); createGroup(); }
  else if (k === 'escape') { if (view2d.placing) stopPlacing(); else setSelection([]); }
  else if (k === 'f') view2d.fit();
  else if (k === 'v') setTool('select');
  else if (k === 'h') setTool('pan');
  else if (k === 'delete' && S.selection.size) setSelProp('enabled', false);
  else if ((k === '+' || k === '=') && S.selection.size) document.querySelector('[data-hstep="0.2"]').click();
  else if ((k === '-' || k === '_') && S.selection.size) document.querySelector('[data-hstep="-0.2"]').click();
});

// ---------------------------------------------------------------- text source
const textFields = {
  txtText: 'text', txtFont: 'font', txtWeight: 'weight', txtItalic: 'italic', txtSpacing: 'spacing', txtLine: 'lineHeight',
  txtAlign: 'align', txtFill: 'fill', txtThicken: 'thicken', txtOutline: 'outline', txtOutlineColor: 'outlineColor',
  txtOutlineMM: 'outlineMM', txtBaseColor: 'baseColor',
};
function fontOptions(systemFonts = []) {
  const cats = [...new Set(BUNDLED_FONTS.map((f) => f.cat))];
  let html = cats.map((c) => `<optgroup label="${escHtml(c)}">${BUNDLED_FONTS.filter((f) => f.cat === c).map((f) => `<option value="${escHtml(f.family)}">${escHtml(f.family)}</option>`).join('')}</optgroup>`).join('');
  if (systemFonts.length) html += `<optgroup label="Fuentes instaladas en el equipo (${systemFonts.length})">${systemFonts.map((f) => `<option value="${escHtml(f)}">${escHtml(f)}</option>`).join('')}</optgroup>`;
  return html;
}
let systemFonts = [];
$('txtFont').innerHTML = fontOptions();
$('backFont').innerHTML = fontOptions();
window.api?.listFonts?.().then((list) => {
  systemFonts = list.filter((f) => !BUNDLED_FONTS.some((b) => b.family === f));
  const v = $('txtFont').value;
  $('txtFont').innerHTML = fontOptions(systemFonts);
  $('txtFont').value = S.text.font || v;
  $('backFont').innerHTML = fontOptions(systemFonts);
  syncBackFont();
  studio.setSystemFonts(systemFonts);
}).catch(() => {});

function syncTextInputs() {
  for (const [id, k] of Object.entries(textFields)) {
    const el = $(id), v = S.text[k];
    if (el === document.activeElement && el.type === 'text') continue;
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.tagName === 'SELECT') {
      if (id === 'txtFont' && ![...el.options].some((o) => o.value === v)) el.insertAdjacentHTML('beforeend', `<option value="${escHtml(v)}">${escHtml(v)}</option>`);
      el.value = String(v);
    } else el.value = typeof v === 'number' ? fmt(v) : v;
  }
  document.querySelectorAll('[data-twhen]').forEach((el) => { el.hidden = !S.text[el.dataset.twhen]; });
  $('fontPreview').style.fontFamily = `"${S.text.font}"`;
  $('fontPreview').style.fontWeight = S.text.weight;
  $('fontPreview').textContent = (S.text.text || 'Aa').split('\n')[0];
  document.querySelectorAll('#sourceSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.src === S.source));
  $('textFields').hidden = S.source !== 'text';
  $('procCard').hidden = S.source === 'text';
}

let textSeq = 0;
async function applyText() {
  const seq = ++textSeq;
  await ensureFont(S.text.font, S.text.weight);
  if (seq !== textSeq) return;
  if (!String(S.text.text).trim()) { toast('Escribe un texto.'); return; }
  const r = renderTextImage(S.text, S.settings.widthMM);
  S.proc = { ...DEFAULT_PROC, colors: r.colors, removeBg: 'no', maxRes: 1600, detail: 0.6, minArea: 0 };
  await loadImage(r.dataURL, 'texto.png', null, { keep: !!S.result, source: 'text' });
}
let textTimer;
for (const [id, k] of Object.entries(textFields)) {
  const el = $(id);
  const read = () => {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (['weight', 'spacing', 'lineHeight', 'thicken', 'outlineMM'].includes(k)) {
      v = parseNum(v);
      if (!Number.isFinite(v)) return false;
      if (k !== 'spacing') v = Math.max(0, v);
    }
    S.text[k] = v;
    return true;
  };
  const go = () => { if (read()) { syncTextInputs(); clearTimeout(textTimer); textTimer = setTimeout(applyText, k === 'text' ? 450 : 50); } };
  if (id === 'txtText') el.addEventListener('input', go);
  else el.addEventListener('change', go);
  if (el.type === 'text') el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
}
$('sourceSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-src]');
  if (!b) return;
  if (b.dataset.src === 'image') $('fileImage').click();
  else if (S.source !== 'text') { S.source = 'text'; syncTextInputs(); applyText(); }
});

// ---------------------------------------------------------------- keychain: logo parts, layouts, tiers, brand tools
let orig = null;   // original (uncomposed) logo: { result, flat, els, name, dataURL, proc, sel:Set, scales, layout, qr, qrPos, frontName }
function kcModule() { return moduleDef(S.module).cards.includes('kctier'); }

// Processed image repainted with the flat detected colours (no anti-aliasing → clean re-vectorization).
function flatCanvas(res) {
  const c = document.createElement('canvas');
  c.width = res.width; c.height = res.height;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(res.width, res.height);
  const rgbOf = res.palette.map((p) => { const n = parseInt(p.hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
  for (let i = 0; i < res.comp.length; i++) {
    const pid = res.comp[i];
    if (pid < 0 || !res.pieces[pid]) continue;
    const [r, g, b] = rgbOf[res.pieces[pid].cluster];
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function setOrig() {
  const res = S.result;
  let els = [];
  try { els = detectElements(res, { gap: +$('elemGap').value || 0.025 }); } catch (err) { console.warn('elements', err); }
  orig = { result: res, flat: flatCanvas(res), els, name: S.image.name, dataURL: S.image.dataURL, proc: { ...S.proc },
    sel: new Set(els.map((e) => e.id)), scales: {}, layout: 'original', qr: null, qrPos: 'below', frontName: '' };
  renderElements();
}
// Solid single-colour pixels only (alpha threshold) so the composition has exactly the design colours.
function binarizeAlpha(c) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] >= 128 ? 255 : 0;
  ctx.putImageData(d, 0, 0);
  return c;
}
function countColors(c) {
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  const m = new Map(); let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    n++;
    const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Math.max(2, Math.min(12, [...m.values()].filter((v) => v >= n * 0.003).length));
}
function selUnion() {
  const sel = orig.els.filter((e) => orig.sel.has(e.id));
  const b = [Math.min(...sel.map((e) => e.bbox[0])), Math.min(...sel.map((e) => e.bbox[1])), Math.max(...sel.map((e) => e.bbox[2])), Math.max(...sel.map((e) => e.bbox[3]))];
  return { w: b[2] - b[0], h: b[3] - b[1] };
}
function darkestDesignHex() {
  return [...orig.result.palette].sort((a, b) => luminance(a.hex) - luminance(b.hex))[0]?.hex || '#111111';
}
function nameCanvas(text, heightPx) {
  const FS = Math.max(24, Math.round(heightPx));
  const c = document.createElement('canvas'), ctx = c.getContext('2d');
  const font = `900 ${FS}px "Poppins Black", sans-serif`;
  ctx.font = font;
  const m = ctx.measureText(text);
  c.width = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + 8;
  c.height = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + 8;
  ctx.font = font; ctx.fillStyle = darkestDesignHex();
  ctx.fillText(text, 4 + m.actualBoundingBoxLeft, 4 + m.actualBoundingBoxAscent);
  return binarizeAlpha(c);
}
let qrInfo = null;
function compositionExtras() {
  const extras = [], u = selUnion();
  qrInfo = null;
  if (orig.frontName) extras.push({ canvas: nameCanvas(orig.frontName, u.h * 0.2) });
  if (orig.qr) {
    const q = qrCanvas(orig.qr, { dark: darkestDesignHex(), light: '#ffffff', px: 10 });
    const target = orig.qrPos === 'right' ? Math.max(u.h, u.w * 0.3) : Math.max(u.w * 0.42, u.h * 0.6);
    const scaleQ = target / q.canvas.width;
    extras.push({ canvas: binarizeAlpha(q.canvas), scale: scaleQ });
    qrInfo = { px: q.canvas.width * scaleQ, modules: q.modules };
  }
  return extras;
}
function isOriginalComposition() {
  return orig.layout === 'original' && orig.sel.size === orig.els.length && !orig.qr && !orig.frontName
    && Object.values(orig.scales).every((v) => v === 1);
}
function composeCurrent({ withExtras = true } = {}) {
  return composeLayout(orig.flat, orig.result, orig.els, {
    ids: [...orig.sel], layout: orig.layout, scales: orig.scales, extras: withExtras ? compositionExtras() : [], extraPos: orig.qrPos,
  });
}
async function applyComposition() {
  if (!orig) return;
  if (!orig.sel.size) { toast('Deja al menos una parte del logo.', true); return; }
  if (orig.frontName) await ensureFont('Poppins Black', 900);
  const tier = S.settings.kc?.tier;
  const R = S.settings.ring, b0 = S.result.fgBBox;
  const rel = R.pos === 'manual' && R.x != null ? [(R.x - b0[0]) / Math.max(1, b0[2] - b0[0]), (R.y - b0[1]) / Math.max(1, b0[3] - b0[1])] : null;
  const keepOrig = orig;
  if (isOriginalComposition()) {
    S.proc = { ...orig.proc };
    await loadImage(orig.dataURL, orig.name, null, { keep: true });
  } else {
    const c = composeCurrent();
    if (!c) return;
    S.proc = { ...orig.proc, colors: countColors(c), removeBg: 'auto', minArea: 0, maxRes: Math.max(orig.proc.maxRes || 1000, 1600) };
    await loadImage(c.toDataURL('image/png'), orig.name, null, { keep: true, composed: true });
    orig = keepOrig;
  }
  if (orig !== keepOrig) {   // original reloaded: keep the user choices on the fresh element list
    orig.qrPos = keepOrig.qrPos;
  }
  syncProcInputs();
  if (tier) applyTier(tier, { commit: false, silent: true });
  if (rel) {
    const b = S.result.fgBBox;
    Object.assign(S.settings.ring, { x: b[0] + rel[0] * (b[2] - b[0]), y: b[1] + rel[1] * (b[3] - b[1]) });
    rebuildFeatures();
    const p = ringSnap(S.settings.ring.x, S.settings.ring.y);
    Object.assign(S.settings.ring, { x: p.x, y: p.y });
    rebuildFeatures();
  }
  if (qrInfo && S.image.composed) {
    const k = S.result.width / Math.max(1, S.image.el.naturalWidth);
    const modMM = (qrInfo.px * k * scale()) / qrInfo.modules;
    if (modMM < 0.9) toast(`QR pequeño: cada cuadro mide ${fmt(modMM)} mm. Sube el ancho a ≈ ${Math.ceil(S.settings.widthMM * 1 / modMM)} mm o pon el QR a la derecha para que se pueda escanear.`, true);
    else toast(`QR listo: cuadros de ${fmt(modMM)} mm (escaneable).`);
  }
  hist.stack = []; hist.idx = -1;
  syncSettingsInputs();
  refresh();
  viewer.frame();
  commit();
  renderElements();
}

function renderElements() {
  const card = $('elemCard');
  const show = !!orig && S.source === 'image' && !!S.result && moduleDef(S.module).cards.includes('elements');
  card.hidden = !show;
  if (!show) return;
  $('btnElemRestore').hidden = !S.image?.composed;
  if (orig.els.length < 2) {
    $('elemList').innerHTML = '<p class="muted small">El logo es una sola parte. Usa «Agrupar partes» (más a la izquierda) para separarlo más fino.</p>';
  } else {
    $('elemList').innerHTML = orig.els.map((e) => `<div class="elem-row" data-el="${e.id}">
      <label class="chk"><input type="checkbox" data-elchk="${e.id}" ${orig.sel.has(e.id) ? 'checked' : ''} /><canvas class="elem-thumb" data-elthumb="${e.id}" width="64" height="40"></canvas><span>${escHtml(e.label)}</span></label>
      <span class="inline"><input type="text" inputmode="decimal" class="elem-scale" data-elscale="${e.id}" value="${Math.round((orig.scales[e.id] || 1) * 100)}" title="Tamaño de esta parte (%)" />%</span></div>`).join('');
    for (const e of orig.els) {
      const th = card.querySelector(`[data-elthumb="${e.id}"]`);
      const c = composeLayout(orig.flat, orig.result, orig.els, { ids: [e.id] });
      if (th && c) drawFit(th, c);
    }
  }
  renderAlts();
}
function drawFit(dst, src) {
  const ctx = dst.getContext('2d');
  ctx.clearRect(0, 0, dst.width, dst.height);
  const k = Math.min(dst.width / src.width, dst.height / src.height);
  const w = src.width * k, h = src.height * k;
  ctx.drawImage(src, (dst.width - w) / 2, (dst.height - h) / 2, w, h);
}
function altList() {
  const els = orig.els, all = els.map((e) => e.id);
  const icon = els.some((e) => e.kind === 'icono'), text = els.some((e) => e.kind === 'texto');
  const alts = [{ name: 'Como el logo', layout: 'original', ids: all }];
  const nos = presetSelection(els, 'noslogan');
  if (nos.length && nos.length < all.length) alts.push({ name: 'Sin eslogan', layout: 'original', ids: nos });
  if (icon && els.length > 1) alts.push({ name: 'Solo ícono', layout: 'original', ids: presetSelection(els, 'icon') });
  if (text && els.length > 1) alts.push({ name: 'Solo nombre', layout: 'original', ids: presetSelection(els, 'text') });
  if (icon && text) {
    alts.push({ name: 'Ícono arriba + nombre', layout: 'stack', ids: presetSelection(els, 'stack') });
    alts.push({ name: 'Ícono + nombre en fila', layout: 'row', ids: presetSelection(els, 'row') });
  }
  return alts;
}
function renderAlts() {
  const box = $('elemAlts');
  if (orig.els.length < 2) { box.innerHTML = ''; return; }
  const alts = altList();
  const same = (a) => a.layout === orig.layout && a.ids.length === orig.sel.size && a.ids.every((id) => orig.sel.has(id));
  box.innerHTML = alts.map((a, i) => `<button class="elem-alt${same(a) ? ' active' : ''}" data-alt="${i}" title="${escHtml(a.name)}"><canvas width="120" height="76"></canvas><span>${escHtml(a.name)}</span></button>`).join('');
  alts.forEach((a, i) => {
    const c = composeLayout(orig.flat, orig.result, orig.els, { ids: a.ids, layout: a.layout, scales: orig.scales });
    const cv = box.querySelector(`[data-alt="${i}"] canvas`);
    if (c && cv) drawFit(cv, c);
  });
}
$('elemList').addEventListener('change', (e) => {
  const chk = e.target.closest('[data-elchk]'), sc = e.target.closest('[data-elscale]');
  if (chk) {
    const id = +chk.dataset.elchk;
    if (chk.checked) orig.sel.add(id); else orig.sel.delete(id);
    if (!orig.sel.size) { chk.checked = true; orig.sel.add(id); toast('Deja al menos una parte.'); return; }
    applyComposition();
  } else if (sc) {
    const v = parseNum(sc.value);
    if (!Number.isFinite(v)) { renderElements(); return; }
    orig.scales[+sc.dataset.elscale] = Math.max(0.2, Math.min(4, v / 100));
    applyComposition();
  }
});
$('elemList').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.elem-scale')) e.target.blur(); });
$('elemList').addEventListener('mouseover', (e) => {
  const row = e.target.closest('[data-el]');
  if (!row || S.image?.composed || !orig || orig.result !== S.result) return;
  const el = orig.els[+row.dataset.el];
  if (el) setSelection(el.pieces);
});
$('elemList').addEventListener('mouseleave', () => { if (!S.image?.composed && S.selection.size) setSelection([]); });
$('elemGap').addEventListener('change', () => {
  if (!orig) return;
  orig.els = detectElements(orig.result, { gap: +$('elemGap').value });
  orig.sel = new Set(orig.els.map((e) => e.id));
  orig.scales = {};
  renderElements();
});
document.querySelectorAll('[data-elpreset]').forEach((b) => b.addEventListener('click', () => {
  if (!orig) return;
  orig.sel = new Set(presetSelection(orig.els, b.dataset.elpreset));
  applyComposition();
}));
$('elemAlts').addEventListener('click', (e) => {
  const b = e.target.closest('[data-alt]');
  if (!b || !orig) return;
  const a = altList()[+b.dataset.alt];
  orig.layout = a.layout;
  orig.sel = new Set(a.ids);
  applyComposition();
});
$('btnElemRestore').onclick = () => {
  if (!orig) return;
  Object.assign(orig, { sel: new Set(orig.els.map((e) => e.id)), scales: {}, layout: 'original', qr: null, frontName: '' });
  applyComposition();
};

// ---- product tiers (Sencillo / Medio / Premium)
const TIERS = {
  basic: { label: 'Sencillo', n: 1, base: 1.8, relief: 0.8, margin: 2.5 },
  medium: { label: 'Medio', n: 2, base: 2.6, relief: 1.2, margin: 3 },
  premium: { label: 'Premium', n: 2, base: 3.4, relief: 1.0, margin: 3.5 },
};
const round1 = (v) => Math.round(v * 10) / 10;
function designColors() {
  const area = new Map();
  for (const p of S.result.pieces) if (S.pieces[p.id]?.enabled) area.set(p.cluster, (area.get(p.cluster) || 0) + p.area);
  return [...area].sort((a, b) => b[1] - a[1]).map(([c]) => ({ c, hex: S.result.palette[c].hex }));
}
function applyTier(tier, { commit: doCommit = true, silent = false } = {}) {
  if (!S.result) { toast('Primero carga un logo o escribe un texto.'); return; }
  const T = TIERS[tier];
  const cols = designColors();
  if (!T || !cols.length) return;
  const B = luminance(cols[0].hex) < 140 ? '#ffffff' : '#000000';
  const cand = cols.filter((c) => labDist(c.hex, B) > 25);
  const kept = (cand.length ? cand : cols).slice(0, T.n);
  const fils = [{ id: 1, name: 'Base', color: B }];
  kept.forEach((c, i) => fils.push({ id: i + 2, name: `Color ${i + 1}`, color: c.hex }));
  let accentId = null;
  if (tier === 'premium') {
    const gold = '#e4bd68', silver = '#a6a9aa';
    accentId = fils.length + 1;
    fils.push({ id: accentId, name: 'Acento', color: kept.some((c) => labDist(c.hex, gold) < 30) ? silver : gold });
  }
  for (const f of fils) f.name += ` ≈ ${nearestBambu(f.color).name}`;
  const opts = fils.filter((f) => f.id !== accentId);
  let pick = (hex) => opts.reduce((b, o) => (labDist(hex, o.color) < labDist(hex, b.color) ? o : b)).id;
  if (tier === 'basic' && kept.length) {
    // 2 colours: split the design at its biggest luminance gap so details keep their contrast
    // (e.g. pink letters on a white plate become base-coloured letters instead of vanishing into white)
    const Ls = cols.map((c) => luminance(c.hex)).sort((a, b) => a - b);
    let gap = 0, thr = 0;
    for (let i = 1; i < Ls.length; i++) if (Ls[i] - Ls[i - 1] > gap) { gap = Ls[i] - Ls[i - 1]; thr = (Ls[i] + Ls[i - 1]) / 2; }
    const domLight = luminance(kept[0].hex) >= thr;
    if (gap >= 40) pick = (hex) => ((luminance(hex) >= thr) === domLight ? 2 : 1);
  }
  const chroma = (hex) => { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return Math.max(r, g, b) - Math.min(r, g, b); };
  const rimFil = kept.length ? 2 + kept.reduce((bi, c, i) => (chroma(c.hex) > chroma(kept[bi].hex) ? i : bi), 0) : 1;
  S.filaments = fils;
  nextId = fils.length + 1;
  S.clusterFilament = S.result.palette.map((p) => pick(p.hex));
  for (const p of S.result.pieces) {
    const st = S.pieces[p.id];
    st.filament = S.clusterFilament[p.cluster];
    st.elevation = 0;
    st.height = tier === 'premium' ? round1(T.relief + 0.6 * Math.min(p.level, 3)) : T.relief;
  }
  const set = S.settings;
  Object.assign(set.base, { enabled: true, thickness: T.base, margin: T.margin, filament: 1 });
  Object.assign(set.ring, { enabled: true, thickness: T.base, filament: 1 });
  set.pencil.filament = 1; set.micBody.filament = 1;
  Object.assign(set.rim, { enabled: tier === 'medium', width: 1.2, height: T.relief, filament: rimFil });
  Object.assign(set.accent, { enabled: tier === 'premium', width: 1.5, height: 0.6, filament: accentId || 1 });
  Object.assign(set.bevel, { enabled: tier === 'premium', size: 0.6 });
  set.kc.tier = tier;
  rebuildFeatures();
  syncSettingsInputs();
  refresh();
  renderTierUI();
  if (doCommit) commit();
  if (!silent) toast(`Versión ${T.label}: ${fils.length} colores · base ${fmt(T.base)} mm · ≈ ${fmt(gramsEstimate())} g`);
}
function renderTierUI() {
  const t = S.settings.kc?.tier;
  document.querySelectorAll('#tierGrid [data-tier]').forEach((b) => b.classList.toggle('active', b.dataset.tier === t));
  if (!S.result) return;
  const used = new Set(S.pieces.filter((p) => p.enabled).map((p) => p.filament));
  for (const fp of featParts) used.add(filFor(fp.fil));
  const sw = S.filaments.filter((f) => used.has(f.id)).map((f) => `<span class="sw" style="background:${f.color}" title="${escHtml(f.name)}"></span>`).join('');
  $('tierInfo').innerHTML = `${t ? `<b>${TIERS[t].label}</b> · ` : ''}${used.size} colores ${sw} · ≈ ${fmt(gramsEstimate())} g`;
}
$('tierGrid').addEventListener('click', (e) => { const b = e.target.closest('[data-tier]'); if (b) applyTier(b.dataset.tier); });
$('btnBambuColors').onclick = () => {
  if (!S.result) return;
  for (const f of S.filaments) {
    const nb = nearestBambu(f.color);
    f.color = nb.hex;
    f.name = f.name.replace(/\s*≈.*$/, '') + ` ≈ ${nb.name}`;
  }
  sync3D(); refresh(); renderTierUI(); commit();
  toast('Colores ajustados al PLA Basic de Bambu Lab más cercano.');
};

// ---- weight estimate (solid PLA 1.24 g/cm³)
function polyArea(loop) { let a = 0; for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) a += (loop[j][0] + loop[i][0]) * (loop[j][1] - loop[i][1]); return Math.abs(a) / 2; }
const shapesArea = (shapes) => (shapes || []).reduce((t, sh) => t + polyArea(sh.outer) - sh.holes.reduce((u, h) => u + polyArea(h), 0), 0);
function gramsEstimate() {
  if (!S.result) return 0;
  const s2 = scale() ** 2;
  let v = 0;
  if (!feat?.hidePieces) for (const p of S.result.pieces) { const st = S.pieces[p.id]; if (st.enabled) v += p.area * s2 * st.height; }
  for (const fp of featParts) if (!fp.solid) v += shapesArea(fp.shapes) * s2 * fp.height;
  return Math.round((v / 1000) * 1.24 * 10) / 10;
}

// ---- brand tools: QR, batch names, proposal sheet
$('btnAddQR').onclick = () => {
  const t = $('qrText').value.trim();
  if (!orig || S.source !== 'image') { toast('El QR se agrega sobre un logo (imagen).', true); return; }
  if (!t) { orig.qr = null; applyComposition(); return; }
  orig.qr = t;
  orig.qrPos = $('qrPos').value;
  applyComposition();
};
$('btnBatch').onclick = async () => {
  const names = $('batchNames').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!S.result || !names.length) { toast('Escribe al menos un nombre (uno por línea).', true); return; }
  const where = $('batchWhere').value;
  if (where === 'front' && (!orig || S.source !== 'image')) { toast('«Al frente» necesita un logo (imagen).', true); return; }
  const prev = snapshot(), prevBack = { ...S.settings.back }, prevFront = orig?.frontName || '';
  const files = [];
  try {
    for (let i = 0; i < names.length; i++) {
      showBusy(`Generando ${i + 1} de ${names.length}: ${names[i]}…`);
      await nextFrame();
      if (where === 'back') {
        Object.assign(S.settings.back, { enabled: true, text: names[i] });
        await ensureFont(S.settings.back.font, 700);
        backCache.key = '';
        rebuildFeatures();
      } else {
        orig.frontName = names[i];
        await applyComposition();
      }
      const fname = `${baseName()}_${names[i]}`.replace(/[\\/:*?"<>|]+/g, '').trim();
      files.push({ name: fname + '.3mf', data: threeMF(exportParts(), fname, { pauses: feat?.pauses }) });
    }
    hideBusy();
    const dir = await window.api.saveFilesToFolder({ files });
    if (dir) toast(`${files.length} archivos 3MF guardados en ${dir}`);
  } catch (err) {
    console.error(err);
    toast('Error en el lote: ' + err.message, true);
  } finally {
    hideBusy();
    if (where === 'back') { S.settings.back = prevBack; backCache.key = ''; await restore(prev); }
    else { orig.frontName = prevFront; await applyComposition(); }
  }
};
$('btnProposal').onclick = async () => {
  if (!S.result) { toast('Primero carga un logo.'); return; }
  const prev = snapshot();
  showBusy('Preparando la hoja de propuesta…');
  await ensureFont('Poppins Black', 900).catch(() => {});
  const shots = [];
  try {
    for (const t of ['basic', 'medium', 'premium']) {
      applyTier(t, { commit: false, silent: true });
      await nextFrame();
      const img = new Image();
      img.src = viewer.productShot(760, 760, t === 'premium' ? 0xfdf6e3 : 0xf3f4f6);
      await imageReady(img);
      const [x0, y0, x1, y1] = modelBounds(), s = scale();
      const used = new Set(S.pieces.filter((p) => p.enabled).map((p) => p.filament));
      for (const fp of featParts) used.add(filFor(fp.fil));
      shots.push({ t, img, w: (x1 - x0) * s, h: (y1 - y0) * s, z: Math.max(feat?.zTop || 0, ...S.pieces.map((p) => p.height + p.elevation)) + baseZ(), g: gramsEstimate(),
        cols: S.filaments.filter((f) => used.has(f.id)) });
    }
    const W = 1800, H = 1000, col = W / 3, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#111827'; ctx.font = '700 44px "Poppins Black", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`Propuesta de llaveros · ${baseName()}`, W / 2, 70);
    ctx.font = '400 22px sans-serif'; ctx.fillStyle = '#6b7280';
    ctx.fillText('Impresión 3D multicolor · medidas en milímetros', W / 2, 108);
    shots.forEach((sh, i) => {
      const x = i * col, pad = 30;
      ctx.fillStyle = i === 2 ? '#fdf6e3' : '#f3f4f6';
      ctx.beginPath(); ctx.roundRect(x + 15, 140, col - 30, H - 170, 24); ctx.fill();
      const bw = col - 2 * pad - 30, bh = 520, k = Math.min(bw / sh.img.width, bh / sh.img.height);
      ctx.drawImage(sh.img, x + col / 2 - (sh.img.width * k) / 2, 160 + (bh - sh.img.height * k) / 2, sh.img.width * k, sh.img.height * k);
      ctx.textAlign = 'center'; ctx.fillStyle = '#111827'; ctx.font = '700 40px "Poppins Black", sans-serif';
      ctx.fillText(TIERS[sh.t].label, x + col / 2, 730);
      ctx.font = '400 24px sans-serif'; ctx.fillStyle = '#374151';
      ctx.fillText(`${fmt(sh.w)} × ${fmt(sh.h)} × ${fmt(sh.z)} mm`, x + col / 2, 775);
      ctx.fillText(`${sh.cols.length} colores · ≈ ${fmt(sh.g)} g`, x + col / 2, 810);
      const sw = 36, gap = 10, tw = sh.cols.length * (sw + gap) - gap;
      sh.cols.forEach((f, j) => {
        ctx.fillStyle = f.color; ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(x + col / 2 - tw / 2 + j * (sw + gap), 840, sw, sw, 8); ctx.fill(); ctx.stroke();
      });
      ctx.font = '400 18px sans-serif'; ctx.fillStyle = '#6b7280';
      const desc = { basic: 'Delgado, 2 colores, el más económico', medium: 'Más grueso, 3 colores con borde elevado', premium: 'Grueso, 4 colores, bisel y contorno metálico' }[sh.t];
      ctx.fillText(desc, x + col / 2, 920);
    });
    const bin = atob(c.toDataURL('image/png').split(',')[1]), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    hideBusy();
    const p = await window.api.saveFile({ defaultPath: baseName() + '_propuesta.png', filters: [{ name: 'PNG', extensions: ['png'] }], data: u8 });
    if (p) toast('Propuesta guardada: ' + p);
  } catch (err) {
    console.error(err);
    toast('No se pudo crear la propuesta: ' + err.message, true);
  } finally {
    hideBusy();
    applyEditable(JSON.parse(prev));
    rebuildFeatures();
    syncSettingsInputs();
    refresh();
    renderTierUI();
    viewer.frame();
  }
};
$('backFont').addEventListener('change', () => { S.settings.back.font = $('backFont').value; onSettingChanged('back.font'); });
function syncBackFont() {
  const el = $('backFont'), v = S.settings.back?.font || 'Poppins Black';
  if (![...el.options].some((o) => o.value === v)) el.insertAdjacentHTML('beforeend', `<option value="${escHtml(v)}">${escHtml(v)}</option>`);
  el.value = v;
}

// ---------------------------------------------------------------- modules & home
const studio = new Studio($('studio'), {
  toast,
  showBusy,
  hideBusy,
  onBack: () => showHome(),
  onSendTo3D: (payload) => sendStudioTo3D(payload),
});

function renderHome() {
  const card = (m) => `<button class="home-card" data-mod="${m.id}"><span class="hc-icon">${m.icon}</span><span class="hc-title">${escHtml(m.title)}</span><span class="hc-desc">${escHtml(m.desc)}</span></button>`;
  $('homeGrid3d').innerHTML = MODULES.filter((m) => m.group === '3d').map(card).join('');
  $('homeGrid2d').innerHTML = MODULES.filter((m) => m.group === '2d').map(card).join('');
}
function showHome() {
  $('studio').hidden = true;
  $('home').hidden = false;
  $('homeContinue').hidden = !S.result;
  if (S.result) $('homeContinue').textContent = `↩ Continuar: ${moduleDef(S.module).title}`;
}
function hideHome() { $('home').hidden = true; }

function applyModuleUI() {
  const m = moduleDef(S.module);
  $('moduleName').textContent = `· ${m.icon} ${m.title}`;
  const all = $('showAllCards').checked;
  document.querySelectorAll('[data-card]').forEach((el) => { el.hidden = !(all || m.cards.includes(el.dataset.card)); });
  $('textCard').hidden = !m.cards.includes('text');
  if (!S.result) $('dropZone').classList.toggle('hidden', S.source === 'text');
  syncTextInputs();
  renderElements();
  renderTierUI();
  setTimeout(() => { view2d.resize(); viewer.resize(); }, 0);
}
$('showAllCards').addEventListener('change', applyModuleUI);

function clearDesign() {
  viewer.clear();
  pieceGeoms.clear();
  featParts = []; feat = null;
  orig = null;
  Object.assign(S, { image: null, result: null, pieces: [], filaments: [], clusterFilament: [], groups: [] });
  S.selection.clear();
  S.settings = moduleSettings(S.module);
  S.source = moduleDef(S.module).source;
  S.proc = { ...DEFAULT_PROC };
  view2d.result = null;
  view2d.setUnderlays([]);
  view2d.setBounds(null);
  view2d.draw();
  hist.stack = []; hist.idx = -1;
  $('docName').textContent = '';
  $('dropZone').classList.toggle('hidden', S.source === 'text');
  renderWarnings();
  refresh();
  syncSettingsInputs();
}

async function enterModule(id) {
  const m = moduleDef(id);
  if (m.group === '2d') { hideHome(); studio.open(id); return; }
  let keep = false;
  if (S.result) {
    if (S.module === id) { hideHome(); return; }
    const r = await window.api.confirm({ message: `¿Quieres usar el diseño actual en «${m.title}»?`, buttons: ['Usar el diseño actual', 'Empezar uno nuevo', 'Cancelar'], cancelId: 2 });
    if (r === 2) return;
    keep = r === 0;
  }
  S.module = id;
  hideHome();
  if (keep) {
    const old = S.settings;
    S.settings = moduleSettings(id);
    for (const k of FIL_KEYS) S.settings[k].filament = old[k]?.filament ?? old.base.filament;
    applyModuleUI();
    if (S.source === 'text') { await applyText(); } else { rebuildFeatures(); refresh(); viewer.frame(); commit(); }
    syncSettingsInputs();
    return;
  }
  clearDesign();
  applyModuleUI();
  if (m.source === 'text') {
    S.text = { ...DEFAULT_TEXT(), ...(m.text || {}) };
    syncTextInputs();
    await applyText();
  }
}

async function sendStudioTo3D({ dataURL, colors, widthMM, name, module, outlined }) {
  S.module = module || 'logo';
  clearDesign();
  S.source = 'image';
  $('studio').hidden = true;
  hideHome();
  applyModuleUI();
  S.proc = { ...DEFAULT_PROC, colors, removeBg: 'no', maxRes: 1600, detail: 0.6, minArea: 0 };
  await loadImage(dataURL, name, null, { source: 'image' });
  S.settings.widthMM = widthMM;
  // the studio already drew the silhouette: the 3D base simply follows it
  if (outlined && S.settings.base?.enabled) Object.assign(S.settings.base, { shape: 'contour', margin: 0 });
  rebuildFeatures();
  syncSettingsInputs();
  refresh();
  viewer.frame();
  hist.stack = []; hist.idx = -1;
  commit();
}

$('homeGrid3d').addEventListener('click', (e) => { const b = e.target.closest('[data-mod]'); if (b) enterModule(b.dataset.mod); });
$('homeGrid2d').addEventListener('click', (e) => { const b = e.target.closest('[data-mod]'); if (b) enterModule(b.dataset.mod); });
$('homeContinue').onclick = () => { if (S.result) hideHome(); };
$('homeOpenProject').onclick = () => $('fileProject').click();
$('btnHome').onclick = showHome;
// test hook (used by automated screenshot runs)
window.api?.onTestImage(({ name, bytes }) => loadImageFile(new File([bytes], name, { type: 'image/png' })));

// auto-update status (from GitHub Releases vía electron-updater)
const stUpdate = $('stUpdate');
if (stUpdate) {
  stUpdate.addEventListener('click', () => { if (stUpdate.dataset.ready === '1') window.api.installUpdate(); });
  window.api?.onUpdateStatus((d) => {
    stUpdate.hidden = false;
    stUpdate.dataset.ready = d.state === 'ready' ? '1' : '0';
    if (d.state === 'checking') { stUpdate.hidden = true; }
    else if (d.state === 'available') stUpdate.textContent = `Descargando actualización ${d.version}…`;
    else if (d.state === 'downloading') stUpdate.textContent = `Descargando actualización… ${d.percent}%`;
    else if (d.state === 'ready') { stUpdate.textContent = `Versión ${d.version} lista · clic para reiniciar e instalar`; stUpdate.classList.add('clickable'); }
    else if (d.state === 'up-to-date' || d.state === 'error') stUpdate.hidden = true;
  });
}
window.__r3d = { S, setSelection, doExport, exportParts, undo, redo, commit, hist, setViewMode, enterModule, applyText, showHome, studio, getFeat: () => feat, onSettingChanged, placeRing, loadImageFile, view2d,
  applyTier, applyComposition, getOrig: () => orig, ringSnap, gramsEstimate, viewer, renderElements };

syncProcInputs();
updateUndoButtons();
renderGroups();
renderHome();
syncSettingsInputs();
syncTextInputs();
window.api?.appVersion?.().then((v) => { $('homeVersion').textContent = 'Versión ' + v; }).catch(() => {});
