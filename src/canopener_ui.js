import * as THREE from 'three';
import { parse as parseFont } from 'opentype.js';
import { Viewer3D } from './viewer3d.js';
import { imageDataFrom, isImageFile, readDataURL } from './phonestand_ui.js';
import { PHONESTAND_FONTS } from './core/phonestand.js';
import {
  CAN_OPENER_SHAPES, DEFAULT_CAN_OPENER, prepareCanOpener, buildCanOpener, exportCanOpener,
  canOpenerProject, readCanOpenerProject,
} from './core/canopener.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
const fileBase = (s) => String(s || 'destapador').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/, '').trim() || 'destapador';
const get = (o, k) => k.split('.').reduce((a, p) => a?.[p], o);
const set = (o, k, v) => { const p = k.split('.'), last = p.pop(); p.reduce((a, x) => (a[x] ??= {}), o)[last] = v; };
const PRESETS = {
  small: { kind: 'round', diameter: 4.5, slotWidth: 8 },
  large: { kind: 'round', diameter: 7, slotWidth: 8 },
  cord: { kind: 'lateral', diameter: 3.2, slotWidth: 8 },
  ribbon: { kind: 'slot', diameter: 3.2, slotWidth: 10 },
  double: { kind: 'double-horizontal', diameter: 3.2, slotWidth: 8 },
};

export class CanOpenerStudio {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.cfg = DEFAULT_CAN_OPENER();
    this.logoSrc = this.logoImg = this.shapeSrc = this.shapeImg = null;
    this.logoName = this.shapeName = '';
    this.res = null;
    this.stale = true;
    this.seq = 0;
    this.fonts = new Map();
    this.build();
  }

  build() {
    const number = (label, key, title = '') => `<label class="row" title="${esc(title)}">${label} <input type="text" inputmode="decimal" data-k="${key}" /></label>`;
    const color = (label, key) => `<label class="row">${label} <input type="color" data-k="${key}" /></label>`;
    const check = (label, key) => `<label class="row">${label} <input type="checkbox" data-k="${key}" /></label>`;
    const select = (label, key, choices, title = '') => `<label class="row" title="${esc(title)}">${label} <select data-k="${key}">${choices.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('')}</select></label>`;
    this.root.innerHTML = `
    <header class="topbar">
      <button class="btn" data-a="home">⌂ Inicio</button>
      <div class="brand"><span class="logo">◆</span> Relieve3D <span class="module-name">· 🥫 Destapador llavero</span></div>
      <button class="btn" data-a="logo">🖼️ Logo</button>
      <button class="btn" data-a="open">📂 Abrir proyecto</button>
      <button class="btn" data-a="save">💾 Guardar proyecto</button>
      <div class="spacer"></div>
      <button class="btn primary" data-a="export" data-r="export" disabled>⬇ Guardar 3MF</button>
    </header>
    <main class="layout studio-layout hb-layout cs-layout">
      <aside class="panel left">
        <section class="card">
          <h3>1. Figura y destapador</h3>
          ${select('Forma', 'shape', CAN_OPENER_SHAPES.map((s) => [s.id, s.name]))}
          <div data-r="custom"><button class="btn wide" data-a="shape">⬆ Cargar silueta (PNG/JPG/SVG)</button><div class="small muted" data-r="shapeInfo"></div></div>
          ${number('Ancho de la figura (mm)', 'width', 'De 40 a 100 mm; los enganches o el borde funcional pueden añadir tamaño.')}
          ${number('Grosor del cuerpo (mm)', 'thickness', 'De 6 a 12 mm. La referencia mide aproximadamente 8 mm.')}
          ${select('Lado de la ranura', 'side', [['right', 'Derecho'], ['left', 'Izquierdo']])}
        </section>
        <section class="card">
          <h3>2. Enganche del llavero</h3>
          ${select('Construcción', 'attachment.mount', [['integrated', 'Agujeros en la figura'], ['external', 'Argolla exterior unida'], ['separate', 'Conector impreso aparte']])}
          <label class="row">Medida orientativa <select data-r="preset"><option value="custom">Personalizada</option><option value="small">Anillo pequeño · agujero Ø4,5</option><option value="large">Anillo grande · agujero Ø7</option><option value="cord">Hilo · Ø3,2 y entrada lateral</option><option value="ribbon">Cinta pequeña · ranura 10 × 3,2</option><option value="double">Dos agujeros · Ø3,2</option></select></label>
          ${select('Perforación', 'attachment.kind', [['round', 'Un agujero redondo'], ['double-horizontal', 'Dos agujeros horizontales'], ['double-vertical', 'Dos agujeros verticales'], ['slot', 'Ranura para cinta'], ['lateral', 'Vertical + entrada lateral']])}
          ${select('Posición en la figura', 'attachment.position', [['left', 'Arriba a la izquierda'], ['center', 'Arriba al centro'], ['right', 'Arriba a la derecha']])}
          ${number('Diámetro / alto del agujero (mm)', 'attachment.diameter', 'De 3 a 9 mm. Para el lateral se conservan al menos 1,5 mm arriba y abajo.')}
          <div data-r="slotSize">${number('Ancho de la ranura de cinta (mm)', 'attachment.slotWidth', 'De 6 a 16 mm; no menor que el alto.')}</div>
          ${number('Pared alrededor (mm)', 'attachment.wall', 'Mínimo 2,5 mm de material alrededor de los agujeros.')}
          <div class="small muted">La medida es del agujero, no del diámetro exterior del anillo. El conector aparte necesita una argolla o hilo adicional para unirlo al cuerpo.</div>
        </section>
        <section class="card">
          <h3>3. Logo y texto</h3>
          <div class="ps-logo" data-r="logoInfo"></div>
          <button class="btn wide" data-a="logo">⬆ Cargar logo (PNG/JPG/SVG)</button>
          ${check('Poner el logo', 'logo.enabled')}
          ${select('Acabado del logo y texto', 'logo.mode', [['relief', 'En relieve'], ['flat', 'Liso multicolor'], ['engrave', 'Grabado']])}
          ${number('Tamaño del logo (%)', 'logo.size')}
          ${number('Mover logo a la derecha (mm)', 'logo.dx')}
          ${number('Mover logo hacia arriba (mm)', 'logo.dy')}
          <div data-r="height">${number('Alto del relieve (mm)', 'logo.height')}</div>
          <div data-r="flat">${number('Profundidad del color liso (mm)', 'logo.flatDepth')}</div>
          <div data-r="engrave">${number('Profundidad del grabado (mm)', 'logo.depth')}</div>
          ${select('Colores a detectar', 'logo.colors', [['0', 'Automático'], ...[1, 2, 3, 4, 5, 6].map((n) => [String(n), String(n)])])}
          ${number('Trazo mínimo del logo (mm)', 'logo.minLine', '0,5 mm recomendado para boquilla de 0,4 mm.')}
          <div data-r="layers"></div>
          ${check('Añadir texto', 'text.enabled')}
          <label class="row">Texto <input type="text" data-k="text.value" maxlength="40" /></label>
          ${select('Fuente', 'text.font', Object.keys(PHONESTAND_FONTS).map((name) => [name, name]))}
          ${number('Tamaño del texto (%)', 'text.size')}
          ${color('Color del cuerpo', 'colors.body')}
          ${color('Color de acento', 'colors.accent')}
          ${check('Logo y texto a color', 'colors.twoColor')}
          <button class="btn wide primary" data-a="apply">↻ Generar destapador</button>
        </section>
      </aside>
      <section class="center">
        <div class="views mode-3d"><div class="view dark" data-r="view"></div></div>
        <div class="statusbar"><span data-r="status">Preparando el destapador…</span></div>
      </section>
      <aside class="panel right">
        <section class="card">
          <h3>Piezas y medidas</h3>
          <div class="small" data-r="summary"></div>
          <div class="hb-warn" data-r="warn"></div>
          <label class="row">Formato <select data-r="format"><option value="bambu">Bambu A1 instalado</option><option value="standard">3MF estándar</option></select></label>
        </section>
        <section class="card">
          <h3>Antes de imprimir y usar</h3>
          <div class="small muted">Para levantar pestañas de latas, no para perforar ni cortar. La ranura y el agujero lateral crean puentes: revisa el laminado, la abertura y las paredes; el proyecto exporta sin soportes. Prueba el ajuste con la lata y el anillo, cinta o hilo reales. El material, la orientación y la impresora afectan la resistencia; haz una impresión de prueba antes de entregar.</div>
        </section>
      </aside>
    </main>
    <input type="file" data-r="fileLogo" accept="image/*,.svg" hidden />
    <input type="file" data-r="fileShape" accept="image/*,.svg" hidden />
    <input type="file" data-r="fileProject" accept=".r3o,.json" hidden />`;
    this.$ = (name) => this.root.querySelector(`[data-r="${name}"]`);
    this.root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'home') this.cb.onBack();
      else if (a === 'logo') this.$('fileLogo').click();
      else if (a === 'shape') this.$('fileShape').click();
      else if (a === 'clearLogo') this.clearLogo();
      else if (a === 'open') this.$('fileProject').click();
      else if (a === 'save') this.saveProject();
      else if (a === 'apply') this.rebuild();
      else if (a === 'export') this.export();
    });
    const input = (e) => {
      const el = e.target;
      if (el.dataset.lm) { this.layerChanged(el); return; }
      if (!el.dataset.k) return;
      const value = el.type === 'checkbox' ? el.checked : el.getAttribute('inputmode') === 'decimal' || el.dataset.k === 'logo.colors'
        ? (el.value.trim() ? Number(el.value.replace(',', '.')) : NaN) : el.value;
      if (Object.is(get(this.cfg, el.dataset.k), value)) return;
      set(this.cfg, el.dataset.k, value);
      if (el.dataset.k.startsWith('attachment.') && el.dataset.k !== 'attachment.position' && el.dataset.k !== 'attachment.mount') this.$('preset').value = 'custom';
      this.visibility();
      this.invalidate();
      if (el.tagName === 'SELECT' && (el.dataset.k === 'shape' || el.dataset.k.startsWith('attachment.'))) this.scheduleRebuild();
    };
    this.root.addEventListener('input', input);
    this.root.addEventListener('change', input);
    this.$('preset').addEventListener('change', (e) => {
      const preset = PRESETS[e.target.value];
      if (!preset) return;
      Object.assign(this.cfg.attachment, preset);
      this.sync();
      e.target.value = Object.keys(PRESETS).find((key) => PRESETS[key] === preset);
      this.invalidate();
      this.scheduleRebuild();
    });
    this.$('fileLogo').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await this.loadLogo(f); });
    this.$('fileShape').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await this.loadShape(f); });
    this.$('fileProject').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (f) try { await this.openProject(await f.text()); } catch (err) { this.cb.toast('No se pudo abrir el proyecto: ' + err.message, true); }
    });
    this.sync();
  }

  sync() {
    for (const el of this.root.querySelectorAll('[data-k]')) {
      const value = get(this.cfg, el.dataset.k);
      if (el.type === 'checkbox') el.checked = !!value; else el.value = value ?? '';
    }
    this.$('logoInfo').innerHTML = this.logoSrc
      ? `<img src="${esc(this.logoSrc)}" alt="Logo" /><span class="small">${esc(this.logoName || 'Logo')}</span><button class="btn mini" data-a="clearLogo">✕</button>`
      : '<span class="small muted">Sin logo: puedes cargar uno o escribir texto.</span>';
    this.$('shapeInfo').textContent = this.shapeSrc ? this.shapeName || 'Silueta del proyecto' : 'Carga una imagen con una silueta conectada.';
    this.visibility();
    this.renderLayers();
  }

  visibility() {
    this.$('custom').hidden = this.cfg.shape !== 'custom';
    this.$('slotSize').hidden = this.cfg.attachment.kind !== 'slot';
    this.$('height').hidden = this.cfg.logo.mode !== 'relief';
    this.$('flat').hidden = this.cfg.logo.mode !== 'flat';
    this.$('engrave').hidden = this.cfg.logo.mode !== 'engrave';
  }

  scheduleRebuild() {
    clearTimeout(this.rebuildTimer);
    if (this.cfg.shape === 'custom' && !this.shapeImg) return;
    this.rebuildTimer = setTimeout(() => this.rebuild(), 250);
  }

  invalidate() {
    clearTimeout(this.rebuildTimer);
    this.seq++;
    this.stale = true;
    this.$('export').disabled = true;
    this.$('status').textContent = 'Cambios pendientes: pulsa «Generar destapador».';
  }

  renderLayers() {
    const box = this.$('layers'), layers = this.logoImg && this.cfg.logo.enabled ? this.res?.info.logo : null;
    if (!layers?.length) { box.innerHTML = ''; return; }
    const engraved = this.cfg.logo.mode === 'engrave';
    box.innerHTML = `<h4>Colores del logo</h4>` + layers.map((p) => {
      const value = { color: p.color, on: p.on, height: p.height, ...(this.cfg.logo.layers[p.key] || {}) };
      return `<div class="st-pal ps-pal" data-layer="${p.idx}">
        <span class="sw" style="background:${esc(p.hex)}"></span>
        ${engraved ? '' : `<input type="color" data-lm="color" value="${esc(value.color)}" />`}
        <select data-lm="mode"><option value="on"${value.on ? ' selected' : ''}>${engraved ? 'Grabar' : 'Imprimir'}</option><option value="off"${value.on ? '' : ' selected'}>Quitar</option></select>
        ${this.cfg.logo.mode === 'relief' ? `<input type="text" inputmode="decimal" data-lm="height" value="${value.height || ''}" placeholder="${fmt(this.cfg.logo.height)}" title="Altura propia de esta capa en mm; vacío usa la altura general" />` : ''}
      </div>`;
    }).join('');
  }

  layerChanged(el) {
    const p = this.res?.info.logo?.[+el.closest('[data-layer]')?.dataset.layer];
    if (!p) return;
    const layers = this.cfg.logo.layers, value = { color: p.color, on: p.on, height: p.height, ...(layers[p.key] || {}) };
    if (el.dataset.lm === 'color') { value.color = el.value; value.on = true; }
    else if (el.dataset.lm === 'mode') value.on = el.value === 'on';
    else value.height = el.value.trim() ? Number(el.value.replace(',', '.')) : 0;
    layers[p.key] = value;
    this.invalidate();
  }

  async open() {
    this.root.hidden = false;
    if (!this.viewer) this.viewer = new Viewer3D(this.$('view'));
    this.viewer.resize();
    if (!this.res) await this.rebuild();
  }

  close() { clearTimeout(this.rebuildTimer); this.root.hidden = true; }

  async textFont() {
    if (!this.cfg.text.enabled || !String(this.cfg.text.value || '').trim()) return null;
    const family = PHONESTAND_FONTS[this.cfg.text.font] ? this.cfg.text.font : 'Montserrat Black';
    if (!this.fonts.has(family)) this.fonts.set(family, fetch('fonts/' + PHONESTAND_FONTS[family])
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }).then((bytes) => parseFont(bytes)));
    try { return await this.fonts.get(family); } catch { this.fonts.delete(family); return null; }
  }

  async rebuild() {
    clearTimeout(this.rebuildTimer);
    const seq = ++this.seq;
    this.stale = true;
    this.$('export').disabled = true;
    this.cb.showBusy('Generando el destapador…');
    try {
      await prepareCanOpener();
      const font = await this.textFont();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const result = buildCanOpener(this.cfg, { logoImage: this.logoImg, shapeImage: this.shapeImg, font });
      if (seq !== this.seq) { result.parts.forEach((p) => p.geometry.dispose()); return; }
      this.viewer.clear();
      this.res = result;
      this.cfg = result.cfg;
      this.stale = false;
      this.$('export').disabled = false;
      const d = result.info.size, a = result.info.attachment;
      this.$('summary').textContent = `${CAN_OPENER_SHAPES.find((s) => s.id === result.cfg.shape)?.name}: ${fmt(d.w)} × ${fmt(d.l)} × ${fmt(d.h)} mm (cuerpo, sin relieve). Ranura de ${fmt(result.info.opener.len)} mm. Pared del enganche: ${fmt(a.wall)} mm. ${result.parts.some((p) => p.apart) ? 'Conector independiente en la misma placa. ' : ''}${result.colors.length} filamento(s); volumen aproximado ${fmt(result.info.volume)} cm³.`;
      this.$('warn').textContent = result.warnings.join(' ');
      this.$('status').textContent = 'Destapador generado · revisa la vista, el laminado y una impresión de prueba.';
      this.sync();
      this.render();
      this.viewer.frame();
    } catch (err) {
      if (seq !== this.seq) return;
      this.res = null;
      this.viewer?.clear();
      this.$('warn').textContent = err.message;
      this.$('summary').textContent = 'No se exportará hasta que la forma y el enganche sean válidos.';
      this.$('status').textContent = 'Ajusta los valores y vuelve a generar.';
    } finally { this.cb.hideBusy(); }
  }

  render() {
    if (!this.res || !this.viewer) return;
    const box = new THREE.Box3();
    this.res.parts.forEach((p, i) => {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox);
      this.viewer.addPiece(`opener-${i}`, p.geometry);
      this.viewer.updatePiece(`opener-${i}`, { color: p.color, height: 1, z: 0, visible: true });
    });
    const center = box.getCenter(new THREE.Vector3());
    this.viewer.model.position.set(-center.x, -center.y, -box.min.z);
    this.viewer.requestRender();
  }

  async loadImage(file, kind) {
    if (!isImageFile(file)) { this.cb.toast('Abre una imagen PNG, JPG, WebP o SVG.', true); return false; }
    if (file.size > 25 * 1024 * 1024) { this.cb.toast('La imagen supera 25 MB; reduce su tamaño.', true); return false; }
    const seq = ++this.seq;
    this.cb.showBusy('Leyendo la imagen…');
    try {
      const src = await readDataURL(file), image = await imageDataFrom(src, kind === 'logo' ? 1000 : 800);
      if (seq !== this.seq) return false;
      if (kind === 'logo') {
        this.logoSrc = src; this.logoImg = image; this.logoName = file.name;
        Object.assign(this.cfg.logo, { enabled: true, colors: 0, layers: {} });
      } else {
        this.shapeSrc = src; this.shapeImg = image; this.shapeName = file.name; this.cfg.shape = 'custom';
      }
      this.sync();
      this.invalidate();
    } catch (err) { this.cb.toast('No se pudo leer la imagen: ' + err.message, true); return false; }
    finally { this.cb.hideBusy(); }
    await this.rebuild();
    return true;
  }

  loadLogo(file) { return this.loadImage(file, 'logo'); }
  loadShape(file) { return this.loadImage(file, 'shape'); }
  clearLogo() { this.logoSrc = this.logoImg = null; this.logoName = ''; this.sync(); this.invalidate(); }

  async saveProject() {
    try {
      const data = canOpenerProject(this.cfg, { logoSrc: this.logoSrc, shapeSrc: this.shapeSrc });
      const path = await window.api.saveFile({ defaultPath: fileBase(this.cfg.name) + '.r3o', filters: [{ name: 'Proyecto destapador', extensions: ['r3o'] }], data });
      if (path) this.cb.toast('✓ Proyecto guardado.');
      return path;
    } catch (err) { this.cb.toast('No se pudo guardar el proyecto: ' + err.message, true); return null; }
  }

  async openProject(text) {
    const p = readCanOpenerProject(text);
    const [logo, shape] = await Promise.all([p.logoSrc ? imageDataFrom(p.logoSrc, 1000) : null, p.shapeSrc ? imageDataFrom(p.shapeSrc, 800) : null]);
    this.cfg = p.cfg; this.logoSrc = p.logoSrc; this.logoImg = logo; this.logoName = p.logoSrc ? 'Logo del proyecto' : '';
    this.shapeSrc = p.shapeSrc; this.shapeImg = shape; this.shapeName = p.shapeSrc ? 'Silueta del proyecto' : '';
    this.res = null; this.sync();
    await this.open();
    this.cb.toast('✓ Proyecto abierto.');
  }

  async export() {
    if (!this.res || this.stale) return null;
    this.cb.showBusy('Guardando el destapador…');
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const native = this.$('format').value === 'bambu';
      if (native && !window.api.clickerBambuProfile) throw new Error('El perfil Bambu A1 no está disponible. Selecciona 3MF estándar.');
      const profile = native ? await window.api.clickerBambuProfile(this.res.colors.length) : undefined;
      const data = exportCanOpener(this.res, { bambu: profile });
      const path = await window.api.saveFile({ defaultPath: `${fileBase(this.cfg.name)}${native ? '_Bambu_A1' : ''}.3mf`, filters: [{ name: '3MF', extensions: ['3mf'] }], data });
      if (path) this.cb.toast('3MF guardado. Revisa el laminado y realiza una impresión de prueba.');
      return path;
    } catch (err) {
      this.cb.toast('No se pudo guardar: ' + err.message + (this.$('format').value === 'bambu' ? ' Puedes seleccionar 3MF estándar.' : ''), true);
      return null;
    } finally { this.cb.hideBusy(); }
  }
}
