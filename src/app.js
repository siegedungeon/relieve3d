import { processImage, computeSilhouette, DEFAULT_PROC } from './core/processing.js';
import { shapesToGeometry, ringGeometry, toWorld } from './core/geometry.js';
import { stlBinary, threeMF, objWithMtl, svg, mergeToIndexed } from './core/exporters.js';
import { Viewer3D } from './viewer3d.js';
import { View2D, isTyping } from './view2d.js';

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
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const textOn = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150 ? '#1f2430' : '#ffffff';
};

const DEFAULT_SETTINGS = () => ({
  widthMM: 60,
  base: { enabled: false, margin: 2, thickness: 1.2, filament: null },
  ring: { enabled: false, x: null, y: null, outer: 8, inner: 4, thickness: 2, filament: null },
});

const S = {
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
let baseShapes = null;

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
  onPlace: (x, y) => {
    Object.assign(S.settings.ring, { x, y, enabled: true });
    stopPlacing();
    rebuildRing();
    syncSettingsInputs();
    refresh();
    commit();
  },
});

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
const baseZ = () => (S.settings.base.enabled ? S.settings.base.thickness : 0);

function getDrawData() {
  if (!S.result) return null;
  const s = scale(), set = S.settings;
  return {
    pieces: S.pieces.map((p) => ({ color: filament(p.filament).color, enabled: p.enabled })),
    selection: S.selection,
    base: set.base.enabled ? { color: filament(set.base.filament).color } : null,
    ring: set.ring.enabled && set.ring.x != null ? {
      x: set.ring.x, y: set.ring.y, ro: set.ring.outer / 2 / s, ri: set.ring.inner / 2 / s,
      color: filament(set.ring.filament).color,
    } : null,
  };
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
  if (/\.(r3d|json)$/i.test(file.name)) return openProjectFile(file);
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
  await loadImage(dataURL, file.name, null);
}

async function loadImage(dataURL, name, state) {
  const el = new Image();
  el.src = dataURL;
  try { await el.decode(); } catch { toast('No se pudo leer la imagen.', true); return; }
  S.image = { name, dataURL, el };
  $('docName').textContent = '· ' + name;
  $('dropZone').classList.add('hidden');
  hist.stack = []; hist.idx = -1;
  if (!state) { S.settings = DEFAULT_SETTINGS(); S.groups = []; }
  await runProcessing(state);
  syncProcInputs();
  syncSettingsInputs();
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
      S.settings = {
        widthMM: prevSettings.widthMM,
        base: { ...prevSettings.base, filament: S.settings.base.filament },
        ring: { ...prevSettings.ring, filament: S.settings.ring.filament },
      };
    }
    if (state && state.pieces?.length === res.pieces.length) applyEditable(state);
    else if (state) { S.settings = { ...DEFAULT_SETTINGS(), ...state.settings }; }

    viewer.clear();
    pieceGeoms.clear();
    const [cx, cy] = center();
    for (const p of res.pieces) {
      const g = shapesToGeometry(p.shapes, cx, cy);
      if (g) { pieceGeoms.set(p.id, g); viewer.addPiece(p.id, g); }
    }
    view2d.setContent(res, S.image.el);
    rebuildBase();
    rebuildRing();
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
  const fid = S.clusterFilament[outer.cluster];
  S.settings.base.filament = fid;
  S.settings.ring.filament = fid;
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
      visible: st.enabled,
      selected: S.selection.has(p.id),
    });
  }
  const set = S.settings;
  viewer.updateExtra('base', { color: filament(set.base.filament).color, height: set.base.thickness, z: 0 });
  viewer.updateExtra('ring', { color: filament(set.ring.filament).color, height: set.ring.thickness, z: 0 });
  viewer.requestRender();
}

function rebuildBase() {
  const b = S.settings.base;
  if (!S.result || !b.enabled) {
    baseShapes = null;
    view2d.setBaseShapes(null);
    viewer.setExtra('base', null);
    return;
  }
  baseShapes = computeSilhouette(S.result, b.margin / scale(), S.proc.detail, S.proc.smooth);
  view2d.setBaseShapes(baseShapes);
  const [cx, cy] = center();
  viewer.setExtra('base', shapesToGeometry(baseShapes, cx, cy), { color: filament(b.filament).color, height: b.thickness, z: 0 });
}

function rebuildRing() {
  const r = S.settings.ring;
  if (!S.result || !r.enabled) { viewer.setExtra('ring', null); return; }
  const s = scale();
  if (r.x == null) {
    const bb = S.result.fgBBox;
    r.x = bb[0];
    r.y = bb[1] + (bb[3] - bb[1]) * 0.3;
  }
  const [cx, cy] = center();
  viewer.setExtra('ring', ringGeometry(r.x, r.y, r.outer / 2 / s, Math.min(r.inner, r.outer - 0.4) / 2 / s, cx, cy),
    { color: filament(r.filament).color, height: r.thickness, z: 0 });
}

let baseTimer;
function rebuildBaseDebounced() {
  clearTimeout(baseTimer);
  baseTimer = setTimeout(() => { rebuildBase(); sync3D(); view2d.draw(); }, 150);
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
    groups: S.groups, settings: S.settings,
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
  S.settings = { ...DEFAULT_SETTINGS(), ...JSON.parse(JSON.stringify(s.settings)) };
  nextId = Math.max(0, ...S.filaments.map((f) => f.id), ...S.groups.map((g) => g.id)) + 1;
  S.selection = new Set([...S.selection].filter((id) => id < S.pieces.length));
}
async function restore(json) {
  const s = JSON.parse(json);
  if (JSON.stringify(s.proc) !== JSON.stringify(S.proc)) {
    S.proc = { ...s.proc };
    syncProcInputs();
    await runProcessing(s);
  } else {
    const oldBase = JSON.stringify([S.settings.base.enabled, S.settings.base.margin, S.settings.widthMM]);
    applyEditable(s);
    if (oldBase !== JSON.stringify([S.settings.base.enabled, S.settings.base.margin, S.settings.widthMM])) rebuildBase();
    rebuildRing();
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
  for (const id of ['baseFilament', 'ringFilament']) $(id).innerHTML = opts;
  $('baseFilament').value = S.settings.base.filament ?? '';
  $('ringFilament').value = S.settings.ring.filament ?? '';
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
  for (const k of ['base', 'ring']) if (S.settings[k].filament === id) S.settings[k].filament = fallback;
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

function syncSettingsInputs() {
  const s = S.settings;
  $('setWidth').value = fmt(s.widthMM);
  $('baseEnabled').checked = s.base.enabled;
  $('baseMargin').value = s.base.margin;
  $('baseThickness').value = s.base.thickness;
  $('ringEnabled').checked = s.ring.enabled;
  $('ringOuter').value = s.ring.outer;
  $('ringInner').value = s.ring.inner;
  $('ringThickness').value = s.ring.thickness;
  renderFilaments();
  renderStatus();
}
const num = (id, min = 0) => Math.max(min, parseFloat($(id).value) || 0);
$('setWidth').addEventListener('change', () => {
  S.settings.widthMM = num('setWidth', 5);
  rebuildBase(); rebuildRing(); refresh(); viewer.frame(); commit();
});
$('baseEnabled').addEventListener('change', (e) => { S.settings.base.enabled = e.target.checked; rebuildBase(); refresh(); commit(); });
$('baseMargin').addEventListener('input', () => { S.settings.base.margin = num('baseMargin'); if (S.settings.base.enabled) rebuildBaseDebounced(); });
$('baseMargin').addEventListener('change', () => { S.settings.base.margin = num('baseMargin'); rebuildBase(); refresh(); commit(); });
$('baseThickness').addEventListener('input', () => { S.settings.base.thickness = num('baseThickness', 0.1); sync3D(); });
$('baseThickness').addEventListener('change', () => { refresh(); commit(); });
$('baseFilament').addEventListener('change', (e) => { S.settings.base.filament = Number(e.target.value); refresh(); commit(); });
$('ringEnabled').addEventListener('change', (e) => { S.settings.ring.enabled = e.target.checked; rebuildRing(); refresh(); commit(); });
for (const [id, k] of [['ringOuter', 'outer'], ['ringInner', 'inner'], ['ringThickness', 'thickness']]) {
  $(id).addEventListener('change', () => { S.settings.ring[k] = num(id, k === 'inner' ? 0 : 0.2); rebuildRing(); refresh(); commit(); });
}
$('ringFilament').addEventListener('change', (e) => { S.settings.ring.filament = Number(e.target.value); refresh(); commit(); });
$('btnPlaceRing').onclick = () => {
  if (!S.result) return;
  view2d.placing = true;
  $('placeHint').hidden = false;
  if (S.tab && $('views').classList.contains('mode-3d')) setViewMode('split');
};
function stopPlacing() { view2d.placing = false; $('placeHint').hidden = true; }

// ---------------------------------------------------------------- status
function modelBounds() {
  const s = scale();
  let [x0, y0, x1, y1] = S.result.fgBBox;
  const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  if (baseShapes) for (const sh of baseShapes) for (const p of sh.outer) grow(p[0], p[1]);
  const r = S.settings.ring;
  if (r.enabled && r.x != null) { const ro = r.outer / 2 / s; grow(r.x - ro, r.y - ro); grow(r.x + ro, r.y + ro); }
  return [x0, y0, x1, y1];
}
function renderStatus() {
  if (!S.result) return;
  const s = scale();
  const [x0, y0, x1, y1] = modelBounds();
  const zMax = Math.max(0, ...S.pieces.filter((p) => p.enabled).map((p) => p.height + p.elevation)) + baseZ();
  $('stPieces').textContent = `${S.result.pieces.length} piezas · ${S.filaments.length} filamentos`;
  $('stSelection').textContent = S.selection.size ? `${S.selection.size} seleccionadas` : '';
  $('stSize').textContent = `Tamaño: ${fmt((x1 - x0) * s)} × ${fmt((y1 - y0) * s)} × ${fmt(zMax)} mm`;
  const fb = S.result.fgBBox;
  $('setHeightOut').textContent = fmt((fb[3] - fb[1]) * s);
}
function renderHover(pid) {
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
    if (j.app !== 'Relieve3D') throw new Error('No es un proyecto de Relieve3D');
    S.proc = { ...DEFAULT_PROC, ...j.state.proc };
    syncProcInputs();
    await loadImage(j.image.dataURL, j.image.name, j.state);
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
  for (const p of S.result.pieces) {
    const st = S.pieces[p.id], g = pieceGeoms.get(p.id);
    if (!st.enabled || !g) continue;
    if (!byFil.has(st.filament)) byFil.set(st.filament, []);
    byFil.get(st.filament).push(toWorld(g, s, st.height, bz + st.elevation));
  }
  const parts = [];
  S.filaments.forEach((f, i) => {
    if (byFil.has(f.id)) parts.push({ name: f.name, color: f.color, filamentIndex: i, filamentId: f.id, geometry: mergeToIndexed(byFil.get(f.id)) });
  });
  const set = S.settings;
  if (set.base.enabled) {
    const g = viewerExtraGeometry('base');
    if (g) parts.push({ name: 'Base', color: filament(set.base.filament).color, filamentIndex: filamentIndex(set.base.filament), filamentId: set.base.filament, geometry: toWorld(g, s, set.base.thickness, 0) });
  }
  if (set.ring.enabled) {
    const g = viewerExtraGeometry('ring');
    if (g) parts.push({ name: 'Argolla', color: filament(set.ring.filament).color, filamentIndex: filamentIndex(set.ring.filament), filamentId: set.ring.filament, geometry: toWorld(g, s, set.ring.thickness, 0) });
  }
  return parts;
}
const viewerExtraGeometry = (name) => viewer.extras.get(name)?.geometry;

async function doExport(kind) {
  if (!S.result) { toast('Primero carga una imagen.'); return; }
  showBusy('Generando archivo…');
  await nextFrame();
  try {
    const name = baseName();
    let saved = null;
    if (kind === 'svg') {
      const layers = [];
      const set = S.settings, s = scale();
      if (set.base.enabled && baseShapes) layers.push({ name: 'Base', color: filament(set.base.filament).color, items: [baseShapes] });
      for (const f of S.filaments) {
        const items = S.result.pieces.filter((p) => S.pieces[p.id].enabled && S.pieces[p.id].filament === f.id).map((p) => p.shapes);
        if (items.length) layers.push({ name: f.name, color: f.color, items });
      }
      if (set.ring.enabled) layers.push({ name: 'Argolla', color: filament(set.ring.filament).color, items: [{ ring: { x: set.ring.x, y: set.ring.y, ro: set.ring.outer / 2 / s, ri: set.ring.inner / 2 / s } }] });
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
document.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) { dz.classList.remove('drag'); if (S.image) dz.classList.add('hidden'); } });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dz.classList.remove('drag');
  if (S.image) dz.classList.add('hidden');
  const f = e.dataTransfer.files[0];
  if (f) loadImageFile(f);
});

// keyboard
window.addEventListener('keydown', (e) => {
  if (isTyping(e)) return;
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
window.__r3d = { S, setSelection, doExport, exportParts, undo, redo, commit, hist, setViewMode };

syncProcInputs();
updateUndoButtons();
renderGroups();
