// Módulo «Soporte celular llavero»: llavero que se abre en soporte para el celular (bisagra impresa en su lugar).
// Formulario paramétrico → core/phonestand.js (manifold) → vista 3D (como se imprime, abierto con celular, de arriba)
// → 3MF por colores con la pausa del chip NFC, STL, foto PNG y proyecto .r3p.
import * as THREE from 'three';
import { parse as parseFont } from 'opentype.js';
import { Viewer3D } from './viewer3d.js';
import { imageReady } from './core/imageload.js';
import { ensureFont } from './core/text.js';
import { FontPicker } from './font_picker.js';
import { threeMF, stlBinary } from './core/exporters.js';
import {
  PHONESTAND_SHAPES, PHONESTAND_FONTS, DEFAULT_PHONESTAND, normalizePhoneStand, preparePhoneStand,
  buildPhoneStand, shapeThumbnails, phoneStandProject, readPhoneStandProject,
} from './core/phonestand.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const parseNum = (s) => parseFloat(String(s).trim().replace(',', '.'));
const getK = (o, k) => k.split('.').reduce((a, p) => a?.[p], o);
const setK = (o, k, v) => { const ps = k.split('.'); const last = ps.pop(); ps.reduce((a, p) => (a[p] ??= {}), o)[last] = v; };
// rAF is paused while the window is hidden/occluded: never wait more than 100 ms for it.
const nextFrame = () => new Promise((r) => { const t = setTimeout(r, 100); requestAnimationFrame(() => setTimeout(() => { clearTimeout(t); r(); }, 0)); });
const f1 = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
const D2R = Math.PI / 180;
const fileBase = (s) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/, '').trim() || 'soporte-celular';

const TABS = [['print', '🖨️ Como se imprime'], ['stand', '📱 Abierto con celular'], ['top', '⬆️ Vista de arriba']];
// camera azimuth / elevation (degrees) and how open the flap is when the tab is chosen
const VIEWS = { print: { az: -30, el: 46, amt: 0 }, stand: { az: 55, el: 16, amt: 1 }, top: { az: 0, el: 89.5, amt: 0 } };
// fields that change the outline of the shapes (thumbnails); colours, logo, text and extras do not
const OUTLINE_KEYS = ['shapeScale', 'width', 'thickness', 'flapLength', 'rail', 'frontBar', 'clearance', 'phoneAngle', 'ring'];

function readDataURL(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('no se pudo leer el archivo'));
    fr.readAsDataURL(file);
  });
}
// RGBA pixels (ImageData) at most `max` px on the long side; reuse the same object so the core's trace cache hits
async function imageDataFrom(src, max) {
  const img = new Image();
  img.src = src;
  try { await imageReady(img); } catch { throw new Error('la imagen está dañada o no es compatible'); }
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.naturalWidth * k));
  cv.height = Math.max(1, Math.round(img.naturalHeight * k));
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, cv.width, cv.height);
  return cx.getImageData(0, 0, cv.width, cv.height);
}
const isImageFile = (f) => /^image\//.test(f.type || '') || /\.(png|jpe?g|webp|bmp|gif|svg)$/i.test(f.name || '');

export class PhoneStandStudio {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.cfg = DEFAULT_PHONESTAND();
    this.logoSrc = null;    // dataURL of the client's logo (saved in the project)
    this.logoImg = null;    // its pixels
    this.logoName = '';
    this.shapeSrc = null;   // dataURL of the custom silhouette ("Tu silueta")
    this.shapeImg = null;
    this.shapeVer = 0;
    this.fonts = new Map(); // family → Promise<opentype font>
    this.res = null;        // last buildPhoneStand() result
    this.tab = 'print';
    this.amt = 0;           // 0 = closed (print position) … 1 = open (stand)
    this.seq = 0;
    this.building = false;
    this.engineReady = false;
    this.thumbs = null;
    this.thumbKey = '';
    this.build();
  }

  build() {
    const N = 'inputmode="decimal" type="text"';
    const tt = (title) => (title ? ` title="${esc(title)}"` : '');
    const num = (label, k, title = '') => `<label class="row"${tt(title)}>${label} <input ${N} data-k="${k}" /></label>`;
    const chk = (label, k, title = '') => `<label class="row"${tt(title)}>${label} <input type="checkbox" data-k="${k}" /></label>`;
    const sel = (label, k, opts, title = '') => `<label class="row"${tt(title)}>${label} <select data-k="${k}">${opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>`;
    const col = (label, k) => `<label class="row">${label} <input type="color" data-k="${k}" /></label>`;
    const fontOpts = Object.keys(PHONESTAND_FONTS).map((f) => `<option>${esc(f)}</option>`).join('');
    this.root.innerHTML = `
    <header class="topbar">
      <button class="btn" data-a="home">⌂ Inicio</button>
      <div class="brand"><span class="logo">◆</span> Relieve3D <span class="module-name">· 📱 Soporte celular llavero</span></div>
      <div class="tb-group">
        <button class="btn" data-a="logo" title="Logo o marca del cliente: PNG o JPG con fondo liso o transparente">🖼️ Logo</button>
        <button class="btn" data-a="openCfg" title="Abrir un proyecto .r3p">📂 Abrir</button>
        <button class="btn" data-a="saveCfg" title="Guarda las medidas, el logo y la silueta en un archivo .r3p">💾 Guardar proyecto</button>
        <button class="btn" data-a="reset" title="Vuelve a las medidas y opciones por defecto; conserva el logo y la silueta cargados">↺ Por defecto</button>
        <button class="btn" data-a="photo" title="PNG de la vista actual con fondo claro, para mostrarle el diseño al cliente">📸 Foto</button>
      </div>
      <div class="spacer"></div>
      <button class="btn" data-a="stl" title="Un solo STL con todas las piezas: un color y sin la pausa del NFC">⬇ STL</button>
      <button class="btn primary" data-a="3mf" title="3MF con los colores y la pausa para meter el chip NFC (Bambu Studio / OrcaSlicer)">⬇ Exportar 3MF</button>
    </header>
    <main class="layout studio-layout hb-layout ps-layout">
      <aside class="panel left">
        <section class="card">
          <h3>❤️ Forma de arriba</h3>
          <div class="ps-shapes" data-r="shapes"></div>
          ${num('Tamaño de la forma (%)', 'shapeScale', 'De 70 a 140 %: agrándala para que quepan el logo, el chip NFC o el abre latas')}
          <div data-show="custom">
            <button class="btn wide" data-a="shapeFile">⬆ Cambiar silueta (PNG/JPG)</button>
            <div class="muted small">Silueta oscura sobre fondo claro, o PNG transparente. Se une al cuerpo por abajo y se le abre el agujero de la argolla.</div>
          </div>
        </section>
        <section class="card">
          <h3>🏷️ Logo o marca del cliente</h3>
          <div class="ps-logo" data-r="logoBox"></div>
          <button class="btn wide" data-a="logo">🖼️ Cargar logo (PNG/JPG)</button>
          ${chk('Poner el logo', 'logo.enabled')}
          <div data-show="logo">
            ${sel('Dónde', 'logo.where', [['top', 'En la forma de arriba'], ['flap', 'En la tapa']], 'La tapa es la cara grande del llavero cerrado; la forma de arriba es la parte decorativa')}
            ${num('Tamaño (%)', 'logo.size', '100 % = lo más grande que cabe. Con más de 100 % se recorta en el borde')}
            ${num('Mover a la derecha (mm)', 'logo.dx', 'Negativo = hacia la izquierda')}
            ${num('Mover hacia arriba (mm)', 'logo.dy', 'Negativo = hacia abajo')}
            <details class="ps-adv"><summary>Vectorizado del logo</summary>
              ${num('Trazo mínimo (mm)', 'logo.minFeature', 'Las partes más delgadas se quitan y los huecos más angostos se cierran, para que se imprima bien')}
              ${num('Tolerancia del fondo', 'logo.tolerance', 'De 5 a 120: qué tan distinto del fondo debe ser un color para contar como logo')}
              ${chk('Usar las partes claras', 'logo.invert', 'Para logos claros sobre fondo oscuro')}
            </details>
          </div>
        </section>
        <section class="card">
          <h3>✍️ Texto o nombre</h3>
          ${chk('Agregar texto', 'text.enabled', 'Nombre de la marca, de la persona o una frase corta (máximo 40 letras)')}
          <div data-show="text">
            <label class="row">Texto <input type="text" data-k="text.value" maxlength="40" placeholder="Ej.: Pabonitas" /></label>
            ${sel('Dónde', 'text.where', [['flap', 'En la tapa'], ['top', 'En la forma de arriba']])}
            <label class="row">Fuente <select data-k="text.font">${fontOpts}</select></label>
            <div data-show="textSize">${num('Tamaño (%)', 'text.size', '100 % = lo más grande que cabe')}</div>
            <div data-show="textRel">${num('Alto de letra (% del logo)', 'text.rel', 'El texto va debajo del logo, con esta altura de letra')}</div>
          </div>
        </section>
        <section class="card">
          <h3>🎨 Acabado y colores</h3>
          ${sel('Logo y texto', 'logo.mode', [['relief', 'En relieve (sobresale)'], ['inlay', 'Incrustado a ras (2 colores)'], ['engrave', 'Grabado (hundido)']], 'Incrustado: queda liso, al ras, en el 2.º color. Grabado: hundido en la pieza')}
          <div data-show="relief">${num('Alto del relieve (mm)', 'logo.height')}</div>
          <div data-show="sunk">${num('Profundidad (mm)', 'logo.depth')}</div>
          ${col('Color del cuerpo', 'colors.body')}
          ${col('Color del logo / acento', 'colors.accent')}
          ${chk('Logo y texto en el 2.º color', 'colors.twoColor', 'Necesita cambio de filamento (AMS) o una pausa para cambiar el color')}
          ${chk('Tapa en el 2.º color', 'colors.flapAccent')}
        </section>
      </aside>

      <section class="center">
        <div class="hb-tabs seg" data-r="tabs">${TABS.map(([k, l]) => `<button class="seg-btn" data-tab="${k}">${l}</button>`).join('')}
          <span class="spacer"></span>
          <label class="cs-explode" title="Mueve la tapa para ver cómo gira en la bisagra">Abrir tapa <input type="range" min="0" max="1" step="0.01" value="0" data-r="amt" /></label>
          <button class="btn mini" data-a="animate" title="Mira cómo se abre la tapa">▶ Animar</button>
        </div>
        <div class="views mode-3d"><div class="view dark" data-r="view"></div></div>
        <div class="statusbar"><span data-r="status"></span><span class="spacer"></span><span data-r="time"></span></div>
      </section>

      <aside class="panel right">
        <section class="card">
          <h3>✨ Extras</h3>
          ${chk('📶 Chip NFC escondido', 'nfc.enabled', 'Bolsillo cerrado: la impresora hace una pausa, metes el sticker NFC redondo y la impresión lo tapa')}
          <div data-show="nfc">
            ${num('Diámetro del chip (mm)', 'nfc.diameter', 'Los stickers NFC redondos (NTAG213/215) miden 25 mm: deja 0,5 mm de juego')}
            ${num('Grosor del chip (mm)', 'nfc.depth', 'Se redondea a capas de 0,2 mm')}
            ${sel('Dónde', 'nfc.where', [['auto', 'Automático'], ['top', 'En la forma de arriba'], ['flap', 'En la tapa']])}
          </div>
          ${chk('🥫 Abre latas', 'opener.enabled', 'Ranura en un borde: mete la pestaña de la lata y haz palanca')}
          <div data-show="opener">${sel('Lado', 'opener.side', [['right', 'Derecho'], ['left', 'Izquierdo']])}</div>
          ${chk('🔑 Agujero para la argolla', 'ring.enabled')}
          <div data-show="ring">${num('Diámetro del agujero (mm)', 'ring.diameter')}</div>
        </section>
        <section class="card">
          <h3>📏 Medidas</h3>
          <label class="row">Nombre <input type="text" data-k="name" maxlength="60" /></label>
          ${num('Ancho (mm)', 'width', 'De 38 a 60 mm')}
          ${num('Grosor (mm)', 'thickness', 'De 6 a 10 mm: más grueso = bisagra más fuerte')}
          ${num('Largo de la tapa (mm)', 'flapLength', 'De 22 a 40 mm: más larga = el celular se apoya más alto')}
          ${num('Inclinación del celular (°)', 'phoneAngle', 'De 50° (más acostado) a 75° (más parado), medido desde la mesa')}
          ${num('Holgura de la bisagra (mm)', 'clearance', 'Juego entre la tapa y el cuerpo. 0,4 mm sirve en la mayoría de impresoras; si la tapa sale pegada súbela a 0,5; si queda floja bájala a 0,3')}
          <details class="ps-adv"><summary>Avanzado</summary>
            ${num('Rieles laterales (mm)', 'rail', 'Ancho de los rieles a cada lado de la tapa')}
            ${num('Barra delantera (mm)', 'frontBar', 'Barra delante de la tapa')}
            ${num('Radio del pasador (mm)', 'pin', 'Se limita solo según el grosor')}
            ${num('Topes del celular (mm)', 'ridge', 'Alto de los topes que evitan que el celular se resbale')}
            ${num('Pared de la argolla (mm)', 'ring.wall', 'Material mínimo alrededor del agujero de la argolla')}
          </details>
        </section>
        <section class="card grow">
          <h3>✅ Resultado</h3>
          <div class="hb-warn" data-r="warn"></div>
          <div class="hb-list small" data-r="list"></div>
          <div class="ps-tip muted small">🖨️ PLA · capas de 0,2 mm · <b>sin soportes</b> · imprímelo acostado tal como sale: la bisagra sale armada. Al terminar, dobla la tapa con cuidado para soltarla.<span data-show="nfc"> 📶 En la pausa mete el chip y dale continuar.</span></div>
        </section>
      </aside>
    </main>
    <input type="file" data-r="fileLogo" accept="image/*" hidden />
    <input type="file" data-r="fileShape" accept="image/*" hidden />
    <input type="file" data-r="fileCfg" accept=".r3p,.json" hidden />`;
    this.$ = (n) => this.root.querySelector(`[data-r="${n}"]`);
    this.picker = new FontPicker(this.root.querySelector('[data-k="text.font"]'), {
      sample: () => ({ text: this.cfg.text.value || 'Tu marca', weight: 400 }), label: 'Fuente del texto', onError: this.cb.toast,
      loadFont: (family) => ensureFont(family, 400, { file: PHONESTAND_FONTS[family] }),
    });
    this.renderShapes();
    this.bind();
  }

  bind() {
    const r = this.root;
    r.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]')?.dataset.tab;
      if (tab) { this.setTab(tab); return; }
      const shape = e.target.closest('[data-shape]')?.dataset.shape;
      if (shape) { this.pickShape(shape); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'home') { this.stopAnim(); this.cb.onBack(); }
      else if (a === 'logo') this.$('fileLogo').click();
      else if (a === 'clearLogo') this.clearLogo();
      else if (a === 'shapeFile') this.$('fileShape').click();
      else if (a === 'openCfg') this.$('fileCfg').click();
      else if (a === 'saveCfg') this.saveProject();
      else if (a === 'reset') this.reset();
      else if (a === 'photo') this.photo();
      else if (a === 'stl') this.exportSTL();
      else if (a === '3mf') this.export3MF();
      else if (a === 'animate') this.animate();
    });
    const onInput = (e) => {
      const el = e.target;
      if (el.dataset.r === 'amt') { this.stopAnim(); this.setAmt(+el.value); return; }
      const k = el.dataset.k;
      if (!k) return;
      const decimal = el.getAttribute('inputmode') === 'decimal';
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (decimal) { v = parseNum(el.value); if (!Number.isFinite(v)) return; }
      else v = el.value;
      const prev = getK(this.cfg, k);
      setK(this.cfg, k, v);
      // on leaving a number field show the value really used (limited to its range)
      if (decimal && e.type === 'change') { const nv = getK(normalizePhoneStand(this.cfg), k); setK(this.cfg, k, nv); el.value = String(nv); }
      if (getK(this.cfg, k) === prev) return;
      if (k === 'name') return;   // only names the exported files
      if (k === 'colors.body' || k === 'colors.accent') { this.recolor(); return; }
      if (k === 'text.value') this.picker.sync();
      this.updateVisibility();
      this.schedule();
    };
    r.addEventListener('input', onInput);
    r.addEventListener('change', onInput);
    this.$('fileLogo').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await this.loadLogo(f); });
    this.$('fileShape').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await this.loadShape(f); });
    this.$('fileCfg').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { await this.openProject(await f.text()); } catch (err) { this.cb.toast('No se pudo abrir el proyecto: ' + err.message, true); }
    });
  }

  async open() {
    this.root.hidden = false;
    this.sync();
    if (!this.viewer) this.viewer = new Viewer3D(this.$('view'));
    this.viewer.resize();
    if (!this.engineReady) {
      this.cb.showBusy('Preparando el motor 3D…');
      try {
        await preparePhoneStand();
        this.engineReady = true;
      } catch (err) {
        console.error(err);
        this.cb.toast('No se pudo cargar el motor 3D: ' + err.message, true);
        return;
      } finally { this.cb.hideBusy(); }
    }
    if (!this.res) {
      this.cb.showBusy('Generando el soporte…');
      try { await this.rebuild(); } finally { this.cb.hideBusy(); }
    } else this.applyView(true);
  }

  // ------------------------------------------------------------------ form <-> cfg
  sync() {
    const c = this.cfg;
    for (const el of this.root.querySelectorAll('[data-k]')) {
      const v = getK(c, el.dataset.k);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v ?? '';
    }
    this.picker.sync();
    this.root.style.setProperty('--ps-accent', c.colors.accent);
    this.renderLogoBox();
    this.markShape();
    this.updateVisibility();
  }

  updateVisibility() {
    const c = this.cfg;
    const share = c.logo.enabled && !!this.logoImg && c.text.enabled && c.logo.where === c.text.where;
    const show = {
      custom: c.shape === 'custom', logo: c.logo.enabled, text: c.text.enabled, textRel: share, textSize: !share,
      relief: c.logo.mode === 'relief', sunk: c.logo.mode !== 'relief', nfc: c.nfc.enabled, opener: c.opener.enabled, ring: c.ring.enabled,
    };
    for (const el of this.root.querySelectorAll('[data-show]')) el.hidden = !show[el.dataset.show];
  }

  renderLogoBox() {
    this.$('logoBox').innerHTML = this.logoSrc
      ? `<img src="${esc(this.logoSrc)}" alt="logo" /><span class="muted small" title="${esc(this.logoName)}">${esc(this.logoName || 'Logo')}</span><button class="btn mini" data-a="clearLogo" title="Quitar el logo">✕</button>`
      : '<span class="muted small">Sin logo: carga el PNG o JPG del cliente (fondo liso o transparente). También puedes arrastrarlo aquí.</span>';
  }

  // shape buttons with a live outline of each shape (window and key-ring hole included)
  renderShapes() {
    if (this.engineReady) {
      const n = normalizePhoneStand(this.cfg);
      const key = JSON.stringify([OUTLINE_KEYS.map((k) => n[k]), this.shapeVer]);
      if (key !== this.thumbKey) {
        try { this.thumbs = shapeThumbnails(n, { shapeImage: this.shapeImg }); this.thumbKey = key; } catch (err) { console.warn('miniaturas', err); }
      } else if (this.$('shapes').childElementCount) { this.markShape(); return; }
    }
    const t = this.thumbs || {};
    this.$('shapes').innerHTML = PHONESTAND_SHAPES.map((s) => {
      const th = t[s.id];
      const art = s.id === 'custom' && (!th || th.custom) ? '<span class="ps-up">⬆</span>'
        : th ? `<svg viewBox="${th.viewBox}" preserveAspectRatio="xMidYMid meet"><path d="${th.d}" fill-rule="evenodd"/></svg>` : '<span class="ps-up ps-wait">…</span>';
      return `<button class="ps-shape" data-shape="${s.id}" title="${esc(s.id === 'custom' ? 'Tu silueta: sube una imagen con la forma que quieras' : s.name)}">${art}<span>${esc(s.name)}</span></button>`;
    }).join('');
    this.markShape();
  }

  markShape() {
    for (const b of this.root.querySelectorAll('[data-shape]')) b.classList.toggle('active', b.dataset.shape === this.cfg.shape);
  }

  pickShape(id) {
    if (id === 'custom' && !this.shapeImg) { this.$('fileShape').click(); return; }
    if (this.cfg.shape === id) return;
    this.cfg.shape = id;
    this.markShape();
    this.updateVisibility();
    this.schedule();
  }

  reset() {
    this.stopAnim();
    this.cfg = DEFAULT_PHONESTAND();
    this.sync();
    this.schedule();
    this.cb.toast('Valores por defecto (se conservan el logo y la silueta)');
  }

  // ------------------------------------------------------------------ build
  schedule() {
    clearTimeout(this._t);
    this._t = setTimeout(() => { this._t = null; this.rebuild(); }, 250);
  }

  // resolves when no rebuild is pending or running (exports and tests use the latest model)
  async whenIdle() {
    if (this._t) { clearTimeout(this._t); this._t = null; await this.rebuild(); }
    while (this.building) await new Promise((r) => setTimeout(r, 30));
  }

  async textFont() {
    const t = this.cfg.text;
    if (!t.enabled || !String(t.value || '').trim()) return null;
    const fam = PHONESTAND_FONTS[t.font] ? t.font : DEFAULT_PHONESTAND().text.font;
    if (!this.fonts.has(fam)) {
      this.fonts.set(fam, fetch('fonts/' + PHONESTAND_FONTS[fam])
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
        .then((buf) => parseFont(buf)));
    }
    try { return await this.fonts.get(fam); } catch (err) {
      console.warn('fuente', fam, err);
      this.fonts.delete(fam);
      return null;   // the core warns that the text was left out
    }
  }

  async rebuild() {
    clearTimeout(this._t); this._t = null;
    const my = ++this.seq;
    this.building = true;
    this.$('status').textContent = '⏳ Generando…';
    try {
      await preparePhoneStand();
      this.engineReady = true;
      const font = await this.textFont();
      await nextFrame();
      if (my !== this.seq) return;
      const t0 = performance.now();
      this.renderShapes();
      const res = buildPhoneStand(this.cfg, { logoImage: this.logoImg, shapeImage: this.shapeImg, font });
      for (const p of res.parts) { p.openGeometry?.dispose(); delete p.openGeometry; }   // the view turns the flap itself
      this.res = res;
      this.$('time').textContent = `${Math.round(performance.now() - t0)} ms`;
      this.renderInfo();
      this.render3D();
    } catch (err) {
      console.error(err);
      if (my === this.seq) {
        this.$('status').textContent = '⚠ No se pudo generar';
        this.cb.toast('No se pudo generar el soporte: ' + err.message, true);
      }
    } finally {
      if (my === this.seq) this.building = false;
    }
  }

  renderInfo() {
    const res = this.res;
    if (!res) return;
    const i = res.info, c = this.cfg.colors;
    this.$('warn').innerHTML = res.warnings.length
      ? res.warnings.map((w) => `<div class="hb-w">⚠ ${esc(w)}</div>`).join('')
      : '<div class="hb-ok">✓ Listo para imprimir: sin soportes y con la bisagra armada.</div>';
    const sw = (color) => `<span class="sw" style="background:${esc(color)}"></span>`;
    const row = (k, v) => `<div class="hb-pc"><span>${k}</span><span class="muted">${v}</span></div>`;
    const shapeName = PHONESTAND_SHAPES.find((s) => s.id === i.shape.id)?.name || i.shape.id;
    const fils = [...new Set(res.parts.map((p) => p.filamentIndex))].sort();
    const where = (w) => (w === 'top' ? 'en la forma' : 'en la tapa');
    let h = row('Forma', esc(shapeName));
    h += row('Medidas', `${f1(i.size.w)} × ${f1(i.size.l)} × ${f1(i.size.h)} mm`);
    h += row('Peso aprox.', `${f1(i.grams)} g de PLA`);
    h += row('Filamentos', `${fils.length} ${fils.map((f) => sw(f ? c.accent : c.body)).join('')}`);
    h += row('Celular', `inclinado ${f1(i.phoneAngle)}° · apoyo a ${f1(i.supportHeight)} mm`);
    h += row('Estabilidad', `vertical ${i.stability.portrait >= 0 ? '✓' : '⚠ puede voltearse'} · horizontal ${i.stability.landscape >= 0 ? '✓' : '⚠'}`);
    h += row('Bisagra', `pasador Ø${f1(i.hinge.pinDiameter)} mm · holgura ${f1(i.hinge.clearance)} mm`);
    if (i.ring) h += row('Argolla', `agujero Ø${f1(2 * i.ring.r)} mm`);
    if (i.nfc) h += row('Chip NFC', `${where(i.nfc.where)} · Ø${f1(2 * i.nfc.r)} mm · pausa a Z = ${f1(i.nfc.z1)} mm`);
    if (i.opener) h += row('Abre latas', `lado ${i.opener.side === 'left' ? 'izquierdo' : 'derecho'}${i.opener.angle ? ` · girado ${i.opener.angle}°` : ''}`);
    for (const w of ['top', 'flap']) {
      const a = i.art[w];
      if (a) h += row(a.logo && a.text ? 'Logo y texto' : a.logo ? 'Logo' : 'Texto', `${f1(a.w)} × ${f1(a.h)} mm ${where(w)}`);
    }
    h += '<h4>Piezas del 3MF</h4>';
    h += res.parts.map((p) => `<div class="hb-pc"><span>${sw(p.color)} ${esc(p.name)}</span><span class="muted">filamento ${p.filamentIndex + 1}</span></div>`).join('');
    this.$('list').innerHTML = h;
    this.$('status').textContent = `${shapeName} · ${f1(i.size.w)} × ${f1(i.size.l)} × ${f1(i.size.h)} mm · ${f1(i.grams)} g${res.warnings.length ? ` · ⚠ ${res.warnings.length} aviso(s)` : ''}`;
  }

  // colour pickers only repaint (no rebuild): filament 0 = body colour, 1 = accent
  recolor() {
    const c = this.cfg.colors;
    this.root.style.setProperty('--ps-accent', c.accent);
    if (!this.res) return;
    this.res.parts.forEach((p, i) => {
      p.color = p.filamentIndex ? c.accent : c.body;
      this.viewer?.meshes.get('p' + i)?.material.color.set(p.color);
    });
    this.viewer?.requestRender();
    this.renderInfo();
  }

  // ------------------------------------------------------------------ 3D view
  render3D() {
    const v = this.viewer, res = this.res;
    if (!v || !res) return;
    if (this.pivot) { v.model.remove(this.pivot); this.pivot = null; }
    v.clear();
    // the flap and its logo turn about the hinge axis (X through y = axis.y, z = axis.z)
    const { axis } = res;
    const pivot = new THREE.Group();
    pivot.position.set(0, axis.y, axis.z);
    v.model.add(pivot);
    this.pivot = pivot;
    res.parts.forEach((p, i) => {
      const m = v.addPiece('p' + i, p.geometry);
      v.updatePiece('p' + i, { color: p.color, height: 1, z: 0, visible: true });
      if (p.moving) { v.model.remove(m); m.position.set(0, -axis.y, -axis.z); pivot.add(m); }
    });
    v.setExtra('phone', res.phone, { color: '#1f2937' });
    const ph = v.extras.get('phone');
    Object.assign(ph.material, { transparent: true, opacity: 0.5, depthWrite: false, roughness: 0.25 });
    ph.material.needsUpdate = true;
    // centre the closed keychain on the grid
    const b = new THREE.Box3();
    for (const p of res.parts) { p.geometry.computeBoundingBox(); b.union(p.geometry.boundingBox); }
    v.model.position.set(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, 0);
    this.applyView(!this.framed);
    this.framed = true;
  }

  applyView(fit) {
    for (const b of this.root.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === this.tab);
    this.setAmt(this.amt);
    if (fit) this.fit();
  }

  setTab(tab) {
    if (!VIEWS[tab]) return;
    this.stopAnim();
    this.tab = tab;
    this.amt = VIEWS[tab].amt;
    this.applyView(true);
  }

  setAmt(a) {
    this.amt = Math.max(0, Math.min(1, +a || 0));
    this.$('amt').value = String(this.amt);
    if (!this.res || !this.pivot) return;
    this.pivot.rotation.x = -this.amt * this.res.info.thetaOpen * D2R;
    const ph = this.viewer.extras.get('phone');
    if (ph) ph.visible = this.tab === 'stand' && this.amt > 0.999;
    this.viewer.requestRender();
  }

  // camera at the tab's azimuth/elevation, far enough to see every visible piece (the phone too)
  fit() {
    const v = this.viewer, view = VIEWS[this.tab];
    if (!v) return;
    v.scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const m of [...v.meshes.values(), ...v.extras.values()]) if (m.visible) box.expandByObject(m);
    if (box.isEmpty()) return;
    const s = box.getBoundingSphere(new THREE.Sphere());
    const vHalf = (v.camera.fov / 2) * D2R, hHalf = Math.atan(Math.tan(vHalf) * v.camera.aspect);
    const dist = (s.radius / Math.sin(Math.min(vHalf, hHalf))) * 0.95;
    const az = view.az * D2R, el = view.el * D2R;
    v.controls.target.copy(s.center);
    v.camera.position.set(s.center.x + dist * Math.cos(el) * Math.sin(az), s.center.y + dist * Math.sin(el), s.center.z + dist * Math.cos(el) * Math.cos(az));
    v.camera.near = dist / 100;
    v.camera.far = dist * 20;
    v.camera.updateProjectionMatrix();
    v.controls.update();
    v.requestRender();
  }

  animate() {
    this.stopAnim();
    if (!this.res) return;
    const from = this.amt > 0.999 ? 0 : this.amt, t0 = performance.now(), dur = 300 + 1300 * (1 - from);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.setAmt(from + (1 - from) * e);
      this.anim = k < 1 ? requestAnimationFrame(step) : null;
    };
    this.anim = requestAnimationFrame(step);
  }

  stopAnim() {
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = null;
  }

  // ------------------------------------------------------------------ images
  async loadLogo(file) {
    if (!isImageFile(file)) { this.cb.toast('El logo debe ser una imagen (PNG o JPG).', true); return false; }
    try {
      const src = await readDataURL(file);
      const img = await imageDataFrom(src, 1000);
      this.logoSrc = src;
      this.logoImg = img;
      this.logoName = file.name || 'Logo';
      this.cfg.logo.enabled = true;
      this.sync();
      await this.rebuild();
      this.cb.toast('✓ Logo cargado');
      return true;
    } catch (err) {
      console.error(err);
      this.cb.toast('No se pudo leer el logo: ' + err.message, true);
      return false;
    }
  }

  clearLogo() {
    this.logoSrc = null;
    this.logoImg = null;
    this.logoName = '';
    this.renderLogoBox();
    this.updateVisibility();
    this.schedule();
  }

  async loadShape(file) {
    if (!isImageFile(file)) { this.cb.toast('La silueta debe ser una imagen (PNG o JPG).', true); return false; }
    try {
      const src = await readDataURL(file);
      const img = await imageDataFrom(src, 800);
      this.shapeSrc = src;
      this.shapeImg = img;
      this.shapeVer++;
      this.cfg.shape = 'custom';
      this.markShape();
      this.updateVisibility();
      await this.rebuild();
      return true;
    } catch (err) {
      console.error(err);
      this.cb.toast('No se pudo leer la silueta: ' + err.message, true);
      return false;
    }
  }

  // ------------------------------------------------------------------ files
  async ready() {
    await this.whenIdle();
    if (!this.res) { this.cb.toast('Todavía no hay un soporte generado.', true); return false; }
    return true;
  }

  async export3MF() {
    if (!(await this.ready())) return null;
    const res = this.res, name = this.cfg.name || 'Soporte celular';
    this.cb.showBusy('Generando 3MF…');
    await nextFrame();
    try {
      const parts = res.parts.map(({ name: n, color, filamentIndex, geometry }) => ({ name: n, color, filamentIndex, geometry }));
      const data = threeMF(parts, name, { pauses: res.pauses });
      const p = await window.api.saveFile({ defaultPath: fileBase(name) + '.3mf', filters: [{ name: '3MF', extensions: ['3mf'] }], data });
      if (p) this.cb.toast(`✓ 3MF guardado${res.pauses.length ? ` · pausa para el chip NFC a Z = ${f1(res.pauses[0].z)} mm` : ''}`);
      return p;
    } catch (err) {
      console.error(err);
      this.cb.toast('Error al exportar: ' + err.message, true);
      return null;
    } finally { this.cb.hideBusy(); }
  }

  async exportSTL() {
    if (!(await this.ready())) return null;
    const res = this.res, name = this.cfg.name || 'Soporte celular';
    try {
      const data = stlBinary(res.parts.map((p) => p.geometry));
      const p = await window.api.saveFile({ defaultPath: fileBase(name) + '.stl', filters: [{ name: 'STL', extensions: ['stl'] }], data });
      if (p) this.cb.toast(`✓ STL guardado (un solo color${res.pauses.length ? `; agrega a mano la pausa del chip NFC a Z = ${f1(res.pauses[0].z)} mm` : ''})`);
      return p;
    } catch (err) {
      console.error(err);
      this.cb.toast('Error al exportar: ' + err.message, true);
      return null;
    }
  }

  // PNG of the current view on a light background (to show the client)
  async photo() {
    if (!(await this.ready()) || !this.viewer) return null;
    const v = this.viewer, old = { bg: v.scene.background, grid: v.grid.visible };
    let url;
    try {
      v.scene.background = new THREE.Color(0xf3f4f6);
      v.grid.visible = false;
      url = v.snapshot();
    } finally {
      v.scene.background = old.bg;
      v.grid.visible = old.grid;
      v.requestRender();
    }
    const bin = atob(url.split(',')[1]), data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    const p = await window.api.saveFile({ defaultPath: fileBase(this.cfg.name) + '.png', filters: [{ name: 'Imagen PNG', extensions: ['png'] }], data });
    if (p) this.cb.toast('✓ Foto guardada');
    return p;
  }

  async saveProject() {
    const data = phoneStandProject(this.cfg, { logoSrc: this.logoSrc, shapeSrc: this.shapeSrc });
    const p = await window.api.saveFile({ defaultPath: fileBase(this.cfg.name) + '.r3p', filters: [{ name: 'Proyecto soporte celular', extensions: ['r3p'] }], data });
    if (p) this.cb.toast('✓ Proyecto guardado');
    return p;
  }

  // j: parsed project object or its JSON text; throws (in Spanish) when it is not a phone-stand project
  async openProject(j) {
    const p = readPhoneStandProject(j);
    const [logoImg, shapeImg] = await Promise.all([
      p.logoSrc ? imageDataFrom(p.logoSrc, 1000) : null,
      p.shapeSrc ? imageDataFrom(p.shapeSrc, 800) : null,
    ]);
    this.stopAnim();
    this.cfg = p.cfg;
    this.logoSrc = p.logoSrc;
    this.logoImg = logoImg;
    this.logoName = p.logoSrc ? 'Logo del proyecto' : '';
    this.shapeSrc = p.shapeSrc;
    this.shapeImg = shapeImg;
    this.shapeVer++;
    this.res = null;
    this.tab = 'print';
    this.amt = 0;
    this.framed = false;
    await this.open();
    this.cb.toast('✓ Proyecto abierto');
  }
}
