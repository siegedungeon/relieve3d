// Módulo «Separar colores 3D»: convierte un 3MF multicolor (pintado o por piezas) en piezas de un solo color
// que se imprimen por separado y se pegan: incrustaciones con su caja en el cuerpo + piezas sólidas con asiento.
// El cálculo (manifold WASM) corre en un Worker; la vista previa usa Viewer3D.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { Viewer3D } from './viewer3d.js';
import { read3MF } from './core/threemf_read.js';
import { DEFAULT_SPLIT, analyzeModel } from './core/colorsplit.js';
import { exportFiles, platesFor } from './core/colorsplit_export.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const parseNum = (s) => parseFloat(String(s).trim().replace(',', '.'));
const KIND = { body: 'base', solid: 'sólida', inlay: 'incrustación', cover: 'cover' };
// readable Spanish name for a filament color
export function colorNameEs(hex) {
  const c = new THREE.Color(hex), hsl = {};
  c.getHSL(hsl, THREE.SRGBColorSpace);
  const { h, s, l } = hsl, d = h * 360;
  if (l > 0.88 || (s < 0.12 && l > 0.8)) return 'Blanco';
  if (l < 0.18) return 'Negro';
  if (s < 0.12) return 'Gris';
  if (d < 15 || d >= 345) return l > 0.7 ? 'Rosa' : 'Rojo';
  if (d < 40) return l < 0.35 ? 'Café' : 'Naranja';
  if (d < 70) return 'Amarillo';
  if (d < 170) return 'Verde';
  if (d < 200) return 'Turquesa';
  if (d < 255) return 'Azul';
  if (d < 290) return 'Morado';
  return 'Rosa';
}

const TABS = [['original', 'Original'], ['split', 'Separado'], ['plates', 'Placas de impresión']];

const SETTINGS = [
  ['clearance', 'Holgura de encaje (mm)', 'Espacio total entre cada pieza y su caja. 0.15 = entra a presión suave; súbelo a 0.2 si tu impresora sobre-extruye'],
  ['depth', 'Grosor incrustaciones (mm)', 'Grosor del cascarón de color, medido perpendicular a la superficie. Más grosor = más rígido y más área de pegado'],
  ['maxPocket', 'Caja máx. (mm)', 'Profundidad máxima de las cajas en el cuerpo (los lados inclinados necesitan más para mantener el grosor)'],
  ['minWall', 'Pared mínima (mm)', 'Material que queda bajo cada caja; donde la pared es más delgada la incrustación se adelgaza'],
  ['minSkin', 'Color mínimo (mm)', 'Grosor mínimo del color que se conserva en bordes y pliegues donde no cabe la incrustación completa'],
  ['maxAngle', 'Curvatura por pieza (°)', 'Máxima inclinación de la superficie respecto a la dirección de encaje de una pieza: más = menos piezas, más grandes'],
  ['minTile', 'Pieza mínima (mm²)', 'Evita incrustaciones más pequeñas que esto'],
  ['minFeature', 'Detalle mínimo (mm)', 'Zonas pintadas más delgadas que esto se ignoran (no se pueden imprimir sueltas)'],
];

export class ColorSplitStudio {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.opts = { ...DEFAULT_SPLIT };
    this.bed = { w: 256, h: 256, gap: 3 };
    this.model = null;
    this.res = null;
    this.tab = 'original';
    this.explode = 0;
    this.hidden = new Set();
    this.sel = -1;
    this.plate = 0;
    this.build();
  }

  build() {
    const N = 'inputmode="decimal" type="text"';
    this.root.innerHTML = `
    <header class="topbar">
      <button class="btn" data-a="home">⌂ Inicio</button>
      <div class="brand"><span class="logo">◆</span> Relieve3D <span class="module-name">· 🎨 Separar colores 3D</span></div>
      <div class="tb-group">
        <button class="btn" data-a="open" title="3MF de Bambu Studio / Orca / PrusaSlicer con colores pintados o piezas por color">📂 Abrir 3MF</button>
      </div>
      <div class="spacer"></div>
      <button class="btn primary" data-a="split" data-r="btnSplit" disabled>🧩 Separar</button>
      <button class="btn primary" data-a="export" data-r="btnExport" disabled title="Un 3MF + STL por color (piezas acostadas listas para imprimir), ensamble de referencia, mapa e instrucciones">⬇ Exportar</button>
    </header>
    <main class="layout studio-layout hb-layout cs-layout">
      <aside class="panel left">
        <section class="card">
          <h3>Modelo</h3>
          <div class="muted small" data-r="info">Abre (o arrastra) un <b>.3mf</b> multicolor. Sirve el pintado por colores del slicer y los modelos con una pieza por color.</div>
        </section>
        <section class="card">
          <h3>Colores</h3>
          <div data-r="colors" class="cs-colors"></div>
          <div class="muted small">El color <b>base</b> es el cuerpo; los demás se vuelven piezas que se pegan en él.</div>
        </section>
        <section class="card">
          <h3>Encajes</h3>
          ${SETTINGS.map(([k, l, t]) => `<label class="row" title="${esc(t)}">${l} <input ${N} data-k="${k}" /></label>`).join('')}
          <label class="row" title="Tallado conserva las dimensiones exteriores. Capa exterior crece sobre el original. Esculpido reconstruye una envolvente mayor, suaviza los colores y abre los recorridos de montaje; rechaza los resultados que no puede liberar sin dañar el cuerpo">Modo <select data-k="mode"><option value="carve">Tallado (recomendado)</option><option value="covers">Base + covers pegados</option><option value="inlays">Incrustaciones</option><option value="skin">Capa exterior (experimental)</option><option value="sculpt">Esculpido exterior</option></select></label>
          <label class="row" data-r="carveRow" title="Modo tallado: grosor de la capa de color tallada bajo la superficie. Más grosor = piezas de color más rígidas. Una zona enteramente delgada puede pasar al color base; un borde afinado unido a una zona gruesa conserva su color">Grosor del color tallado (mm) <input ${N} data-k="carveDepth" /></label>
          <label class="row" data-r="skinRow" title="Capa exterior conserva el original como base; Esculpido reconstruye también el núcleo. Ambos crecen por fuera y pueden estrechar agujeros: revisa las medidas funcionales">Grosor capa exterior (mm) <input ${N} data-k="skinDepth" /></label>
          <label class="row" data-r="sculptRow" title="Redibuja y redondea las fronteras de color. Mayor que 0 y hasta 3 mm. Puede cambiar detalles; el montaje se comprueba antes de producir las piezas">Suavizado del esculpido (mm) <input ${N} data-k="skinSmooth" /></label>
          <label class="row" data-r="planeRow" title="Solo en modo incrustaciones: corta el modelo con un plano vertical por la silueta (cuerpo en 2 mitades frente / atrás)">Cortar en mitades frente / atrás <input type="checkbox" data-k="planeCut" /></label>
      <label class="row" title="Número en espejo grabado en la cara oculta (la que se pega) de cada incrustación: coincide con la lista y el mapa de armado">Grabar número bajo cada pieza <input type="checkbox" data-k="labels" /></label>
        </section>
        <section class="card">
          <h3>Impresora</h3>
          <label class="row">Cama ancho (mm) <input ${N} data-b="w" /></label>
          <label class="row">Cama fondo (mm) <input ${N} data-b="h" /></label>
          <label class="row">Separación piezas (mm) <input ${N} data-b="gap" /></label>
        </section>
      </aside>
      <section class="center">
        <div class="hb-tabs seg" data-r="tabs">${TABS.map(([k, l]) => `<button class="seg-btn" data-tab="${k}">${l}</button>`).join('')}
          <span class="spacer"></span>
          <label class="cs-explode" data-r="explodeWrap">Despiece <input type="range" min="0" max="1" step="0.01" value="0" data-r="explode" /></label>
          <select data-r="plateSel" hidden></select>
        </div>
        <div class="views mode-3d"><div class="view dark" data-r="view"></div></div>
        <div class="statusbar"><span data-r="status"></span><span class="spacer"></span><span data-r="time"></span></div>
      </section>
      <aside class="panel right">
        <section class="card">
          <h3>Resultado</h3>
          <div data-r="summary" class="small muted">Sin separar todavía.</div>
          <div class="hb-warn" data-r="warn"></div>
        </section>
        <section class="card grow">
          <h3>Piezas</h3>
          <div class="hb-list small" data-r="list"></div>
        </section>
      </aside>
    </main>
    <input type="file" data-r="file" accept=".3mf" hidden />`;
    this.$ = (n) => this.root.querySelector(`[data-r="${n}"]`);
    this.bind();
  }

  bind() {
    const r = this.root;
    r.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      const tab = e.target.closest('[data-tab]')?.dataset.tab;
      const pc = e.target.closest('[data-pc]')?.dataset.pc;
      if (tab) { this.setTab(tab); return; }
      if (pc != null) { this.select(+pc); return; }
      if (a === 'home') this.cb.onBack();
      else if (a === 'open') this.$('file').click();
      else if (a === 'split') this.split();
      else if (a === 'export') this.export();
    });
    const onInput = (e) => {
      const el = e.target;
      if (el.dataset.k === 'labels') { this.opts.labels = el.checked; this.markStale(); return; }
      if (el.dataset.k === 'planeCut') { this.opts.planeCut = el.checked; this.markStale(); return; }
      if (el.dataset.k === 'mode') { this.opts.mode = el.value; this.syncMode(); this.markStale(); return; }
      if (el.dataset.k) { const v = parseNum(el.value); if (Number.isFinite(v)) { this.opts[el.dataset.k] = v; this.markStale(); } return; }
      if (el.dataset.b) { const v = parseNum(el.value); if (Number.isFinite(v) && v > 0) { this.bed[el.dataset.b] = v; if (this.res) { this.plates = platesFor(this.res, { bedW: this.bed.w, bedH: this.bed.h, gap: this.bed.gap }); this.fillPlates(); if (this.tab === 'plates') this.render(); } } return; }
      const ci = el.dataset.ci;
      if (ci != null) {
        const c = +ci, f = el.dataset.cf;
        if (f === 'name') { this.model.names[c] = el.value || `Color ${c + 1}`; this.renameParts(); this.renderList(); this.fillPlates(); }
        else if (f === 'color') { this.model.palette[c] = el.value.toUpperCase(); this.recolor(); }
        else if (f === 'vis') { if (el.checked) this.hidden.delete(c); else this.hidden.add(c); this.recolor(); }
        else if (f === 'base' && el.checked) { this.opts.baseColor = c; this.markStale(); }
        return;
      }
      if (el.dataset.r === 'explode') { this.explode = +el.value; this.applyExplode(); }
      else if (el.dataset.r === 'plateSel') { this.plate = +el.value; this.render(); }
    };
    r.addEventListener('input', onInput);
    r.addEventListener('change', onInput);
    this.$('file').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await this.loadFile(f); });
  }

  async open() {
    this.root.hidden = false;
    this.sync();
    if (!this.viewer) {
      this.viewer = new Viewer3D(this.$('view'), { onPick: (id) => { if (id != null && this.tab === 'split') this.select(+String(id).replace('p', '')); } });
    }
    this.renderTabs();
    this.viewer.resize();
  }

  sync() {
    for (const el of this.root.querySelectorAll('[data-k]')) { if (el.type === 'checkbox') el.checked = !!this.opts[el.dataset.k]; else el.value = this.opts[el.dataset.k]; }
    this.syncMode();
    for (const el of this.root.querySelectorAll('[data-b]')) el.value = this.bed[el.dataset.b];
  }

  syncMode() {
    this.$('planeRow').hidden = this.opts.mode !== 'inlays';
    this.$('skinRow').hidden = !['skin', 'sculpt'].includes(this.opts.mode);
    this.$('sculptRow').hidden = this.opts.mode !== 'sculpt';
    this.$('carveRow').hidden = this.opts.mode !== 'carve';
  }

  status(msg) { this.$('status').textContent = msg; }

  // ------------------------------------------------------------------ loading
  async loadFile(f) {
    if (!/\.3mf$/i.test(f.name)) { this.cb.toast('Usa un archivo .3mf (STL no guarda colores)', true); return; }
    this.cb.showBusy('Leyendo 3MF…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      this.loadModel(read3MF(new Uint8Array(await f.arrayBuffer())), f.name.replace(/\.3mf$/i, ''));
    } catch (err) {
      this.cb.toast('No se pudo leer el 3MF: ' + err.message, true);
    } finally { this.cb.hideBusy(); }
  }

  loadModel(model, title) {
    this.model = model;
    const seen = {};
    model.names = model.palette.map((hex, i) => {
      if (model.names[i] && !/^(Filamento|Material) /.test(model.names[i])) return model.names[i];
      const b = colorNameEs(hex);
      seen[b] = (seen[b] || 0) + 1;
      return seen[b] > 1 ? `${b} ${seen[b]}` : b;
    });
    this.title = (title || model.title || 'modelo').trim();
    this.res = null;
    this.hidden.clear();
    this.sel = -1;
    const an = analyzeModel(model);
    this.analysis = an;
    this.opts.baseColor = -1;
    let tris = 0;
    const box = new THREE.Box3();
    for (const p of model.parts) {
      tris += p.T.length / 3;
      for (let i = 0; i < p.V.length; i += 3) box.expandByPoint(new THREE.Vector3(p.V[i], p.V[i + 1], p.V[i + 2]));
    }
    this.box = box;
    const sz = box.getSize(new THREE.Vector3());
    this.$('info').innerHTML = `<b>${esc(this.title)}</b><br>${model.parts.length} pieza(s), ${tris.toLocaleString('es')} triángulos<br>${sz.x.toFixed(1)} × ${sz.y.toFixed(1)} × ${sz.z.toFixed(1)} mm`;
    this.renderColors();
    this.$('btnSplit').disabled = model.palette.length < 2;
    this.$('btnExport').disabled = true;
    this.$('summary').textContent = model.palette.length < 2 ? 'El modelo tiene un solo color: no hay nada que separar.' : 'Pulsa «Separar» para generar las piezas.';
    this.$('warn').innerHTML = '';
    this.$('list').innerHTML = '';
    this.setTab('original');
    this.viewer.frame();
    this.status(`${model.palette.length} colores`);
  }

  renderColors() {
    const m = this.model;
    if (!m) { this.$('colors').innerHTML = ''; return; }
    const an = this.analysis, base = this.opts.baseColor >= 0 ? this.opts.baseColor : an.base;
    const tot = an.colorArea.reduce((a, b) => a + b, 0) || 1;
    this.$('colors').innerHTML = m.palette.map((c, i) => `
      <div class="cs-color">
        <input type="checkbox" data-ci="${i}" data-cf="vis" ${this.hidden.has(i) ? '' : 'checked'} title="Mostrar / ocultar" />
        <input type="color" data-ci="${i}" data-cf="color" value="${c.toLowerCase()}" />
        <input type="text" class="cs-name" data-ci="${i}" data-cf="name" value="${esc(m.names[i])}" />
        <span class="muted">${Math.round(an.colorArea[i] / tot * 100)}%</span>
        <label title="Color base (cuerpo)"><input type="radio" name="csBase" data-ci="${i}" data-cf="base" ${i === base ? 'checked' : ''} /> base</label>
      </div>`).join('');
  }

  markStale() {
    if (!this.res) return;
    this.res = null;
    this.$('btnExport').disabled = true;
    this.$('summary').textContent = 'Ajustes cambiados: pulsa «Separar» otra vez.';
    this.$('list').innerHTML = '';
    this.$('warn').innerHTML = '';
    if (this.tab !== 'original') this.setTab('original');
  }

  // ------------------------------------------------------------------ split (worker)
  worker() {
    if (!this._worker) {
      this._worker = new Worker(new URL('./colorsplit_worker.js', import.meta.url), { type: 'module' });
      this._jobs = new Map();
      this._worker.onmessage = (e) => {
        const { id, progress, result, error, fatal } = e.data;
        const job = this._jobs.get(id);
        if (!job) return;
        if (progress) { job.onProgress(progress); return; }
        this._jobs.delete(id);
        if (error) job.reject(Object.assign(new Error(error), { fatal })); else job.resolve(result);
      };
      this._worker.onerror = (e) => {
        for (const j of this._jobs.values()) j.reject(new Error(e.message || 'error en el worker'));
        this._jobs.clear();
        this._worker = null;
      };
    }
    return this._worker;
  }

  runSplit(onProgress) {
    const w = this.worker();
    const id = (this._jobId = (this._jobId || 0) + 1);
    const model = { palette: this.model.palette, names: this.model.names, parts: this.model.parts.map((p) => ({ name: p.name, V: p.V, T: p.T, tc: p.tc })) };
    return new Promise((resolve, reject) => {
      this._jobs.set(id, { resolve, reject, onProgress });
      w.postMessage({ id, model, options: { ...this.opts, plate: this.bed.w, gap: this.bed.gap } });
    });
  }

  async split() {
    if (!this.model || this._busy) return;
    this._busy = true;
    const t0 = performance.now();
    this.$('btnSplit').disabled = true;
    this.cb.showBusy('Separando colores…');
    try {
      const res = await this.runSplit(({ msg, frac }) => { this.cb.showBusy(`${msg}… ${Math.round((frac || 0) * 100)}%`); this.status(msg); });
      this.res = res;
      this.renameParts();
      this.plates = platesFor(res, { bedW: this.bed.w, bedH: this.bed.h, gap: this.bed.gap });
      this.plate = 0;
      this.fillPlates();
      this.renderResult();
      this.$('btnExport').disabled = !!res.previewOnly;
      this.$('explode').value = this.explode = 0.35;
      this.setTab('split');
      this.viewer.frame();
      const secs = (performance.now() - t0) / 1000;
      this.$('time').textContent = `${secs.toFixed(1)} s`;
      this.status(res.previewOnly ? 'Vista previa experimental: no está lista para imprimir' : `${res.parts.length} piezas listas`);
      return res;
    } catch (err) {
      console.error(err);
      // the engine itself failed (out of memory, abort): the worker starts a fresh one for the next run
      const msg = err.fatal ? `el motor 3D falló con este modelo en este modo (${err.message.split('.')[0]}). Prueba otro modo: «Tallado» es el recomendado` : err.message;
      this.cb.toast('Error al separar: ' + msg, true);
      this.status('Error: ' + msg);
      return null;
    } finally {
      this.cb.hideBusy();
      this._busy = false;
      this.$('btnSplit').disabled = false;
    }
  }

  // global numbers (shown in the viewer map, list and file names)
  renameParts() {
    if (!this.res) return;
    this.res.names = this.model.names;
    this.res.palette = this.model.palette;
    const counters = {};
    this.res.parts.forEach((p, i) => {
      counters[p.color] = (counters[p.color] || 0) + 1;
      p.num = i + 1;
      p.name = `${String(i + 1).padStart(2, '0')} ${this.model.names[p.color]}${p.kind === 'body' ? ' cuerpo' + (p.half === 0 ? ' frente' : p.half === 1 ? ' atrás' : '') : p.kind === 'solid' ? ' pieza' : p.kind === 'cover' ? ' cover' : ''}`;
    });
  }

  renderResult() {
    const res = this.res, names = this.model.names;
    const by = {};
    for (const p of res.parts) { const k = p.color; (by[k] ||= { body: 0, solid: 0, inlay: 0, cover: 0 })[p.kind]++; }
    const lines = Object.entries(by).map(([c, n]) => {
      const parts = [n.body && `${n.body} cuerpo`, n.solid && `${n.solid} sólida(s)`, n.inlay && `${n.inlay} incrustaciones`, n.cover && `${n.cover} covers`].filter(Boolean).join(', ');
      return `<div class="cs-sum"><span class="cs-sw" style="background:${res.palette[c]}"></span><b>${esc(names[c])}</b>: ${parts}</div>`;
    });
    const nPlates = this.plates.length;
    const baseInfo = `base: ${res.parts.filter((p) => p.kind === 'body').length} pieza(s)`;
    const headline = res.previewOnly ? `<div class="hb-w">Vista previa: ${res.parts.length} piezas. Montaje pendiente; exportación desactivada.</div>` : `<div class="hb-ok">✓ ${res.parts.length} piezas, ${nPlates} placa(s) de impresión</div>`;
    this.$('summary').innerHTML = `${headline}${lines.join('')}<div class="muted small" style="margin-top:6px">Holgura ${this.opts.clearance} mm · ${res.sculpt ? `${baseInfo}; núcleo y envolvente reconstruidos, fronteras de color suavizadas ${this.opts.skinSmooth} mm. Crece aproximadamente ${this.opts.skinDepth} mm por lado y puede estrechar agujeros. ${res.assemblyChecked ? 'Montaje por traslación comprobado: sigue el orden de la lista y el recorrido inverso de Despiece. Imprime con soportes bajo la cara oculta.' : 'Montaje pendiente: no imprimir.'}` : res.skin ? `modelo original entero como base; capas de color de ${this.opts.skinDepth} mm que se pegan por fuera (el modelo crece ${this.opts.skinDepth} mm por lado) ` : res.carve ? `${baseInfo}; colores tallados ${this.opts.carveDepth} mm bajo la superficie, sin agrandar la figura. Revisa los avisos de montaje y los bordes finos en el laminador (cara de color arriba y soportes debajo)` : res.covers ? `${baseInfo}; covers de hasta ${this.opts.depth} mm que se pegan en sus rebajes (imprimir con la cara de color arriba y soportes debajo)` : `cascarones de color de ${this.opts.depth} mm `}${res.covers ? '' : res.cut ? '(las mitades del cuerpo y las piezas de color se imprimen apoyadas en la cara plana del corte: sin soportes)' : '(imprimir con la cara de color arriba y soportes bajo la cara oculta)'}</div>`;
    this.$('warn').innerHTML = res.warnings.map((w) => `<div class="hb-w">⚠ ${esc(w)}</div>`).join('');
    this.renderList();
  }

  renderList() {
    if (!this.res) return;
    const pal = this.res.palette;
    this.$('list').innerHTML = this.res.parts.map((p, i) => `<div class="hb-pc cs-pc${i === this.sel ? ' sel' : ''}" data-pc="${i}"><span><span class="cs-sw" style="background:${pal[p.color]}"></span>${esc(p.name)}</span><span class="muted">${KIND[p.kind]} · ${p.print.size.map((x) => x.toFixed(0)).join('×')}</span></div>`).join('');
  }

  fillPlates() {
    const sel = this.$('plateSel');
    if (!this.plates) { sel.innerHTML = ''; return; }
    const multi = {};
    for (const pl of this.plates) multi[pl.color] = (multi[pl.color] || 0) + 1;
    sel.innerHTML = this.plates.map((pl, i) => `<option value="${i}">${esc(this.model.names[pl.color])}${multi[pl.color] > 1 ? ` — placa ${pl.plate + 1}` : ''} (${pl.items.length})</option>`).join('');
    if (this.plate >= this.plates.length) this.plate = 0;
    sel.value = String(this.plate);
  }

  select(i) {
    this.sel = this.sel === i ? -1 : i;
    this.recolor();
    for (const el of this.$('list').querySelectorAll('[data-pc]')) el.classList.toggle('sel', +el.dataset.pc === this.sel);
    this.$('list').querySelector(`[data-pc="${this.sel}"]`)?.scrollIntoView({ block: 'nearest' });
    if (this.sel >= 0) { const p = this.res.parts[this.sel]; this.status(`${p.name} — ${KIND[p.kind]}, ${p.print.size.map((x) => x.toFixed(1)).join(' × ')} mm, ${p.volume.toFixed(0)} mm³`); }
  }

  // ------------------------------------------------------------------ viewer
  setTab(t) {
    if (t !== 'original' && !this.res) t = 'original';
    this.tab = t;
    this.renderTabs();
    this.render();
  }

  renderTabs() {
    for (const b of this.root.querySelectorAll('[data-tab]')) { b.classList.toggle('active', b.dataset.tab === this.tab); b.disabled = b.dataset.tab !== 'original' && !this.res; }
    this.$('explodeWrap').hidden = this.tab !== 'split';
    this.$('plateSel').hidden = this.tab !== 'plates';
  }

  geom(V, T) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(V instanceof Float32Array ? V : new Float32Array(V), 3));
    g.setIndex(new THREE.BufferAttribute(T instanceof Uint32Array ? T : new Uint32Array(T), 1));
    return toCreasedNormals(g, Math.PI / 6);
  }

  render() {
    const v = this.viewer;
    if (!v) return;
    v.clear();
    v.model.position.set(0, 0, 0);
    if (!this.model) return;
    if (this.tab === 'original') {
      this.model.parts.forEach((p, k) => {
        const nT = p.T.length / 3, pos = new Float32Array(nT * 9), col = new Float32Array(nT * 9);
        const cols = this.model.palette.map((h) => new THREE.Color(h));
        for (let t = 0; t < nT; t++) {
          const c = cols[p.tc[t]] || cols[0];
          for (let j = 0; j < 3; j++) {
            const vi = p.T[t * 3 + j] * 3;
            pos.set([p.V[vi], p.V[vi + 1], p.V[vi + 2]], t * 9 + j * 3);
            col.set([c.r, c.g, c.b], t * 9 + j * 3);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.computeVertexNormals();
        const m = v.addPiece('o' + k, g);
        m.material.vertexColors = true;
        v.updatePiece('o' + k, { color: '#ffffff', height: 1, z: 0, visible: true });
      });
      this.center();
    } else if (this.tab === 'split') {
      const c = this.box.getCenter(new THREE.Vector3());
      this.res.parts.forEach((p, i) => {
        const g = this.geom(p.mesh.V, p.mesh.T);
        g.computeBoundingSphere();
        v.addPiece('p' + i, g);
        p._dir = this.explodeDir(p, g.boundingSphere.center, c);
      });
      this.recolor();
      this.center();
      this.applyExplode();
    } else if (this.tab === 'plates') {
      const pl = this.plates[this.plate];
      if (!pl) return;
      pl.objects.forEach((o, i) => {
        v.addPiece('q' + i, this.geom(o.V, o.T));
        v.updatePiece('q' + i, { color: this.model.palette[pl.color], height: 1, z: 0, visible: true });
      });
      const bed = new THREE.BufferGeometry();
      const { w, h } = this.bed;
      bed.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.3, w, 0, -0.3, w, h, -0.3, 0, h, -0.3]), 3));
      bed.setIndex([0, 1, 2, 0, 2, 3]);
      bed.computeVertexNormals();
      v.setExtra('bed', bed, { color: '#4b5563' });
      v.model.position.set(-w / 2, -h / 2, 0);
      v.grid.visible = false;
      v.frame(true);
      this.status(`${this.model.names[pl.color]}: ${pl.items.length} pieza(s) en ${w}×${h} mm${pl.items.some((x) => !x.fits) ? ' — ⚠ alguna pieza no cabe en la cama' : ''}`);
      return;
    }
    v.grid.visible = true;
    v.requestRender();
  }

  center() {
    const c = this.box.getCenter(new THREE.Vector3());
    this.viewer.model.position.set(-c.x, -c.y, -this.box.min.z);
  }

  explodeDir(p, centroid, c) {
    if (p.kind === 'body') return p.n ? p.n.map((x) => x * 0.5) : [0, 0, 0];
    if ((p.kind === 'inlay' || p.kind === 'cover') && p.n) return p.n;
    const d = [centroid.x - c.x, centroid.y - c.y, centroid.z - c.z];
    const l = Math.hypot(...d) || 1;
    return d.map((x) => x / l);
  }

  applyExplode() {
    if (this.tab !== 'split' || !this.res) return;
    const size = this.box.getSize(new THREE.Vector3());
    const k = this.explode * Math.max(size.x, size.y, size.z) * 0.35;
    this.res.parts.forEach((p, i) => {
      const m = this.viewer.meshes.get('p' + i);
      if (!m) return;
      const s = p.kind === 'solid' ? 1.6 : 1;
      m.position.set(p._dir[0] * k * s, p._dir[1] * k * s, p._dir[2] * k * s);
    });
    this.viewer.requestRender();
  }

  recolor() {
    const v = this.viewer;
    if (!v || !this.model) return;
    if (this.tab === 'split' && this.res) {
      this.res.parts.forEach((p, i) => {
        const m = v.meshes.get('p' + i);
        if (!m) return;
        const pos = m.position.clone();
        v.updatePiece('p' + i, { color: this.model.palette[p.color], height: 1, z: 0, visible: !this.hidden.has(p.color), selected: i === this.sel });
        m.position.copy(pos);
      });
    } else if (this.tab === 'original') this.render();
    v.requestRender();
  }

  // ------------------------------------------------------------------ assembly map (PNG)
  mapImage(W = 1100, H = 850) {
    const v = this.viewer;
    const prevTab = this.tab, prevExp = this.explode, prevSel = this.sel;
    this.sel = -1;
    if (this.tab !== 'split') this.setTab('split');
    this.explode = 0.25;
    this.applyExplode();
    this.recolor();
    const out = document.createElement('canvas');
    out.width = W * 2; out.height = H + 70;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.fillStyle = '#111'; ctx.font = 'bold 28px Segoe UI, Arial';
    ctx.fillText(`${this.title} — mapa de armado (${this.res.parts.length} piezas)`, 20, 44);
    const old = { size: v.renderer.getSize(new THREE.Vector2()), aspect: v.camera.aspect, pos: v.camera.position.clone(), target: v.controls.target.clone(), bg: v.scene.background, grid: v.grid.visible };
    v.renderer.setSize(W, H, false);
    v.camera.aspect = W / H;
    v.scene.background = new THREE.Color(0xf3f4f6);
    v.grid.visible = false;
    v.frame();
    const tgt = v.controls.target.clone(), dist = v.camera.position.distanceTo(tgt) * 0.95;
    [['Frente', 1], ['Atrás', -1]].forEach(([label, s], vi) => {
      v.camera.position.set(tgt.x + dist * 0.25 * s, tgt.y + dist * 0.35, tgt.z + dist * 0.9 * s);
      v.camera.lookAt(tgt);
      v.camera.updateProjectionMatrix();
      v.scene.updateMatrixWorld(true);
      v.renderer.render(v.scene, v.camera);
      ctx.drawImage(v.renderer.domElement, vi * W, 70, W, H);
      ctx.fillStyle = '#374151'; ctx.font = 'bold 22px Segoe UI, Arial';
      ctx.fillText(label, vi * W + 16, 100);
      const ray = new THREE.Raycaster();
      const meshes = [...v.meshes.values()].filter((m) => m.visible);
      this.res.parts.forEach((p, i) => {
        const m = v.meshes.get('p' + i);
        if (!m || !m.visible) return;
        const wc = m.geometry.boundingSphere.center.clone().applyMatrix4(m.matrixWorld);
        // only label parts that are visible from this side
        ray.set(v.camera.position, wc.clone().sub(v.camera.position).normalize());
        const hit = ray.intersectObjects(meshes, false)[0];
        if (p.kind !== 'body' && (!hit || hit.object !== m)) return;
        const sp = wc.clone().project(v.camera);
        const x = vi * W + (sp.x + 1) / 2 * W, y = 70 + (1 - sp.y) / 2 * H;
        const txt = String(p.num);
        ctx.font = 'bold 15px Segoe UI, Arial';
        const tw = ctx.measureText(txt).width + 8;
        ctx.fillStyle = 'rgba(17,24,39,.85)';
        ctx.beginPath(); ctx.roundRect(x - tw / 2, y - 10, tw, 20, 6); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(txt, x, y + 1);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      });
    });
    v.scene.background = old.bg;
    v.grid.visible = old.grid;
    v.renderer.setSize(old.size.x, old.size.y, false);
    v.camera.aspect = old.aspect;
    v.camera.position.copy(old.pos);
    v.controls.target.copy(old.target);
    v.camera.updateProjectionMatrix();
    v.controls.update();
    this.sel = prevSel;
    this.explode = prevExp;
    if (prevTab !== 'split') this.setTab(prevTab); else { this.applyExplode(); this.recolor(); }
    const bin = atob(out.toDataURL('image/png').split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async export() {
    if (!this.res) { this.cb.toast('Primero pulsa «Separar»', true); return null; }
    if (this.res.previewOnly) { this.cb.toast('El esculpido es solo una vista previa; el montaje aún no está resuelto', true); return null; }
    this.cb.showBusy('Preparando archivos…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const { files } = exportFiles(this.res, { bedW: this.bed.w, bedH: this.bed.h, gap: this.bed.gap, clearance: this.opts.clearance, title: this.title });
      files.push({ name: `${this.title} - mapa de armado.png`.replace(/[\\/:*?"<>|]+/g, '-'), data: this.mapImage() });
      this.cb.hideBusy();
      const dir = await window.api.saveFilesToFolder({ files });
      if (dir) this.cb.toast(`✓ ${files.length} archivos guardados en ${dir}`);
      return dir;
    } catch (err) {
      console.error(err);
      this.cb.toast('Error al exportar: ' + err.message, true);
      return null;
    } finally { this.cb.hideBusy(); }
  }
}
