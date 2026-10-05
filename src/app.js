import { processImage, DEFAULT_PROC } from './core/processing.js';
import { imageReady } from './core/imageload.js';
import { shapesToGeometry, toWorld } from './core/geometry.js';
import { stlBinary, threeMF, objWithMtl, svg, mergeToIndexed } from './core/exporters.js';
import { buildFeatures, DEFAULT_SETTINGS, pencilAcross } from './core/features.js';
import { renderTextImage, ensureFont, BUNDLED_FONTS, DEFAULT_TEXT } from './core/text.js';
import { MODULES, MIC_PRESETS, CAKE_PRESETS, mergeDeep } from './modules.js';
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
  onPlace: (x, y) => { stopPlacing(); placeRing(x, y); },
  onRingMove: (x, y) => { ringDragPos = [x, y]; },
  onRingDrop: (x, y) => { ringDragPos = null; placeRing(x, y); },
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
  const id = fil === 'ring' ? set.ring.filament : fil === 'pencil' ? set.pencil.filament : fil === 'micBody' ? set.micBody.filament : set.base.filament;
  return S.filaments.some((f) => f.id === id) ? id : (S.filaments.some((f) => f.id === set.base.filament) ? set.base.filament : S.filaments[0]?.id);
};

function getDrawData() {
  if (!S.result) return null;
  const r = feat?.ring;
  return {
    pieces: S.pieces.map((p) => ({ color: filament(p.filament).color, enabled: p.enabled })),
    selection: S.selection,
    hidePieces: !!feat?.hidePieces,
    marks: feat?.magnets || null,
    ring: r && S.settings.ring.enabled ? { ...r, ...(ringDragPos ? { x: ringDragPos[0], y: ringDragPos[1] } : {}) } : null,
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
async function loadImage(dataURL, name, state, { keep = false, source = 'image' } = {}) {
  const el = new Image();
  el.src = dataURL;
  try { await imageReady(el); } catch { toast('No se pudo leer la imagen.', true); return; }
  S.image = { name, dataURL, el };
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
    const res = processImage(getImageData(S.image.el, S.proc.maxRes), S.proc);
    const prevSettings = S.settings;
    S.result = res;
    S.selection.clear();
    setDefaults(res);
    if (keepSettings) {
      const fresh = S.settings;
      S.settings = withDefaults(prevSettings);
      for (const k of ['base', 'ring', 'pencil', 'micBody']) S.settings[k].filament = fresh[k].filament;
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
    rebuildFeatures();
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
function rebuildFeatures() {
  for (const fp of featParts) viewer.setExtra(fp.key, null);
  featParts = [];
  feat = null;
  if (!S.result) { view2d.setUnderlays([]); view2d.setBounds(null); renderWarnings(); return; }
  try {
    feat = buildFeatures(S.result, S.settings, { scale: scale(), center: center(), detail: S.proc.detail, smooth: S.proc.smooth, customBody: customBodyFor(S.settings.micBody) });
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
  for (const k of ['base', 'ring', 'pencil', 'micBody']) if (S.settings[k].filament === id) S.settings[k].filament = fallback;
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
    removeBg: $('procBg').value,
    tolerance: parseInt($('procTol').value),
    maxRes: parseInt($('procRes').value),
  };
}
for (const id of ['procDetail', 'procSmooth', 'procMinArea', 'procTol']) $(id).addEventListener('input', updateOutputs);
for (const id of ['procColors', 'procDetail', 'procSmooth', 'procMinArea', 'procBg', 'procTol', 'procRes', 'procColorsAuto']) {
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
  document.body.classList.toggle('has-micbody', !!S.settings.micBody?.enabled);
  renderStatus();
}

function onSettingChanged(path) {
  if (path === 'ring.pos' && S.settings.ring.pos === 'manual' && S.settings.ring.x == null && feat?.ring) Object.assign(S.settings.ring, { x: feat.ring.x, y: feat.ring.y });
  if (path === 'widthMM' && S.source === 'text' && (S.text.thicken > 0 || S.text.outline)) { applyText(); return; }
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
  $('stSize').textContent = `Tamaño: ${fmt((x1 - x0) * s)} × ${fmt((y1 - y0) * s)} × ${fmt(zMax)} mm`;
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
        saved = await window.api.saveFile({ defaultPath: name + '.3mf', filters: [{ name: '3MF', extensions: ['3mf'] }], data: threeMF(parts, name) });
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
window.api?.listFonts?.().then((list) => {
  systemFonts = list.filter((f) => !BUNDLED_FONTS.some((b) => b.family === f));
  const v = $('txtFont').value;
  $('txtFont').innerHTML = fontOptions(systemFonts);
  $('txtFont').value = S.text.font || v;
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
  setTimeout(() => { view2d.resize(); viewer.resize(); }, 0);
}
$('showAllCards').addEventListener('change', applyModuleUI);

function clearDesign() {
  viewer.clear();
  pieceGeoms.clear();
  featParts = []; feat = null;
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
    for (const k of ['base', 'ring', 'pencil', 'micBody']) S.settings[k].filament = old[k]?.filament ?? old.base.filament;
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
window.__r3d = { S, setSelection, doExport, exportParts, undo, redo, commit, hist, setViewMode, enterModule, applyText, showHome, studio, getFeat: () => feat, onSettingChanged, placeRing, loadImageFile, view2d };

syncProcInputs();
updateUndoButtons();
renderGroups();
renderHome();
syncSettingsInputs();
syncTextInputs();
window.api?.appVersion?.().then((v) => { $('homeVersion').textContent = 'Versión ' + v; }).catch(() => {});
