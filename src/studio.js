// Estudio 2D: preparación de logos (vectorizar, quitar fondo, engrosar, reducir colores, bordeado, silueta, reorganizar)
// y cake toppers para corte láser (letras soldadas en una sola pieza, sin huecos, con palitos; SVG para Corel).
import { processImage, DEFAULT_PROC } from './core/processing.js';
import { edt, dilate, close, fillHoles, fillSmallHoles, components, connectIslands, fillPolygon, traceMask, maskBBox, countOn } from './core/raster.js';
import { renderTextImage, ensureFont, BUNDLED_FONTS } from './core/text.js';
import { CAKE_PRESETS } from './modules.js';
import { imageReady } from './core/imageload.js';
import { thickenLabels, strokeWidth } from './core/thicken.js';

const BORDER = 200, SIL = 201, STICK = 202;   // special labels in the composite raster
const fmt = (v) => String(Math.round(v * 100) / 100);
const parseNum = (s) => parseFloat(String(s).trim().replace(',', '.'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hexRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// rAF is paused while the window is hidden/occluded: never wait more than 100 ms for it.
const nextFrame = () => new Promise((r) => { const t = setTimeout(r, 100); requestAnimationFrame(() => setTimeout(() => { clearTimeout(t); r(); }, 0)); });

export const STUDIO_DEFAULTS = (mode) => ({
  mode,
  name: mode === 'cakelaser' ? 'cake-topper' : 'logo',
  source: null,                    // { kind: 'image'|'text', dataURL, name }
  quant: { colors: 4, removeBg: 'auto', tolerance: 40, minArea: 0, minWidth: 0 },
  palette: [],                     // [{ hex, out, mode: 'keep'|'transparent'|'merge', mergeTo, thicken }]
  elements: [],                    // [{ id, kind: 'image'|'text', group, text, font, weight, color, x, y, scale, rot, hidden, thicken, spread, keepHoles }]
  groupGap: 1.5,                   // mm: parts closer than this form one element
  autoLayout: true,                // move the other elements away when one is thickened
  strokeTarget: 1.2,               // mm: target stroke for "Ajustar trazo"
  widthMM: mode === 'cakelaser' ? 140 : 60,
  thicken: 0,
  border: { enabled: mode !== 'cakelaser', color: '#6d28d9', mm: 1.2, fillHoles: false },
  sil: { enabled: mode !== 'cakelaser', color: '#ffffff', mm: 2, smooth: 1, fillHoles: true },
  cake: {
    color: '#c9a227', thicken: 0.3, weld: 0, bridge: 3, holes: 'small', holeArea: 2,
    sticks: { enabled: true, count: 2, length: 75, width: 5, tip: true, bar: true, barHeight: 5 },
    double: false, baseColor: '#ffffff', baseMM: 3,
  },
  text: { text: 'Feliz Cumpleaños\nSofía', font: 'Pacifico', weight: 700 },
});

export class Studio {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.st = STUDIO_DEFAULTS('logoprep');
    this.result = null;             // processImage output for the source
    this.groups = [];               // image groups: { id, minX, minY, maxX, maxY, canvas }
    this.textCache = new Map();
    this.comp = null;               // composite
    this.sel = null;
    this.view = { s: 1, tx: 0, ty: 0 };
    this.systemFonts = [];
    this.hist = [];
    this.hidx = -1;
    this.build();
  }

  // ------------------------------------------------------------------ DOM
  build() {
    const N = 'inputmode="decimal" type="text"';
    this.root.innerHTML = `
    <header class="topbar">
      <button class="btn" data-a="home">⌂ Inicio</button>
      <div class="brand"><span class="logo">◆</span> Relieve3D <span class="module-name" data-r="title"></span></div>
      <div class="tb-group">
        <button class="btn" data-a="open">🖼️ Abrir imagen</button>
        <button class="btn" data-a="openProject">📂 Abrir</button>
        <button class="btn" data-a="save">💾 Guardar proyecto</button>
      </div>
      <div class="tb-group">
        <button class="btn icon" data-a="undo" title="Deshacer (Ctrl+Z)">↶</button>
        <button class="btn icon" data-a="redo" title="Rehacer (Ctrl+Y)">↷</button>
      </div>
      <div class="spacer"></div>
      <div class="dropdown">
        <button class="btn" data-a="expMenu">⬇ Exportar ▾</button>
        <div class="menu" data-r="expMenu">
          <button data-exp="svg-cut" data-only="cakelaser">SVG para corte láser <small>líneas rojas · Corel / LightBurn</small></button>
          <button data-exp="svg">SVG a color <small>capas por color · Corel / Illustrator</small></button>
          <button data-exp="png">PNG alta resolución <small>fondo transparente</small></button>
        </div>
      </div>
      <div class="dropdown">
        <button class="btn primary" data-a="to3dMenu">Pasar a 3D ▸</button>
        <div class="menu" data-r="to3dMenu">
          <button data-to3d="mic">🎤 Logo para micrófono</button>
          <button data-to3d="keychain">🔑 Llavero</button>
          <button data-to3d="logo">🧩 Logo en relieve</button>
          <button data-to3d="magnet">🧲 Imán de nevera</button>
          <button data-to3d="cake3d">🎂 Cake topper 3D</button>
          <button data-to3d="cutter">🍪 Cortador de galletas</button>
          <button data-to3d="sign">🪧 Letrero / placa</button>
        </div>
      </div>
    </header>
    <main class="layout studio-layout">
      <aside class="panel left">
        <section class="card">
          <div class="seg src-seg" data-r="srcSeg">
            <button class="seg-btn" data-src="image">🖼️ Imagen</button>
            <button class="seg-btn" data-src="text">✍️ Texto</button>
          </div>
          <div data-r="srcImage">
            <label class="row">Colores (máx.) <select data-q="colors"><option>2</option><option>3</option><option>4</option><option>5</option><option>6</option><option>8</option></select></label>
            <label class="row">Quitar fondo <select data-q="removeBg"><option value="auto">Auto</option><option value="yes">Sí</option><option value="no">No (usa transparencia)</option></select></label>
            <label class="row">Tolerancia fondo <input ${N} data-q="tolerance" /></label>
            <label class="row">Limpiar motas (px) <input ${N} data-q="minArea" /></label>
        <label class="row" title="Elimina contornos finos, halos y astillas que al imprimir quedan como pestañas sueltas">Quitar líneas finas <select data-q="minWidth"><option value="0">Auto</option><option value="2">≤ 2 px</option><option value="3">≤ 3 px</option><option value="5">≤ 5 px</option><option value="8">≤ 8 px</option><option value="-1">No</option></select></label>
          </div>
          <div data-r="srcText">
            <textarea rows="2" data-t="text" placeholder="Escribe el texto…"></textarea>
            <label class="row">Fuente <select data-t="font"></select></label>
            <label class="row">Grosor <select data-t="weight"><option value="400">Normal</option><option value="700">Negrita</option><option value="900">Extra</option></select></label>
          </div>
        </section>

        <section class="card">
          <h3>Tamaño</h3>
          <label class="row"><span data-r="widthLabel">Ancho del diseño (mm)</span> <input ${N} data-s="widthMM" data-min="5" /></label>
          <div class="muted small" data-r="sizeInfo"></div>
        </section>

        <section class="card" data-only="logoprep">
          <h3>Colores <small class="muted">clic en el color para cambiarlo</small></h3>
          <div data-r="palette" class="st-palette"></div>
          <label class="row">Engrosar todo (mm) <input ${N} data-s="thicken" /></label>
        </section>

        <section class="card" data-only="logoprep">
          <h3><label class="chk"><input type="checkbox" data-s="border.enabled" /> Bordeado</label></h3>
          <label class="row">Color <input type="color" data-s="border.color" /></label>
          <label class="row">Grosor (mm) <input ${N} data-s="border.mm" /></label>
          <label class="row">Rellenar huecos interiores <input type="checkbox" data-s="border.fillHoles" /></label>
        </section>

        <section class="card" data-only="logoprep">
          <h3><label class="chk"><input type="checkbox" data-s="sil.enabled" /> Silueta exterior</label></h3>
          <label class="row">Color <input type="color" data-s="sil.color" /></label>
          <label class="row">Separación (mm) <input ${N} data-s="sil.mm" /></label>
          <label class="row">Suavizar (mm) <input ${N} data-s="sil.smooth" /></label>
          <label class="row">Sin huecos <input type="checkbox" data-s="sil.fillHoles" /></label>
          <p class="muted small">La silueta sigue la forma total del logo y une todas sus partes (tipo sticker).</p>
        </section>

        <section class="card" data-only="cakelaser">
          <h3>Letras y soldadura</h3>
          <label class="row">Color de vista previa <input type="color" data-s="cake.color" /></label>
          <label class="row">Engrosar letras (mm) <input ${N} data-s="cake.thicken" /></label>
          <label class="row">Contorno de unión (mm) <input ${N} data-s="cake.weld" /></label>
          <label class="row">Puentes entre partes (mm) <input ${N} data-s="cake.bridge" data-min="0.5" /></label>
          <label class="row">Huecos <select data-s="cake.holes"><option value="all">Rellenar todos</option><option value="small">Rellenar pequeños</option><option value="none">Dejar huecos</option></select></label>
          <label class="row" data-when="cake.holes=small">Hueco máximo (mm²) <input ${N} data-s="cake.holeArea" /></label>
          <label class="row">Doble capa (letras + base) <input type="checkbox" data-s="cake.double" /></label>
          <label class="row" data-when="cake.double=true">Color base <input type="color" data-s="cake.baseColor" /></label>
          <label class="row" data-when="cake.double=true">Borde de la base (mm) <input ${N} data-s="cake.baseMM" /></label>
          <p class="muted small">Todo se suelda en una sola pieza: sin letras sueltas ni partes que se caigan al cortar.</p>
        </section>

        <section class="card" data-only="cakelaser">
          <h3><label class="chk"><input type="checkbox" data-s="cake.sticks.enabled" /> Palitos de soporte</label></h3>
          <label class="row">Tamaño de torta <select data-r="cakePreset"></select></label>
          <label class="row">Cantidad <input ${N} data-s="cake.sticks.count" data-min="1" /></label>
          <label class="row">Largo (mm) <input ${N} data-s="cake.sticks.length" data-min="5" /></label>
          <label class="row">Ancho (mm) <input ${N} data-s="cake.sticks.width" data-min="2" /></label>
          <label class="row">Punta afilada <input type="checkbox" data-s="cake.sticks.tip" /></label>
          <label class="row">Barra de unión <input type="checkbox" data-s="cake.sticks.bar" /></label>
          <label class="row" data-when="cake.sticks.bar=true">Alto barra (mm) <input ${N} data-s="cake.sticks.barHeight" data-min="1" /></label>
        </section>
      </aside>

      <section class="center">
        <div class="views mode-2d"><div class="view st-view" data-r="viewWrap">
          <canvas data-r="canvas"></canvas>
          <div class="floating-tools">
            <button class="tool" data-a="fit" title="Ajustar a la vista">⤢</button>
            <button class="tool toggle" data-a="original" title="Ver imagen original">👁</button>
          </div>
          <div class="hint st-hint">Arrastra un elemento para moverlo · rueda para zoom · botón derecho para desplazar</div>
          <div class="dropzone" data-r="drop"><div class="dz-inner"><div class="dz-icon">🖼️</div><h2>Arrastra aquí el logo o la imagen</h2><p>PNG, JPG, WEBP… o usa «Texto»</p><button class="btn primary" data-a="open">Abrir imagen</button></div></div>
        </div></div>
        <div class="statusbar"><span data-r="status"></span><span class="spacer"></span><span data-r="hover"></span></div>
      </section>

      <aside class="panel right">
        <section class="card grow">
          <h3>Elementos <small class="muted">reorganiza las partes</small></h3>
          <label class="row">Agrupar partes a menos de (mm) <input ${N} data-s="groupGap" /></label>
          <label class="row">Reacomodar al engrosar <input type="checkbox" data-s="autoLayout" /></label>
          <div data-r="elements" class="st-elements"></div>
          <button class="btn wide" data-a="addText">＋ Añadir texto</button>
          <div data-r="elProps" class="st-props" hidden>
            <h4>Elemento seleccionado</h4>
            <div data-r="elText">
              <textarea rows="2" data-e="text"></textarea>
              <label class="row">Fuente <select data-e="font"></select></label>
              <label class="row">Color <select data-e="color"></select></label>
            </div>
            <label class="row">Escala (%) <input ${N} data-e="scale" /></label>
            <label class="row">Rotación (°) <input ${N} data-e="rot" data-allowneg="1" /></label>
            <div class="st-thick">
              <h4>Engrosar este elemento</h4>
              <label class="row">Engrosar (mm) <input ${N} data-e="thicken" /></label>
              <label class="row">Al engrosar <select data-e="spread"><option value="auto">Automático</option><option value="letters">Separar letras y líneas</option><option value="none">Crecer en su lugar</option></select></label>
              <label class="row">Conservar huecos (o, a, e…) <input type="checkbox" data-e="keepHoles" /></label>
              <div class="muted small" data-r="strokeInfo"></div>
              <label class="row">Trazo deseado (mm) <input ${N} data-s="strokeTarget" data-min="0.2" /></label>
              <button class="btn wide" data-a="fitStroke">✚ Ajustar al trazo deseado</button>
            </div>
            <div class="quick">
              <button class="chip" data-a="front">⬆ Al frente</button>
              <button class="chip" data-a="back">⬇ Atrás</button>
              <button class="chip" data-a="center">⊕ Centrar</button>
              <button class="chip" data-a="del">✕ Eliminar</button>
            </div>
          </div>
        </section>
      </aside>
    </main>
    <input type="file" data-r="file" accept="image/*" hidden />
    <input type="file" data-r="fileProject" accept=".r3s,.json" hidden />`;
    const q = (s) => this.root.querySelector(s);
    this.$ = (name) => q(`[data-r="${name}"]`);
    this.canvas = this.$('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.fillFonts();
    this.$('cakePreset').innerHTML = '<option value="">— elegir —</option>' + Object.entries(CAKE_PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('');
    this.bind();
    new ResizeObserver(() => this.resize()).observe(this.$('viewWrap'));
  }

  fillFonts() {
    const cats = [...new Set(BUNDLED_FONTS.map((f) => f.cat))];
    let html = cats.map((c) => `<optgroup label="${esc(c)}">${BUNDLED_FONTS.filter((f) => f.cat === c).map((f) => `<option>${esc(f.family)}</option>`).join('')}</optgroup>`).join('');
    if (this.systemFonts.length) html += `<optgroup label="Fuentes del equipo">${this.systemFonts.map((f) => `<option>${esc(f)}</option>`).join('')}</optgroup>`;
    for (const el of this.root.querySelectorAll('[data-t="font"], [data-e="font"]')) { const v = el.value; el.innerHTML = html; if (v) el.value = v; }
  }
  setSystemFonts(list) { this.systemFonts = list; this.fillFonts(); this.syncInputs(); }

  bind() {
    const r = this.root;
    r.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      const exp = e.target.closest('[data-exp]')?.dataset.exp;
      const to3d = e.target.closest('[data-to3d]')?.dataset.to3d;
      const src = e.target.closest('[data-src]')?.dataset.src;
      const pal = e.target.closest('[data-pal]');
      const elr = e.target.closest('[data-el]');
      if (!e.target.closest('.dropdown')) r.querySelectorAll('.menu').forEach((m) => m.classList.remove('open'));
      if (a === 'home') this.cb.onBack();
      else if (a === 'open') this.$('file').click();
      else if (a === 'openProject') this.$('fileProject').click();
      else if (a === 'save') this.saveProject();
      else if (a === 'undo') this.undo();
      else if (a === 'redo') this.redo();
      else if (a === 'fit') this.fit();
      else if (a === 'original') { this.showOriginal = !this.showOriginal; e.target.closest('button').classList.toggle('active', this.showOriginal); this.draw(); }
      else if (a === 'expMenu' || a === 'to3dMenu') { e.stopPropagation(); const m = this.$(a === 'expMenu' ? 'expMenu' : 'to3dMenu'); const open = m.classList.contains('open'); r.querySelectorAll('.menu').forEach((x) => x.classList.remove('open')); m.classList.toggle('open', !open); }
      else if (a === 'addText') this.addText();
      else if (a === 'front' || a === 'back') this.reorder(a === 'front' ? 1 : -1);
      else if (a === 'center') this.centerSel();
      else if (a === 'del') this.deleteSel();
      else if (a === 'fitStroke') this.fitStroke();
      else if (exp) { r.querySelectorAll('.menu').forEach((m) => m.classList.remove('open')); this.export(exp); }
      else if (to3d) { r.querySelectorAll('.menu').forEach((m) => m.classList.remove('open')); this.sendTo3D(to3d); }
      else if (src) this.setSource(src);
      else if (pal && e.target.dataset.pa) this.paletteAction(+pal.dataset.pal, e.target.dataset.pa);
      else if (elr) {
        const el = this.st.elements.find((x) => x.id === +elr.dataset.el);
        if (e.target.dataset.ea === 'eye') { el.hidden = !el.hidden; this.changed(); } else { this.sel = el.id; this.renderElements(); this.draw(); }
      }
    });
    document.addEventListener('click', () => r.querySelectorAll('.menu').forEach((m) => m.classList.remove('open')));
    this.$('file').onchange = (e) => { if (e.target.files[0]) this.loadFile(e.target.files[0]); e.target.value = ''; };
    this.$('fileProject').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { this.openProject(JSON.parse(await f.text())); } catch (err) { this.cb.toast('No se pudo abrir: ' + err.message, true); }
    };
    this.$('cakePreset').onchange = (e) => {
      const p = CAKE_PRESETS[e.target.value];
      if (!p) return;
      this.st.widthMM = p.widthMM;
      Object.assign(this.st.cake.sticks, p.sticks, { enabled: true });
      this.changed();
    };
    // generic settings binding
    r.querySelectorAll('[data-s]').forEach((el) => el.addEventListener('change', () => {
      const path = el.dataset.s;
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'color' || el.tagName === 'SELECT') v = el.value;
      else { v = parseNum(el.value); if (!Number.isFinite(v)) { this.syncInputs(); return; } v = Math.max(el.dataset.min ? +el.dataset.min : 0, v); }
      setPath(this.st, path, v);
      this.changed(path === 'groupGap' ? 'regroup' : null);
    }));
    r.querySelectorAll('[data-q]').forEach((el) => el.addEventListener('change', () => {
      const k = el.dataset.q, v = el.tagName === 'SELECT' && k !== 'colors' ? el.value : parseNum(el.value);
      if (typeof v === 'number' && !Number.isFinite(v)) return;
      this.st.quant[k] = v;
      this.reprocess();
    }));
    let tt;
    r.querySelectorAll('[data-t]').forEach((el) => el.addEventListener(el.tagName === 'TEXTAREA' ? 'input' : 'change', () => {
      this.st.text[el.dataset.t] = el.tagName === 'TEXTAREA' || el.dataset.t === 'font' ? el.value : +el.value;
      clearTimeout(tt); tt = setTimeout(() => this.loadText(), 400);
    }));
    let et;
    r.querySelectorAll('[data-e]').forEach((el) => el.addEventListener(el.tagName === 'TEXTAREA' ? 'input' : 'change', () => {
      const e = this.selEl();
      if (!e) return;
      const k = el.dataset.e;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'scale' || k === 'rot' || k === 'thicken') { v = parseNum(v); if (!Number.isFinite(v)) return; if (k === 'scale') v = Math.max(5, v) / 100; if (k === 'thicken') v = Math.max(0, Math.min(10, v)); }
      e[k] = v;
      clearTimeout(et); et = setTimeout(() => this.changed(), el.tagName === 'TEXTAREA' ? 350 : 0);
    }));
    r.querySelectorAll('input[type="text"]').forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); }));
    this.$('palette').addEventListener('change', (e) => {
      const i = +e.target.closest('[data-pal]').dataset.pal, p = this.st.palette[i];
      const wasT = p.mode === 'transparent';
      if (e.target.type === 'color') p.out = e.target.value;
      else if (e.target.dataset.pm === 'mode') { const v = e.target.value; if (v.startsWith('m')) { p.mode = 'merge'; p.mergeTo = +v.slice(1); } else p.mode = v; }
      else if (e.target.dataset.pm === 'thicken') { const v = parseNum(e.target.value); p.thicken = Number.isFinite(v) ? Math.max(0, v) : 0; }
      this.changed(wasT !== (p.mode === 'transparent') ? 'regroup' : null);
    });
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (typing) return;
      const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (ctrl && k === 'z') { e.preventDefault(); this.undo(); }
      else if (ctrl && k === 'y') { e.preventDefault(); this.redo(); }
      else if (ctrl && k === 's') { e.preventDefault(); this.saveProject(); }
      else if (k === 'delete' && this.sel != null) this.deleteSel();
      else if (k.startsWith('arrow') && this.selEl()) {
        e.preventDefault();
        const d = (e.shiftKey ? 10 : 1) / this.ppm();
        const el = this.selEl();
        if (k === 'arrowleft') el.x -= d; if (k === 'arrowright') el.x += d; if (k === 'arrowup') el.y -= d; if (k === 'arrowdown') el.y += d;
        this.changed();
      }
    });
    this.bindCanvas();
  }

  // ------------------------------------------------------------------ open / sources
  open(mode) {
    if (this.st.mode !== mode || !this.st.source) {
      this.st = STUDIO_DEFAULTS(mode);
      this.result = null; this.groups = []; this.comp = null; this.sel = null; this.hist = []; this.hidx = -1;
      if (mode === 'cakelaser') { this.root.hidden = false; this.loadText(); }
    }
    this.root.hidden = false;
    this.syncInputs();
    this.resize();
  }

  async loadFile(file) {
    if (/\.(r3s|json)$/i.test(file.name)) { try { this.openProject(JSON.parse(await file.text())); } catch (e) { this.cb.toast(e.message, true); } return; }
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) { this.cb.toast('Formato no soportado', true); return; }
    const dataURL = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    this.st.source = { kind: 'image', dataURL, name: file.name };
    this.st.name = file.name.replace(/\.[^.]+$/, '');
    this.st.elements = [];
    await this.reprocess(true);
  }

  async loadText() {
    const t = this.st.text;
    if (!String(t.text).trim()) return;
    await ensureFont(t.font, t.weight);
    const r = renderTextImage({ text: t.text, font: t.font, weight: t.weight, align: 'center', lineHeight: 1.0, fill: '#111111', outline: false, thicken: 0 }, this.st.widthMM);
    this.st.source = { kind: 'text', dataURL: r.dataURL, name: 'texto' };
    this.st.quant.colors = 2;
    this.st.elements = [];
    await this.reprocess(true, true);
  }

  setSource(kind) {
    if (kind === 'image') this.$('file').click();
    else { this.st.source = { kind: 'text' }; this.syncInputs(); this.loadText(); }
  }

  async reprocess(fresh = false, isText = false, record = true) {
    const src = this.st.source;
    if (!src?.dataURL) { this.syncInputs(); return; }
    this.cb.showBusy('Vectorizando…');
    await nextFrame();
    try {
      const img = new Image(); img.src = src.dataURL; await imageReady(img);
      this.srcImage = img;
      const maxRes = 1400;
      const k = Math.min(1, maxRes / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, w, h);
      const q = this.st.quant;
      const res = processImage(cx.getImageData(0, 0, w, h), {
        ...DEFAULT_PROC, colors: isText || src.kind === 'text' ? 0 : +q.colors, removeBg: src.kind === 'text' ? 'no' : q.removeBg,
        tolerance: q.tolerance, minArea: q.minArea, minWidth: +(q.minWidth ?? 0), maxRes,
      });
      // text: force a single colour
      if (src.kind === 'text') { res.palette = [res.palette[0]]; for (const p of res.pieces) p.cluster = 0; }
      this.result = res;
      if (fresh || this.st.palette.length !== res.palette.length) {
        const oldCake = this.st.mode === 'cakelaser';
        this.st.palette = res.palette.map((p) => ({ hex: p.hex, out: oldCake ? this.st.cake.color : p.hex, mode: 'keep', mergeTo: 0, thicken: 0 }));
      } else res.palette.forEach((p, i) => { this.st.palette[i].hex = p.hex; });
      this.regroup(fresh);
      this.compute();
      this.fit();
      if (record) this.commit();
    } catch (err) {
      console.error(err);
      this.cb.toast('Error al vectorizar: ' + err.message, true);
    } finally {
      this.cb.hideBusy();
      this.syncInputs();
    }
  }

  // label raster of the source: palette index per px (-1 = background)
  sourceLabels() {
    const r = this.result, L = new Int16Array(r.width * r.height).fill(-1);
    for (let i = 0; i < L.length; i++) { const c = r.comp[i]; if (c >= 0) L[i] = r.pieces[c].cluster; }
    return L;
  }

  // Splits the source into elements (connected parts closer than groupGap are kept together).
  regroup(resetElements = false) {
    const r = this.result;
    if (!r) return;
    const W = r.width, H = r.height, L = this.sourceLabels();
    // colours set to "Quitar" don't hold parts together (e.g. a white sticker base behind the logo)
    const P = this.st.palette;
    const fg = Uint8Array.from(L, (v) => (v >= 0 && P[v]?.mode !== 'transparent' ? 1 : 0));
    const ppm = this.ppmSource();
    const gapPx = Math.max(1, (this.st.groupGap * ppm) / 2);
    const grown = dilate(fg, W, H, gapPx);
    const { labels, comps } = components(grown, W, H);
    // order groups by reading order (top-left first)
    const order = comps.map((c, i) => i).sort((a, b) => (comps[a].minY - comps[b].minY) || (comps[a].minX - comps[b].minX));
    this.groups = order.map((ci, gi) => {
      let minX = W, minY = H, maxX = -1, maxY = -1;
      for (let i = 0; i < L.length; i++) if (fg[i] && labels[i] === ci) { const x = i % W, y = (i / W) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      if (maxX < 0) return null;
      const w = maxX - minX + 1, h = maxY - minY + 1;
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d'), im = cx.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const si = (y + minY) * W + x + minX;
        if (!fg[si] || labels[si] !== ci) continue;
        const o = (y * w + x) * 4;
        im.data[o] = (L[si] + 1) * 20; im.data[o + 3] = 255;
      }
      cx.putImageData(im, 0, 0);
      return { id: gi, minX, minY, maxX: maxX + 1, maxY: maxY + 1, canvas: cv };
    }).filter(Boolean);
    const texts = this.st.elements.filter((e) => e.kind === 'text');
    const olds = this.st.elements.filter((e) => e.kind === 'image');
    const used = new Set();
    let nid = Math.max(0, ...this.st.elements.map((e) => e.id)) + 1;
    const imgs = this.groups.map((g) => {
      const w = g.maxX - g.minX, h = g.maxY - g.minY;
      // keep an existing element only if it is the same part (same place & size in the source)
      const o = !resetElements && olds.find((e) => !used.has(e) && Math.abs(e.w - w) <= 2 && Math.abs(e.h - h) <= 2
        && (e.srcX == null ? e.group === g.id : Math.abs(e.srcX - g.minX) <= 2 && Math.abs(e.srcY - g.minY) <= 2));
      if (o) { used.add(o); return { ...o, group: g.id, w, h, srcX: g.minX, srcY: g.minY }; }
      return { id: nid++, kind: 'image', group: g.id, x: g.minX, y: g.minY, w, h, srcX: g.minX, srcY: g.minY, scale: 1, rot: 0, hidden: false };
    });
    this.st.elements = [...imgs, ...texts];
    if (this.sel != null && !this.st.elements.some((e) => e.id === this.sel)) this.sel = null;
  }

  // mm → source px, defined so the visible element layout spans widthMM
  ppmSource() {
    const r = this.result;
    if (!r) return 10;
    const b = this.layoutBBox('base') || r.fgBBox;
    return Math.max(0.5, (b[2] - b[0]) / Math.max(1, this.st.widthMM));
  }
  ppm() { return this.ppmSource(); }

  elementCanvas(e) {
    if (e.kind === 'image') return this.groups.find((g) => g.id === e.group)?.canvas;
    const key = JSON.stringify([e.text, e.font, e.weight, e.color]);
    if (this.textCache.has(key)) return this.textCache.get(key);
    const r = renderTextImage({ text: e.text, font: e.font, weight: e.weight || 700, align: 'center', fill: '#000000', outline: false, thicken: 0 }, 100);
    const img = new Image(); img.src = r.dataURL;
    const cv = document.createElement('canvas'); cv.width = r.width; cv.height = r.height;
    imageReady(img).then(() => {
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, cv.width, cv.height);
      // crop + encode palette index
      let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d.data[(y * cv.width + x) * 4 + 3] > 110) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const w = Math.max(1, x1 - x0 + 1), h = Math.max(1, y1 - y0 + 1);
      const out = cx.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const a = d.data[((y + y0) * cv.width + x + x0) * 4 + 3];
        if (a > 110) { const o = (y * w + x) * 4; out.data[o] = ((+e.color || 0) + 1) * 20; out.data[o + 3] = 255; }
      }
      cv.width = w; cv.height = h;
      cx.putImageData(out, 0, 0);
      cv.ready = true;
      if (!e.w) { e.w = w; e.h = h; }
      this.compute(); this.draw();
    });
    this.textCache.set(key, cv);
    return cv;
  }

  // transformed bbox (source px) of an element.
  // which: 'base' = untouched element, 'grown' = after thickening, default = after thickening + auto-layout shift
  elQuad(e, which) {
    const r = which === 'base' ? null : this.elRender(e);
    const [sx, sy] = which ? [0, 0] : this.shiftOf(e);
    const cx = e.x + e.w / 2 + sx, cy = e.y + e.h / 2 + sy, a = (e.rot * Math.PI) / 180, s = e.scale;
    const co = Math.cos(a) * s, si = Math.sin(a) * s;
    const u0 = (r ? r.x0 : 0) - e.w / 2, v0 = (r ? r.y0 : 0) - e.h / 2, u1 = u0 + (r ? r.w : e.w), v1 = v0 + (r ? r.h : e.h);
    return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [cx + u * co - v * si, cy + u * si + v * co]);
  }
  layoutBBox(which) {
    let b = null;
    for (const e of this.st.elements) {
      if (e.hidden || !e.w) continue;
      for (const [x, y] of this.elQuad(e, which)) b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y];
    }
    return b;
  }
  shiftOf(e) { return this._shift?.get(e.id) || [0, 0]; }

  // label raster (palette index, -1 empty) of a palette-encoded canvas
  canvasLabels(cv) {
    const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data;
    const L = new Int16Array(cv.width * cv.height).fill(-1);
    for (let i = 0; i < L.length; i++) if (d[i * 4 + 3] >= 128) L[i] = Math.round(d[i * 4] / 20) - 1;
    return L;
  }

  // Element as drawn: { canvas, x0, y0, w, h } in element units (the untouched element spans 0..e.w × 0..e.h).
  elRender(e) {
    const src = this.elementCanvas(e);
    if (!src || (e.kind === 'text' && !src.ready)) return null;
    if (!(e.thicken > 0) || !src.width) return { canvas: src, x0: 0, y0: 0, w: e.w, h: e.h };
    const k = e.w / src.width;                                 // element units per canvas px
    const rpx = (e.thicken * this.ppmSource()) / (e.scale * k);
    const key = [rpx.toFixed(2), e.spread || 'auto', e.keepHoles !== false, e.kind === 'text'].join('|');
    this._thk = this._thk || new WeakMap();
    const c = this._thk.get(src);
    if (c && c.key === key) return { ...c.r, x0: c.r.x0 * k, y0: c.r.y0 * k, w: c.r.w * k, h: c.r.h * k };
    const mode = e.spread === 'letters' || e.spread === 'none' ? e.spread : e.kind === 'text' ? 'letters' : 'auto';
    const t = thickenLabels(this.canvasLabels(src), src.width, src.height, rpx, { mode, keepHoles: e.keepHoles !== false });
    const cv = document.createElement('canvas'); cv.width = t.W; cv.height = t.H;
    const cx = cv.getContext('2d'), im = cx.createImageData(t.W, t.H);
    for (let i = 0; i < t.L.length; i++) if (t.L[i] >= 0) { im.data[i * 4] = (t.L[i] + 1) * 20; im.data[i * 4 + 3] = 255; }
    cx.putImageData(im, 0, 0);
    const r = { canvas: cv, x0: -t.ox, y0: -t.oy, w: t.W, h: t.H, spread: t.spread };
    this._thk.set(src, { key, r });
    return { ...r, x0: r.x0 * k, y0: r.y0 * k, w: r.w * k, h: r.h * k };
  }

  // Stroke width (mm) of the thinnest typical parts of the untouched element.
  strokeMM(e) {
    const src = this.elementCanvas(e);
    if (!src || !src.width || (e.kind === 'text' && !src.ready)) return 0;
    this._stroke = this._stroke || new WeakMap();
    if (!this._stroke.has(src)) this._stroke.set(src, strokeWidth(this.canvasLabels(src), src.width, src.height));
    return (this._stroke.get(src) * (e.w / src.width) * e.scale) / this.ppmSource();
  }
  fitStroke() {
    const e = this.selEl();
    if (!e) return;
    const s = this.strokeMM(e);
    if (!(s > 0)) return;
    e.thicken = Math.max(0, Math.round(((this.st.strokeTarget || 1.2) - s) * 50) / 100);
    if (!e.thicken) this.cb.toast(`El trazo ya mide ${fmt(s)} mm (≥ ${fmt(this.st.strokeTarget)} mm).`);
    this.changed();
  }

  // Auto-layout: when elements grow, the ones below / to the right move so the original gaps are kept.
  computeShifts() {
    const sh = new Map();
    this._shift = sh;
    const els = this.st.elements.filter((e) => !e.hidden && e.w);
    if (this.st.autoLayout === false || !els.some((e) => e.thicken > 0)) return;
    const box = (q) => [Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[0])), Math.max(...q.map((p) => p[1]))];
    const B = els.map((e) => box(this.elQuad(e, 'base'))), G = els.map((e) => box(this.elQuad(e, 'grown')));
    const n = els.length, d = [new Float64Array(n), new Float64Array(n)];
    const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
    for (const ax of [1, 0]) {                       // vertical first (stacked lines), then horizontal
      const o = 1 - ax, ord = [...Array(n).keys()].sort((a, b) => B[a][ax] - B[b][ax]);
      for (const j of ord) for (const i of ord) {
        if (i === j || !(B[i][ax] < B[j][ax])) continue;
        const tol = 0.25 * Math.min(B[i][ax + 2] - B[i][ax], B[j][ax + 2] - B[j][ax]);
        if (B[i][ax + 2] > B[j][ax] + tol || ov(B[i][o], B[i][o + 2], B[j][o], B[j][o + 2]) <= 0) continue;
        // use up to half of the free space that was already there before pushing
        const gap = Math.max(0, B[j][ax] - B[i][ax + 2]) / 2;
        d[ax][j] = Math.max(d[ax][j], d[ax][i] + (G[i][ax + 2] - B[i][ax + 2]) + (B[j][ax] - G[j][ax]) - gap);
      }
    }
    // keep the whole design centred where it was
    let u = null, g = null;
    els.forEach((e, i) => {
      const b = B[i], q = [G[i][0] + d[0][i], G[i][1] + d[1][i], G[i][2] + d[0][i], G[i][3] + d[1][i]];
      u = u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b.slice();
      g = g ? [Math.min(g[0], q[0]), Math.min(g[1], q[1]), Math.max(g[2], q[2]), Math.max(g[3], q[3])] : q;
    });
    const cx = (g[0] + g[2] - u[0] - u[2]) / 2, cy = (g[1] + g[3] - u[1] - u[3]) / 2;
    els.forEach((e, i) => { const x = d[0][i] - cx, y = d[1][i] - cy; if (Math.abs(x) > 1e-6 || Math.abs(y) > 1e-6) sh.set(e.id, [x, y]); });
  }

  // ------------------------------------------------------------------ composite pipeline
  compute() {
    const st = this.st;
    this.computeShifts();
    const lb = this.layoutBBox();
    if (!this.result || !lb) { this.comp = null; this.updateStatus(); return; }
    const ppm0 = this.ppmSource();
    const cake = st.mode === 'cakelaser';
    let marginMM = 3 + st.thicken + Math.max(0, ...st.palette.map((p) => p.thicken || 0));
    if (!cake) marginMM += (st.border.enabled ? st.border.mm : 0) + (st.sil.enabled ? st.sil.mm + st.sil.smooth : 0);
    else marginMM += st.cake.thicken + st.cake.weld + (st.cake.double ? st.cake.baseMM : 0);
    let bottomMM = cake && st.cake.sticks.enabled ? st.cake.sticks.length + 5 : 0;
    const lw = lb[2] - lb[0], lh = lb[3] - lb[1];
    const totalW = lw + 2 * marginMM * ppm0, totalH = lh + (2 * marginMM + bottomMM) * ppm0;
    const f = Math.min(2, Math.sqrt(4.5e6 / (totalW * totalH)));     // composite px per source px
    const W = Math.ceil(totalW * f), H = Math.ceil(totalH * f);
    const ox = lb[0] - marginMM * ppm0, oy = lb[1] - marginMM * ppm0;   // composite origin (source px)
    const ppm = ppm0 * f;                                              // composite px per mm
    // draw elements (nearest neighbour, palette index encoded in red)
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.imageSmoothingEnabled = false;
    for (const e of st.elements) {
      if (e.hidden || !e.w) continue;
      const rr = this.elRender(e);
      if (!rr) continue;
      const [sx, sy] = this.shiftOf(e);
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.translate((e.x + e.w / 2 + sx - ox) * f, (e.y + e.h / 2 + sy - oy) * f);
      cx.rotate((e.rot * Math.PI) / 180);
      cx.scale(e.scale * f, e.scale * f);
      cx.drawImage(rr.canvas, rr.x0 - e.w / 2, rr.y0 - e.h / 2, rr.w, rr.h);
    }
    const d = cx.getImageData(0, 0, W, H).data;
    const N = W * H, L = new Int16Array(N).fill(-1);
    const P = st.palette;
    const resolve = (i) => { let k = i, n = 0; while (P[k] && P[k].mode === 'merge' && n++ < 10) k = P[k].mergeTo; return P[k]?.mode === 'transparent' ? -1 : k; };
    const map = P.map((p, i) => resolve(i));
    for (let i = 0; i < N; i++) {
      if (d[i * 4 + 3] < 128) continue;
      const idx = Math.round(d[i * 4] / 20) - 1;
      if (idx >= 0 && idx < map.length) L[i] = map[idx];
    }
    const mm = (v) => v * ppm;
    // per-colour thicken (grows over background and other colours)
    P.forEach((p, k) => {
      if (!(p.thicken > 0)) return;
      const m = Uint8Array.from(L, (v) => (v === k ? 1 : 0));
      if (!countOn(m)) return;
      const dist = edt(m, W, H);
      const r = mm(p.thicken);
      for (let i = 0; i < N; i++) if (dist[i] <= r && L[i] !== k) L[i] = k;
    });
    const fgOf = () => Uint8Array.from(L, (v) => (v >= 0 ? 1 : 0));
    const grow = (r) => {
      if (!(r > 0)) return;
      const { dist, index } = edt(fgOf(), W, H, true);
      const L2 = L.slice();
      for (let i = 0; i < N; i++) if (L[i] < 0 && dist[i] <= r && index[i] >= 0) L2[i] = L[index[i]];
      L.set(L2);
    };
    const out = { W, H, L, ppm, ox, oy, f, cake };
    if (!cake) {
      grow(mm(st.thicken));
      if (st.border.enabled && st.border.mm > 0) {
        const fg = fgOf();
        const dist = edt(fg, W, H);
        let bm = new Uint8Array(N);
        for (let i = 0; i < N; i++) if (!fg[i] && dist[i] <= mm(st.border.mm)) bm[i] = 1;
        if (st.border.fillHoles) { const all = fillHoles(Uint8Array.from(fg, (v, i) => v || bm[i]), W, H); bm = Uint8Array.from(all, (v, i) => (v && !fg[i] ? 1 : 0)); }
        for (let i = 0; i < N; i++) if (bm[i]) L[i] = BORDER;
      }
      if (st.sil.enabled && st.sil.mm > 0) {
        const fg = fgOf();
        let m = dilate(fg, W, H, mm(st.sil.mm));
        if (st.sil.smooth > 0) m = close(m, W, H, mm(st.sil.smooth));
        m = connectIslands(m, W, H, mm(2.5)).mask;
        if (st.sil.fillHoles) m = fillHoles(m, W, H);
        for (let i = 0; i < N; i++) if (m[i] && L[i] < 0) L[i] = SIL;
      }
    } else {
      // single cut piece
      for (let i = 0; i < N; i++) if (L[i] >= 0) L[i] = 0;
      grow(mm(st.cake.thicken));
      const letters = fgOf();
      let m = letters;
      if (st.cake.weld > 0) m = close(m, W, H, mm(st.cake.weld));
      m = connectIslands(m, W, H, mm(st.cake.bridge)).mask;
      if (st.cake.holes === 'all') m = fillHoles(m, W, H);
      else if (st.cake.holes === 'small') m = fillSmallHoles(m, W, H, st.cake.holeArea * ppm * ppm);
      out.letters = letters;
      let base = m;
      if (st.cake.double) base = fillHoles(dilate(m, W, H, mm(st.cake.baseMM)), W, H);
      // sticks
      if (st.cake.sticks.enabled) {
        const S2 = st.cake.sticks, bb = maskBBox(base, W, H);
        if (bb) {
          const sm = new Uint8Array(N), bottom = bb[3];
          if (S2.bar) fillPolygon(sm, W, H, [[bb[0] + mm(3), bottom - mm(S2.barHeight)], [bb[2] - mm(3), bottom - mm(S2.barHeight)], [bb[2] - mm(3), bottom], [bb[0] + mm(3), bottom]]);
          const n = Math.max(1, Math.round(S2.count)), w = mm(S2.width), Ls = mm(S2.length);
          const both = Uint8Array.from(base, (v, i) => v || sm[i]);
          for (let i = 0; i < n; i++) {
            const xc = n === 1 ? (bb[0] + bb[2]) / 2 : bb[0] + ((bb[2] - bb[0]) * (i + 0.5)) / n;
            let low = -1;
            for (let y = H - 1; y >= 0 && low < 0; y--) for (let x = Math.floor(xc - w / 2); x <= Math.ceil(xc + w / 2); x++) if (x >= 0 && x < W && both[y * W + x]) { low = y; break; }
            const top = (low >= 0 ? low : bottom) - mm(4), yb = bottom + Ls, tl = S2.tip ? Math.min(w * 1.4, Ls * 0.3) : 0;
            fillPolygon(sm, W, H, tl ? [[xc - w / 2, top], [xc + w / 2, top], [xc + w / 2, yb - tl], [xc, yb], [xc - w / 2, yb - tl]] : [[xc - w / 2, top], [xc + w / 2, top], [xc + w / 2, yb], [xc - w / 2, yb]]);
          }
          base = Uint8Array.from(base, (v, i) => v || sm[i]);
          if (!st.cake.double) m = base;
        }
      }
      // ensure the final cut is a single piece
      const finalCut = st.cake.double ? base : m;
      const joined = connectIslands(finalCut, W, H, mm(st.cake.bridge)).mask;
      if (st.cake.double) base = joined; else m = joined;
      out.cut = st.cake.double ? base : m;
      out.top = st.cake.double ? letters : null;
      out.pieces = components(out.cut, W, H).comps.length;
      for (let i = 0; i < N; i++) L[i] = st.cake.double ? (letters[i] ? 0 : base[i] ? SIL : -1) : (out.cut[i] ? 0 : -1);
    }
    out.bbox = maskBBox(Uint8Array.from(L, (v) => (v !== -1 ? 1 : 0)), W, H);
    this.comp = out;
    this.renderComposite();
    this.updateStatus();
  }

  colorOf(label) {
    const st = this.st;
    if (label === BORDER) return st.border.color;
    if (label === SIL) return st.mode === 'cakelaser' ? st.cake.baseColor : st.sil.color;
    if (st.mode === 'cakelaser') return st.cake.color;
    return st.palette[label]?.out || '#000000';
  }

  renderComposite() {
    const c = this.comp;
    const cv = document.createElement('canvas'); cv.width = c.W; cv.height = c.H;
    const cx = cv.getContext('2d'), im = cx.createImageData(c.W, c.H);
    const cache = new Map();
    for (let i = 0; i < c.L.length; i++) {
      const l = c.L[i];
      if (l === -1) continue;
      if (!cache.has(l)) cache.set(l, hexRGB(this.colorOf(l)));
      const [r, g, b] = cache.get(l), o = i * 4;
      im.data[o] = r; im.data[o + 1] = g; im.data[o + 2] = b; im.data[o + 3] = 255;
    }
    cx.putImageData(im, 0, 0);
    c.canvas = cv;
  }

  updateStatus() {
    const c = this.comp, st = this.st;
    if (!c || !c.bbox) { this.$('status').textContent = this.result ? 'Sin elementos visibles' : 'Abre una imagen o escribe un texto'; this.$('sizeInfo').textContent = ''; return; }
    const w = (c.bbox[2] - c.bbox[0]) / c.ppm, h = (c.bbox[3] - c.bbox[1]) / c.ppm;
    const used = new Set(); for (const l of c.L) if (l !== -1) used.add(l);
    this.$('sizeInfo').textContent = `Tamaño final: ${fmt(w)} × ${fmt(h)} mm`;
    let s = `Final: ${fmt(w)} × ${fmt(h)} mm · ${used.size} color(es) · ${st.elements.filter((e) => !e.hidden).length} elementos`;
    if (c.cake) s += c.pieces === 1 ? ' · ✅ una sola pieza de corte' : ` · ⚠️ ${c.pieces} piezas sueltas`;
    this.$('status').textContent = s;
  }

  changed(what) {
    if (what === 'regroup') this.regroup(false);
    this.compute();
    this.draw();
    this.syncInputs();
    this.commit();
  }

  // ------------------------------------------------------------------ view
  resize() {
    const r = this.$('viewWrap').getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    if (!this._fitted && this.comp) this.fit(); else this.draw();
  }
  fit() {
    const c = this.comp, dpr = window.devicePixelRatio || 1;
    const cw = this.canvas.width / dpr, ch = this.canvas.height / dpr;
    if (!c || !c.bbox || cw < 10) { this.draw(); return; }
    const [x0, y0, x1, y1] = c.bbox.map((v) => v / c.f);
    const w = x1 - x0, h = y1 - y0, pad = 40;
    this.view.s = Math.min((cw - pad * 2) / w, (ch - pad * 2) / h);
    this.view.tx = cw / 2 - (c.ox + x0 + w / 2) * this.view.s;
    this.view.ty = ch / 2 - (c.oy + y0 + h / 2) * this.view.s;
    this._fitted = true;
    this.draw();
  }
  toSrc(sx, sy) { return [(sx - this.view.tx) / this.view.s, (sy - this.view.ty) / this.view.s]; }
  draw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
  }
  _draw() {
    const ctx = this.ctx, dpr = window.devicePixelRatio || 1, W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#e9ebef'; ctx.fillRect(0, 0, W, H);
    const sz = 12 * dpr; ctx.fillStyle = '#f6f7f9';
    for (let y = 0; y < H; y += sz) for (let x = (y / sz) % 2 ? sz : 0; x < W; x += sz * 2) ctx.fillRect(x, y, sz, sz);
    this.$('drop').classList.toggle('hidden', !!this.st.source?.dataURL);
    const c = this.comp;
    if (!c) return;
    const v = this.view;
    ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.tx, dpr * v.ty);
    ctx.imageSmoothingEnabled = v.s / c.f < 2;
    if (this.drag?.moved) {
      // live preview while dragging: draw elements directly
      for (const e of this.st.elements) {
        if (e.hidden || !e.w) continue;
        const rr = this.elRender(e);
        if (!rr) continue;
        const [sx, sy] = this.shiftOf(e);
        ctx.save();
        ctx.translate(e.x + e.w / 2 + sx, e.y + e.h / 2 + sy); ctx.rotate((e.rot * Math.PI) / 180); ctx.scale(e.scale, e.scale);
        ctx.globalAlpha = 0.85;
        ctx.drawImage(rr.canvas, rr.x0 - e.w / 2, rr.y0 - e.h / 2, rr.w, rr.h);
        ctx.restore();
      }
    } else ctx.drawImage(c.canvas, c.ox, c.oy, c.W / c.f, c.H / c.f);
    if (this.showOriginal && this.srcImage && this.result) {
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.srcImage, 0, 0, this.result.width, this.result.height);
      ctx.globalAlpha = 1;
    }
    const px = 1 / v.s;
    for (const e of this.st.elements) {
      if (e.hidden || !e.w) continue;
      const q = this.elQuad(e), sel = e.id === this.sel, hov = e.id === this.hover;
      if (!sel && !hov) continue;
      ctx.beginPath(); q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.strokeStyle = sel ? '#2563eb' : '#f59e0b'; ctx.lineWidth = 1.5 * px; ctx.setLineDash([5 * px, 3 * px]); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  elementAt(x, y) {
    for (let k = this.st.elements.length - 1; k >= 0; k--) {
      const e = this.st.elements[k];
      if (e.hidden || !e.w) continue;
      const rr = this.elRender(e);
      if (!rr) continue;
      const [sx, sy] = this.shiftOf(e);
      const cx = e.x + e.w / 2 + sx, cy = e.y + e.h / 2 + sy, a = (-e.rot * Math.PI) / 180;
      const dx = x - cx, dy = y - cy;
      const u = (dx * Math.cos(a) - dy * Math.sin(a)) / e.scale + e.w / 2 - rr.x0, v = (dx * Math.sin(a) + dy * Math.cos(a)) / e.scale + e.h / 2 - rr.y0;
      if (u < 0 || v < 0 || u >= rr.w || v >= rr.h) continue;
      const src = rr.canvas, kx = src.width / rr.w, ky = src.height / rr.h;
      try { if (src.getContext('2d').getImageData(Math.floor(u * kx), Math.floor(v * ky), 1, 1).data[3] > 0) return e; } catch { /* ignore */ }
      // allow grabbing inside the box for thin shapes
      if (rr.w * e.scale * this.view.s < 60 || rr.h * e.scale * this.view.s < 60) return e;
    }
    return null;
  }

  bindCanvas() {
    const c = this.canvas;
    const local = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [sx, sy] = local(e), f = Math.exp(-e.deltaY * 0.0015);
      const ns = Math.min(80, Math.max(0.02, this.view.s * f)), k = ns / this.view.s;
      this.view.tx = sx - (sx - this.view.tx) * k; this.view.ty = sy - (sy - this.view.ty) * k; this.view.s = ns;
      this.draw();
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      if (!this.comp) return;
      c.setPointerCapture(e.pointerId);
      const [sx, sy] = local(e);
      if (e.button !== 0) { this.drag = { pan: true, sx, sy, tx: this.view.tx, ty: this.view.ty }; return; }
      const el = this.elementAt(...this.toSrc(sx, sy));
      this.sel = el ? el.id : null;
      this.renderElements();
      if (el) this.drag = { el, sx, sy, x: el.x, y: el.y, moved: false };
      this.draw();
    });
    c.addEventListener('pointermove', (e) => {
      const [sx, sy] = local(e);
      const d = this.drag;
      if (d?.pan) { this.view.tx = d.tx + sx - d.sx; this.view.ty = d.ty + sy - d.sy; this.draw(); return; }
      if (d?.el) {
        if (Math.hypot(sx - d.sx, sy - d.sy) > 3) d.moved = true;
        d.el.x = d.x + (sx - d.sx) / this.view.s; d.el.y = d.y + (sy - d.sy) / this.view.s;
        this.draw();
        return;
      }
      if (!this.comp) return;
      const el = this.elementAt(...this.toSrc(sx, sy));
      const h = el ? el.id : null;
      if (h !== this.hover) { this.hover = h; this.draw(); }
      c.style.cursor = el ? 'move' : 'default';
    });
    c.addEventListener('pointerup', () => {
      const d = this.drag;
      this.drag = null;
      if (d?.el && d.moved) this.changed(); else this.draw();
    });
  }

  // ------------------------------------------------------------------ elements panel
  selEl() { return this.st.elements.find((e) => e.id === this.sel) || null; }
  renderElements() {
    const st = this.st;
    this.$('elements').innerHTML = st.elements.map((e, i) => {
      const label = e.kind === 'text' ? `✍️ ${esc(String(e.text).split('\n')[0].slice(0, 22))}` : `🧩 Parte ${i + 1}`;
      const badge = e.thicken > 0 ? ` <small class="muted">+${fmt(e.thicken)} mm</small>` : '';
      return `<div class="st-el ${e.id === this.sel ? 'active' : ''} ${e.hidden ? 'off' : ''}" data-el="${e.id}"><span>${label}${badge}</span><button class="eye" data-ea="eye" title="Mostrar / ocultar">${e.hidden ? '◌' : '👁'}</button></div>`;
    }).join('') || '<div class="empty-note">Sin elementos</div>';
    const e = this.selEl();
    this.$('elProps').hidden = !e;
    if (!e) return;
    this.$('elText').hidden = e.kind !== 'text';
    const set = (k, v) => { const el = this.root.querySelector(`[data-e="${k}"]`); if (el !== document.activeElement) el.value = v; };
    set('scale', fmt(e.scale * 100)); set('rot', fmt(e.rot));
    set('thicken', fmt(e.thicken || 0)); set('spread', e.spread || 'auto');
    this.root.querySelector('[data-e="keepHoles"]').checked = e.keepHoles !== false;
    const sw = this.strokeMM(e), rr = e.thicken > 0 ? this.elRender(e) : null;
    let info = sw > 0 ? `Trazo fino actual: <b>${fmt(sw)} mm</b>` : '';
    if (sw > 0 && e.thicken > 0) info += ` → <b>${fmt(sw + 2 * e.thicken)} mm</b>`;
    if (rr) info += rr.spread ? ' · letras separadas para no pegarse' : ' · crece en su lugar';
    if (sw > 0 && sw + 2 * (e.thicken || 0) < 0.8) info += '<br>⚠️ Muy fino para imprimir en 3D (recomendado ≥ 0.8–1.2 mm).';
    this.$('strokeInfo').innerHTML = info;
    if (e.kind === 'text') {
      set('text', e.text);
      const fs = this.root.querySelector('[data-e="font"]');
      if (![...fs.options].some((o) => o.value === e.font)) fs.insertAdjacentHTML('beforeend', `<option>${esc(e.font)}</option>`);
      fs.value = e.font;
      this.root.querySelector('[data-e="color"]').innerHTML = st.palette.map((p, i) => `<option value="${i}">Color ${i + 1}</option>`).join('');
      this.root.querySelector('[data-e="color"]').value = String(e.color || 0);
    }
  }

  async addText() {
    const st = this.st;
    if (!this.result) { this.setSource('text'); return; }
    const font = st.mode === 'cakelaser' ? st.text.font : 'Lilita One';
    await ensureFont(font, 700);
    const lb = this.layoutBBox() || this.result.fgBBox;
    const id = Math.max(0, ...st.elements.map((e) => e.id)) + 1;
    const color = Math.max(0, st.palette.findIndex((p) => p.mode === 'keep'));
    const h0 = Math.max(40, (lb[3] - lb[1]) * 0.25);
    const e = { id, kind: 'text', text: 'Texto', font, weight: 700, color, x: lb[0], y: lb[3] + h0 * 0.2, w: 0, h: 0, scale: 1, rot: 0, hidden: false };
    st.elements.push(e);
    this.sel = id;
    const cv = this.elementCanvas(e);
    const wait = () => new Promise((r) => { const t = () => (cv.ready ? r() : setTimeout(t, 30)); t(); });
    await wait();
    e.scale = h0 / e.h;
    e.x = (lb[0] + lb[2]) / 2 - e.w / 2; e.y = lb[3] + h0 * 0.3 + (e.h * e.scale - e.h) / 2;
    this.changed();
  }
  reorder(dir) {
    const els = this.st.elements, i = els.findIndex((e) => e.id === this.sel);
    if (i < 0) return;
    const j = Math.max(0, Math.min(els.length - 1, i + dir));
    [els[i], els[j]] = [els[j], els[i]];
    this.changed();
  }
  centerSel() {
    const e = this.selEl();
    if (!e) return;
    const others = this.st.elements.filter((x) => x !== e && !x.hidden && x.w);
    let b = null;
    for (const o of others) for (const [x, y] of this.elQuad(o)) b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y];
    if (!b) return;
    e.x = (b[0] + b[2]) / 2 - e.w / 2;
    this.changed();
  }
  deleteSel() {
    const i = this.st.elements.findIndex((e) => e.id === this.sel);
    if (i < 0) return;
    this.st.elements.splice(i, 1);
    this.sel = null;
    this.changed();
  }

  paletteAction(i, act) {
    if (act === 'del') { this.st.palette[i].mode = this.st.palette[i].mode === 'transparent' ? 'keep' : 'transparent'; this.changed('regroup'); }
  }

  // ------------------------------------------------------------------ inputs
  syncInputs() {
    const st = this.st, r = this.root;
    this.$('title').textContent = st.mode === 'cakelaser' ? '· ✂️ Cake topper láser' : '· 🎨 Preparar logo';
    r.querySelectorAll('[data-only]').forEach((el) => { el.hidden = el.dataset.only !== st.mode; });
    r.querySelectorAll('[data-s]').forEach((el) => {
      if (el === document.activeElement && el.type === 'text') return;
      const v = getPath(st, el.dataset.s);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = typeof v === 'number' ? fmt(v) : v;
    });
    r.querySelectorAll('[data-when]').forEach((el) => { const [p, v] = el.dataset.when.split('='); el.hidden = String(getPath(st, p)) !== v; });
    r.querySelectorAll('[data-q]').forEach((el) => { el.value = String(st.quant[el.dataset.q] ?? 0); });
    r.querySelectorAll('[data-t]').forEach((el) => {
      if (el === document.activeElement) return;
      const v = st.text[el.dataset.t];
      if (el.dataset.t === 'font' && ![...el.options].some((o) => o.value === v)) el.insertAdjacentHTML('beforeend', `<option>${esc(v)}</option>`);
      el.value = String(v);
    });
    const kind = st.source?.kind || (st.mode === 'cakelaser' ? 'text' : 'image');
    r.querySelectorAll('[data-src]').forEach((b) => b.classList.toggle('active', b.dataset.src === kind));
    this.$('srcImage').hidden = kind !== 'image';
    this.$('srcText').hidden = kind !== 'text';
    this.$('widthLabel').textContent = st.mode === 'cakelaser' ? 'Ancho de las letras (mm)' : 'Ancho del logo (mm)';
    // palette
    this.$('palette').innerHTML = st.mode === 'cakelaser' ? '' : st.palette.map((p, i) => {
      const opts = [`<option value="keep">Usar</option>`, `<option value="transparent">Quitar (transparente)</option>`,
        ...st.palette.map((q, j) => (j !== i ? `<option value="m${j}">Unir con color ${j + 1}</option>` : '')).filter(Boolean)].join('');
      return `<div class="st-pal ${p.mode !== 'keep' ? 'off' : ''}" data-pal="${i}">
        <span class="num">${i + 1}</span>
        <span class="sw" style="background:${p.hex}" title="Color detectado ${p.hex}"></span>→
        <input type="color" value="${p.out}" title="Color final" />
        <select data-pm="mode">${opts}</select>
        <span class="h-wrap" title="Engrosar este color (mm)"><input type="text" inputmode="decimal" data-pm="thicken" value="${fmt(p.thicken || 0)}" /><span class="unit">mm</span></span>
      </div>`;
    }).join('');
    this.$('palette').querySelectorAll('[data-pal]').forEach((row) => {
      const p = st.palette[+row.dataset.pal];
      row.querySelector('select').value = p.mode === 'merge' ? 'm' + p.mergeTo : p.mode;
    });
    this.renderElements();
    this.updateStatus();
  }

  // ------------------------------------------------------------------ history & project
  serial() { return JSON.stringify(this.st); }
  commit() {
    const s = this.serial();
    if (this.hist[this.hidx] === s) return;
    this.hist = this.hist.slice(0, this.hidx + 1);
    this.hist.push(s);
    if (this.hist.length > 80) this.hist.shift();
    this.hidx = this.hist.length - 1;
  }
  async restoreState(json) {
    const s = JSON.parse(json);
    const needProc = JSON.stringify([s.source?.dataURL, s.quant]) !== JSON.stringify([this.st.source?.dataURL, this.st.quant]);
    const tKey = (x) => x.palette.map((p) => p.mode === 'transparent').join();
    const needGroup = tKey(s) !== tKey(this.st);
    this.st = s;
    if (needProc) {
      const els = s.elements, pal = s.palette;
      await this.reprocess(false, false, false);
      this.st.elements = els; this.st.palette = pal;
      this.regroup(false);
    } else if (needGroup) this.regroup(false);
    this.compute(); this.draw(); this.syncInputs();
  }
  async undo() { if (this.hidx > 0) { this.hidx--; await this.restoreState(this.hist[this.hidx]); } }
  async redo() { if (this.hidx < this.hist.length - 1) { this.hidx++; await this.restoreState(this.hist[this.hidx]); } }

  async saveProject() {
    if (!this.st.source) return;
    const data = JSON.stringify({ app: 'Relieve3D-Studio', version: 1, state: this.st });
    const p = await window.api.saveFile({ defaultPath: this.st.name + '.r3s', filters: [{ name: 'Proyecto Estudio 2D', extensions: ['r3s'] }], data });
    if (p) this.cb.toast('Proyecto guardado: ' + p);
  }
  async openProject(j) {
    if (j.app !== 'Relieve3D-Studio') throw new Error('No es un proyecto del estudio 2D');
    const s = { ...STUDIO_DEFAULTS(j.state.mode), ...j.state };
    this.root.hidden = false;
    this.st = s;
    this.hist = []; this.hidx = -1;
    const els = s.elements, pal = s.palette;
    for (const e of els) if (e.kind === 'text') await ensureFont(e.font, e.weight || 700);
    await this.reprocess(false, false, false);
    this.st.elements = els; this.st.palette = pal;
    this.regroup(false);
    this.compute(); this.fit(); this.syncInputs(); this.commit();
    this.cb.toast('Proyecto abierto');
  }

  // ------------------------------------------------------------------ exports
  // Stacked layers (bottom → top) as masks with colours; avoids seams between colours.
  layers() {
    const c = this.comp, st = this.st, N = c.W * c.H, L = c.L;
    const out = [];
    if (c.cake) {
      if (st.cake.double) {
        out.push({ name: 'Base', color: st.cake.baseColor, mask: Uint8Array.from(L, (v) => (v !== -1 ? 1 : 0)) });
        out.push({ name: 'Letras', color: st.cake.color, mask: Uint8Array.from(L, (v) => (v === 0 ? 1 : 0)) });
      } else out.push({ name: 'Topper', color: st.cake.color, mask: Uint8Array.from(L, (v) => (v === 0 ? 1 : 0)) });
      return out;
    }
    const all = Uint8Array.from(L, (v) => (v !== -1 ? 1 : 0));
    if (L.includes(SIL)) out.push({ name: 'Silueta', color: st.sil.color, mask: all });
    const inner = Uint8Array.from(L, (v) => (v !== -1 && v !== SIL ? 1 : 0));
    if (L.includes(BORDER)) out.push({ name: 'Bordeado', color: st.border.color, mask: inner });
    const counts = new Map();
    for (let i = 0; i < N; i++) if (L[i] >= 0 && L[i] < BORDER) counts.set(L[i], (counts.get(L[i]) || 0) + 1);
    const order = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
    order.forEach((k, n) => {
      const mask = n === 0 ? Uint8Array.from(L, (v) => (v >= 0 && v < BORDER ? 1 : 0)) : Uint8Array.from(L, (v) => (v === k ? 1 : 0));
      out.push({ name: `Color ${k + 1}`, color: st.palette[k].out, mask });
    });
    return out;
  }

  traced(mask) {
    const c = this.comp;
    return traceMask(mask, c.W, c.H, 0.6, 1, 0, 0, 1);
  }

  svgDoc(groups, bbox, cut) {
    const c = this.comp, k = 1 / c.ppm;
    const [x0, y0, x1, y1] = bbox;
    const W = (x1 - x0) * k, H = (y1 - y0) * k;
    const path = (shapes, dx = 0) => shapes.map((s) => [s.outer, ...s.holes].map((loop) => 'M' + loop.map(([x, y]) => `${fmt((x - x0) * k + dx)} ${fmt((y - y0) * k)}`).join(' L') + ' Z').join(' ')).join(' ');
    let body = '', totalW = W;
    groups.forEach((g, gi) => {
      const dx = g.dx || 0;
      totalW = Math.max(totalW, W + dx);
      const d = path(g.shapes, dx);
      body += cut
        ? `  <g id="${esc(g.name)}"><path d="${d}" fill="none" stroke="#FF0000" stroke-width="0.01" fill-rule="evenodd"/></g>\n`
        : `  <g id="${esc(g.name)}"><path d="${d}" fill="${g.color}" fill-rule="evenodd"/></g>\n`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(totalW)}mm" height="${fmt(H)}mm" viewBox="0 0 ${fmt(totalW)} ${fmt(H)}">\n${body}</svg>\n`;
  }

  async export(kind) {
    if (!this.comp?.bbox) { this.cb.toast('No hay diseño para exportar.'); return; }
    this.cb.showBusy('Generando archivo…');
    await nextFrame();
    try {
      const c = this.comp, name = this.st.name || 'diseño';
      const pad = 2 * c.ppm, bb = [c.bbox[0] - pad, c.bbox[1] - pad, c.bbox[2] + pad, c.bbox[3] + pad];
      let saved = null;
      if (kind === 'svg' || kind === 'svg-cut') {
        const layers = this.layers();
        const cut = kind === 'svg-cut';
        const groups = layers.map((l) => ({ name: l.name, color: l.color, shapes: this.traced(l.mask) }));
        // cut file for a double topper: pieces side by side so each layer can be cut from its own material
        if (cut && c.cake && this.st.cake.double) groups[1].dx = (bb[2] - bb[0]) / c.ppm + 10;
        saved = await window.api.saveFile({ defaultPath: `${name}${cut ? '_corte' : ''}.svg`, filters: [{ name: 'SVG', extensions: ['svg'] }], data: this.svgDoc(groups, bb, cut) });
      } else if (kind === 'png') {
        const scale = Math.max(1, 20 / c.ppm);            // ≈ 20 px/mm (508 ppp)
        const cv = document.createElement('canvas');
        cv.width = Math.ceil((bb[2] - bb[0]) * scale); cv.height = Math.ceil((bb[3] - bb[1]) * scale);
        const cx = cv.getContext('2d');
        cx.setTransform(scale, 0, 0, scale, -bb[0] * scale, -bb[1] * scale);
        for (const l of this.layers()) {
          const p = new Path2D();
          for (const s of this.traced(l.mask)) for (const loop of [s.outer, ...s.holes]) { p.moveTo(loop[0][0], loop[0][1]); for (const q of loop.slice(1)) p.lineTo(q[0], q[1]); p.closePath(); }
          cx.fillStyle = l.color; cx.fill(p, 'evenodd');
        }
        const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
        saved = await window.api.saveFile({ defaultPath: name + '.png', filters: [{ name: 'PNG', extensions: ['png'] }], data: new Uint8Array(await blob.arrayBuffer()) });
      }
      if (saved) this.cb.toast('Exportado: ' + saved);
    } catch (err) {
      console.error(err);
      this.cb.toast('Error al exportar: ' + err.message, true);
    } finally {
      this.cb.hideBusy();
    }
  }

  // Exact flat-colour PNG (transparent background) for the 3D modules.
  async sendTo3D(module) {
    const c = this.comp;
    if (!c?.bbox) { this.cb.toast('No hay diseño.'); return; }
    const [x0, y0, x1, y1] = c.bbox, pad = 4;
    const w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d'), im = cx.createImageData(w, h);
    const colors = new Set(), cache = new Map();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const l = c.L[y * c.W + x];
      if (l === -1) continue;
      if (!cache.has(l)) cache.set(l, this.colorOf(l));
      const hex = cache.get(l); colors.add(hex.toLowerCase());
      const [r, g, b] = hexRGB(hex), o = ((y - y0 + pad) * w + x - x0 + pad) * 4;
      im.data[o] = r; im.data[o + 1] = g; im.data[o + 2] = b; im.data[o + 3] = 255;
    }
    cx.putImageData(im, 0, 0);
    await this.cb.onSendTo3D({ dataURL: cv.toDataURL('image/png'), colors: colors.size, widthMM: Math.round(((x1 - x0) / c.ppm) * 10) / 10, name: (this.st.name || 'logo') + '.png', module, outlined: this.st.mode !== 'cakelaser' && this.st.sil.enabled });
  }
}

function getPath(o, p) { return p.split('.').reduce((a, k) => a?.[k], o); }
function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; }
