// Módulo «Hablador acrílico»: despiece para corte láser (acrílico blanco + negro) a partir de un mockup.
// Formulario paramétrico → core/hablador.js → vista previa del ensamble, láminas de corte, plantilla e impresión UV.
import { parse as parseFont } from 'opentype.js';
import { HABLADOR_FONTS, DEFAULT_HABLADOR, buildHablador, exportAll, summary, traceLogo, MATERIALS } from './core/hablador.js';
import { imageReady } from './core/imageload.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const parseNum = (s) => parseFloat(String(s).trim().replace(',', '.'));
const getK = (o, k) => k.split('.').reduce((a, p) => a?.[p], o);
const setK = (o, k, v) => { const ps = k.split('.'); const last = ps.pop(); ps.reduce((a, p) => (a[p] ??= {}), o)[last] = v; };
const nextFrame = () => new Promise((r) => { const t = setTimeout(r, 100); requestAnimationFrame(() => setTimeout(() => { clearTimeout(t); r(); }, 0)); });

const TABS = [
  ['assembly', 'Ensamble'], ['white', 'Corte blanco'], ['black', 'Corte negro'], ['jig', 'Plantilla'], ['print', 'Impresión UV'], ['mockup', 'Mockup'],
];

export class HabladorStudio {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.cfg = DEFAULT_HABLADOR();
    this.fonts = null;
    this.model = null;
    this.files = [];
    this.tab = 'assembly';
    this.mockup = null;     // dataURL of the reference image
    this.logoSrc = null;    // dataURL of the logo image (re-traced when options change)
    this.build();
  }

  build() {
    const N = 'inputmode="decimal" type="text"';
    const fontOpts = Object.keys(HABLADOR_FONTS).map((f) => `<option>${esc(f)}</option>`).join('');
    const num = (label, k, title = '') => `<label class="row"${title ? ` title="${esc(title)}"` : ''}>${label} <input ${N} data-k="${k}" /></label>`;
    const chk = (label, k, title = '') => `<label class="row"${title ? ` title="${esc(title)}"` : ''}>${label} <input type="checkbox" data-k="${k}" /></label>`;
    const txt = (label, k) => `<label class="row">${label} <input type="text" data-k="${k}" /></label>`;
    const font = (k) => `<label class="row">Fuente <select data-k="${k}">${fontOpts}</select></label>`;
    this.root.innerHTML = `
    <header class="topbar">
      <button class="btn" data-a="home">⌂ Inicio</button>
      <div class="brand"><span class="logo">◆</span> Relieve3D <span class="module-name">· 🪧 Hablador acrílico</span></div>
      <div class="tb-group">
        <button class="btn" data-a="mockup" title="Imagen de referencia del hablador (solo para comparar)">🖼️ Cargar mockup</button>
        <button class="btn" data-a="openCfg">📂 Abrir</button>
        <button class="btn" data-a="saveCfg">💾 Guardar proyecto</button>
        <button class="btn" data-a="reset" title="Volver a los valores del ejemplo LOVECUBE">↺ Ejemplo</button>
      </div>
      <div class="spacer"></div>
      <button class="btn primary" data-a="export" title="Láminas de corte (líneas rojas), plantilla, impresión UV y ensamble">⬇ Exportar SVG para Corel</button>
    </header>
    <main class="layout studio-layout hb-layout">
      <aside class="panel left">
        <section class="card">
          <h3>Hablador</h3>
          ${txt('Nombre', 'name')}
          ${num('Ancho base (mm)', 'width')}
          ${num('Ancho panel (mm)', 'panelWidth', 'Panel negro trasero; la base sobresale a cada lado')}
          ${num('Alto total (mm)', 'height')}
          ${num('Fondo de la base (mm)', 'depth')}
          ${num('Radio esquinas panel', 'panelCorner')}
          ${num('Borde negro del ícono', 'border')}
          ${num('Alero izquierdo (× alto)', 'roof.left', 'Altura del hombro izquierdo del techo, como fracción del alto del panel')}
          ${num('Alero derecho (× alto)', 'roof.right')}
          ${num('Pendiente techo izq.', 'roof.leftSlope')}
          ${num('Pendiente techo der.', 'roof.rightSlope')}
        </section>
        <section class="card">
          <h3>Materiales</h3>
          ${num('Acrílico blanco (mm)', 'white.t')}
          ${num('Acrílico negro (mm)', 'black.t')}
          ${num('Holgura de ranuras (mm)', 'clearance', 'Se suma al grosor en cada ranura: compensa el kerf del láser y deja entrar la pieza sin forzar')}
          ${num('Lámina ancho (mm)', 'sheet.w')}
          ${num('Lámina alto (mm)', 'sheet.h')}
          ${num('Separación piezas (mm)', 'sheet.gap')}
        </section>
        <section class="card">
          <h3>Ícono superior</h3>
          <label class="row">Tipo <select data-k="icon.type"><option value="cube">Cubo con corazón</option><option value="custom">Logo desde imagen</option><option value="none">Ninguno</option></select></label>
          ${num('Alto del ícono (mm)', 'icon.height')}
          ${num('Desplazamiento horizontal (mm)', 'icon.offsetX', 'Negativo = a la izquierda. La V del ícono marca dónde se separan las placas QR')}
          <div data-show="cube">${chk('Corazón negro', 'icon.heart')}</div>
          <div data-show="custom">
            <button class="btn wide" data-a="logo">🖼️ Cargar logo (PNG/JPG)</button>
            ${num('Trazo mínimo (mm)', 'logoOpt.minFeature', 'Partes más delgadas que esto se eliminan y huecos más angostos se cierran: el acrílico no se parte')}
            ${chk('Usar las partes claras', 'logoOpt.invert', 'Para logos claros sobre fondo oscuro')}
            <div class="muted small" data-r="logoInfo"></div>
          </div>
        </section>
        <section class="card">
          <h3>Título y subtítulo</h3>
          ${chk('Título', 'title.enabled')}
          <div data-show="title">
            ${txt('Texto', 'title.text')}
            ${font('title.font')}
            ${num('Alto (mm)', 'title.height')}
            ${num('Ancho máx. (mm)', 'title.maxWidth')}
            ${chk('Soldar en una sola pieza', 'title.weld', 'Une las letras (se juntan solas si hace falta) para cortar una sola pieza fácil de pegar')}
          </div>
          ${chk('Subtítulo (letras sueltas)', 'subtitle.enabled')}
          <div data-show="subtitle">
            ${txt('Texto', 'subtitle.text')}
            ${font('subtitle.font')}
            ${num('Alto de letra (mm)', 'subtitle.capHeight')}
            ${num('Ancho total (mm, 0 = libre)', 'subtitle.width', 'Ajusta el espaciado para que la palabra mida exactamente este ancho')}
            ${num('Espaciado (× alto)', 'subtitle.tracking')}
          </div>
        </section>
      </aside>

      <section class="center">
        <div class="hb-tabs seg" data-r="tabs">${TABS.map(([k, l]) => `<button class="seg-btn" data-tab="${k}">${l}</button>`).join('')}</div>
        <div class="views mode-2d"><div class="view hb-view" data-r="view"><div class="hb-svg" data-r="svg"></div></div></div>
        <div class="statusbar"><span data-r="status"></span><span class="spacer"></span><span data-r="time"></span></div>
      </section>

      <aside class="panel right">
        <section class="card">
          <h3>Placas QR</h3>
          ${chk('Incluir placas QR', 'qr.enabled')}
          <div data-show="qr">
            <label class="row">Cantidad <select data-r="qrCount"><option>1</option><option>2</option><option>3</option></select></label>
            ${font('qr.labelFont')}
            ${num('Ancho placa (mm, 0 = auto)', 'qr.w')}
            ${num('Alto placa (mm)', 'qr.h')}
            ${num('Inclinación izquierda', 'qr.slopeL', 'Cuánto sube el borde superior de las placas a la izquierda de la V (mm por mm)')}
            ${num('Inclinación derecha', 'qr.slopeR', 'Cuánto sube el borde superior de las placas a la derecha de la V (mm por mm)')}
            ${num('Corte respecto a la V (mm)', 'qr.split', 'Con 2 placas: desplaza la separación entre ellas respecto a la V del ícono')}
            <div data-r="qrItems"></div>
          </div>
        </section>
        <section class="card">
          <h3>NFC</h3>
          ${chk('Hueco para tag NFC', 'nfc.enabled', 'Hueco pasante en el panel detrás de una placa: el sticker NFC queda escondido entre el panel y la placa')}
          <div data-show="nfc">
            ${num('Diámetro del tag (mm)', 'nfc.diameter')}
            <label class="row">Detrás de <select data-k="nfc.plate" data-r="nfcPlate"></select></label>
          </div>
        </section>
        <section class="card">
          <h3>Porta tarjetas</h3>
          ${chk('Incluir porta tarjetas', 'cards.enabled')}
          <div data-show="cards">
            ${num('Ancho tarjeta (mm)', 'cards.cardW')}
            ${num('Ancho frente (mm)', 'cards.frontW')}
            ${num('Alto laterales (mm)', 'cards.sideH')}
            ${num('Alto (mm)', 'cards.height')}
            ${num('Fondo (mm)', 'cards.depth')}
            ${chk('Imprimir logo en el frente', 'cards.print')}
          </div>
        </section>
        <section class="card">
          <h3>Estructura</h3>
          ${chk('Pestañas traseras (soporte)', 'braces.enabled')}
          ${chk('Plantilla de pegado', 'jig.enabled', 'Panel en cartón/MDF con ventanas para ubicar cada pieza al pegar')}
        </section>
        <section class="card grow">
          <h3>Piezas</h3>
          <div class="hb-warn" data-r="warn"></div>
          <div class="hb-list small" data-r="list"></div>
        </section>
      </aside>
    </main>
    <input type="file" data-r="fileMockup" accept="image/*" hidden />
    <input type="file" data-r="fileLogo" accept="image/*" hidden />
    <input type="file" data-r="fileCfg" accept=".r3h,.json" hidden />`;
    this.$ = (n) => this.root.querySelector(`[data-r="${n}"]`);
    this.bind();
  }

  bind() {
    const r = this.root;
    r.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      const tab = e.target.closest('[data-tab]')?.dataset.tab;
      if (tab) { this.tab = tab; this.renderView(); return; }
      if (a === 'home') this.cb.onBack();
      else if (a === 'mockup') this.$('fileMockup').click();
      else if (a === 'logo') this.$('fileLogo').click();
      else if (a === 'openCfg') this.$('fileCfg').click();
      else if (a === 'saveCfg') this.saveProject();
      else if (a === 'reset') { this.cfg = DEFAULT_HABLADOR(); this.logoSrc = null; this.sync(); this.rebuild(); }
      else if (a === 'export') this.export();
    });
    const onInput = (e) => {
      const el = e.target;
      if (el.dataset.r === 'qrCount') { this.setQrCount(+el.value); return; }
      const k = el.dataset.k, qi = el.dataset.qi;
      if (qi != null) {
        const it = this.cfg.qr.items[+qi], f = el.dataset.qf;
        if (f === 'grad') { it.color2 = el.checked ? (it._c2 || '#e8127c') : ''; if (!el.checked) it._c2 = undefined; this.renderQrItems(); }
        else { it[f] = el.value; if (f === 'color2') it._c2 = el.value; }
        this.schedule(); return;
      }
      if (!k) return;
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.tagName === 'SELECT') v = /^-?\d+$/.test(el.value) && k === 'nfc.plate' ? +el.value : el.value;
      else if (el.getAttribute('inputmode') === 'decimal') { v = parseNum(el.value); if (!Number.isFinite(v)) return; }
      else v = el.value;
      setK(this.cfg, k, v);
      if (k.startsWith('logoOpt.')) { this.retraceLogo(); return; }
      this.updateVisibility();
      this.schedule();
    };
    r.addEventListener('input', onInput);
    r.addEventListener('change', onInput);
    this.$('fileMockup').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await this.loadMockup(f); });
    this.$('fileLogo').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await this.loadLogo(f); });
    this.$('fileCfg').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { this.openProject(JSON.parse(await f.text())); } catch (err) { this.cb.toast('Proyecto no válido: ' + err.message, true); }
    });
    new ResizeObserver(() => {
      const v = this.$('view'), key = v.clientWidth + 'x' + v.clientHeight;
      if (key === this._vsz) return;
      this._vsz = key;
      requestAnimationFrame(() => this.fitView());
    }).observe(this.$('view'));
  }

  async loadFonts() {
    if (this.fonts) return this.fonts;
    const fonts = {};
    await Promise.all(Object.entries(HABLADOR_FONTS).map(async ([fam, file]) => {
      try { fonts[fam] = parseFont(await (await fetch('fonts/' + file)).arrayBuffer()); } catch (err) { console.warn('font', fam, err); }
    }));
    this.fonts = fonts;
    return fonts;
  }

  async open() {
    this.root.hidden = false;
    this.cfg.logoOpt ??= { minFeature: 1.2, invert: false };
    this.sync();
    if (!this.model) await this.rebuild();
    else this.renderView();
  }

  // ------------------------------------------------------------------ form <-> cfg
  sync() {
    const c = this.cfg;
    c.logoOpt ??= { minFeature: 1.2, invert: false };
    for (const el of this.root.querySelectorAll('[data-k]')) {
      const v = getK(c, el.dataset.k);
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.dataset.r === 'nfcPlate') continue;
      else el.value = v ?? '';
    }
    this.$('qrCount').value = String(Math.max(1, c.qr.items.length));
    this.renderQrItems();
    this.updateVisibility();
  }

  updateVisibility() {
    const c = this.cfg;
    const show = { cube: c.icon.type === 'cube', custom: c.icon.type === 'custom', title: c.title.enabled, subtitle: c.subtitle.enabled, qr: c.qr.enabled, nfc: c.nfc.enabled, cards: c.cards.enabled };
    for (const el of this.root.querySelectorAll('[data-show]')) el.hidden = !show[el.dataset.show];
    this.$('logoInfo').textContent = c.icon.custom?.white?.length ? `Logo: ${c.icon.custom.white.length} pieza(s) en curvas` : 'Carga una imagen del logo (fondo liso o transparente).';
  }

  setQrCount(n) {
    const items = this.cfg.qr.items;
    const presets = DEFAULT_HABLADOR().qr.items.concat([{ label: 'VISÍTANOS', sub: 'NUESTRA WEB', url: 'https://ejemplo.com', color: '#111111', color2: '', badge: 'none' }]);
    while (items.length < n) items.push({ ...presets[items.length] });
    items.length = n;
    if (this.cfg.nfc.plate >= n) this.cfg.nfc.plate = 0;
    this.renderQrItems();
    this.schedule();
  }

  renderQrItems() {
    const items = this.cfg.qr.items;
    this.$('qrItems').innerHTML = items.map((q, i) => `
      <div class="hb-qr">
        <h4>Placa ${i + 1}</h4>
        <label class="row">Enlace <input type="text" data-qi="${i}" data-qf="url" value="${esc(q.url)}" /></label>
        <label class="row">Texto <input type="text" data-qi="${i}" data-qf="label" value="${esc(q.label)}" /></label>
        <label class="row">Línea 2 <input type="text" data-qi="${i}" data-qf="sub" value="${esc(q.sub)}" /></label>
        <label class="row">Color QR <input type="color" data-qi="${i}" data-qf="color" value="${esc(q.color)}" /></label>
        <label class="row">Degradado <input type="checkbox" data-qi="${i}" data-qf="grad" ${q.color2 ? 'checked' : ''} /></label>
        ${q.color2 ? `<label class="row">Color 2 <input type="color" data-qi="${i}" data-qf="color2" value="${esc(q.color2)}" /></label>` : ''}
        <label class="row">Ícono al centro <select data-qi="${i}" data-qf="badge">${[['none', 'Ninguno'], ['whatsapp', 'WhatsApp'], ['instagram', 'Instagram']].map(([v, l]) => `<option value="${v}" ${(q.badge || 'none') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>`).join('');
    const sel = this.$('nfcPlate');
    sel.innerHTML = items.map((q, i) => `<option value="${i}">Placa ${i + 1} · ${esc(q.label)}</option>`).join('');
    sel.value = String(this.cfg.nfc.plate || 0);
  }

  // ------------------------------------------------------------------ build
  schedule() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.rebuild(), 250);
  }

  async rebuild() {
    const fonts = await this.loadFonts();
    const t0 = performance.now();
    try {
      const cfg = structuredClone(this.cfg);
      this.model = buildHablador(cfg, fonts);
      this.files = exportAll(this.model);
      this.$('time').textContent = `${Math.round(performance.now() - t0)} ms`;
    } catch (err) {
      console.error(err);
      this.cb.toast('No se pudo generar: ' + err.message, true);
      return;
    }
    this.renderInfo();
    this.renderView();
  }

  renderInfo() {
    const m = this.model;
    const M = MATERIALS(m.cfg);
    const sum = summary(m);
    this.$('status').textContent = Object.entries(sum).map(([k, v]) => `${k}: ${v.pieces} piezas · ${v.sheets} lámina${v.sheets > 1 ? 's' : ''}`).join('   |   ');
    this.$('warn').innerHTML = m.warnings.length ? m.warnings.map((w) => `<div class="hb-w">⚠ ${esc(w)}</div>`).join('') : '<div class="hb-ok">✓ Sin líneas finas ni piezas que no quepan</div>';
    let h = '';
    for (const mat of ['white', 'black', 'jig']) {
      const ps = m.pieces.filter((p) => p.mat === mat);
      if (!ps.length) continue;
      h += `<h4>${esc(M[mat])}</h4>`;
      h += ps.map((p) => `<div class="hb-pc"><span>${p.qty > 1 ? p.qty + '× ' : ''}${esc(p.name)}</span><span class="muted">${p.size.w.toFixed(1)}×${p.size.h.toFixed(1)}</span></div>`).join('');
    }
    this.$('list').innerHTML = h;
  }

  svgFor(tab) {
    const f = (re) => this.files.filter((x) => re.test(x.name));
    if (tab === 'assembly') return f(/_ensamble\.svg$/).map((x) => x.svg);
    if (tab === 'print') return f(/_impresion_UV\.svg$/).map((x) => x.svg);
    if (tab === 'mockup') return [];
    // cut sheets: thicker red lines on screen only (the exported file keeps the 0.01 mm hairline)
    return f(new RegExp(`_corte_${tab}_\\d+\\.svg$`)).map((x) => x.svg.replace(/stroke-width="0\.01"/g, 'stroke-width="0.5"').replace('<svg ', '<svg style="background:#fff" '));
  }

  renderView() {
    for (const b of this.root.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === this.tab);
    const box = this.$('svg');
    if (this.tab === 'mockup') {
      const asm = this.svgFor('assembly')[0] || '';
      box.innerHTML = `<div class="hb-cmp">${this.mockup ? `<img src="${this.mockup}" alt="mockup" />` : '<div class="hb-empty">Carga el mockup con «🖼️ Cargar mockup» para compararlo con el despiece.</div>'}<div class="hb-page">${asm}</div></div>`;
    } else {
      const svgs = this.svgFor(this.tab);
      box.innerHTML = svgs.length ? svgs.map((s, i) => `<div class="hb-page">${svgs.length > 1 ? `<div class="hb-cap">Lámina ${i + 1}</div>` : ''}${s.replace(/<\?xml[^>]*>\s*/, '')}</div>`).join('') : '<div class="hb-empty">No hay piezas de este material.</div>';
    }
    this.fitView();
  }

  fitView() {
    const box = this.$('svg'), view = this.$('view');
    if (!box || !view.clientWidth) return;
    const W = view.clientWidth - 40, H = view.clientHeight - 40;
    for (const svg of box.querySelectorAll('.hb-page > svg')) {
      const vb = svg.viewBox.baseVal;
      if (!vb?.width) continue;
      const k = Math.min(W / vb.width, (this.tab === 'mockup' ? W : H) / vb.height) * (this.tab === 'mockup' ? 0.5 : 1);
      svg.setAttribute('width', Math.max(50, vb.width * k));
      svg.setAttribute('height', Math.max(50, vb.height * k));
    }
  }

  // ------------------------------------------------------------------ images
  async readDataURL(file) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  }

  async loadMockup(file) {
    this.mockup = await this.readDataURL(file);
    this.tab = 'mockup';
    this.renderView();
  }

  async loadLogo(file) {
    this.logoSrc = await this.readDataURL(file);
    this.cfg.icon.type = 'custom';
    this.sync();
    await this.retraceLogo();
  }

  async retraceLogo() {
    if (!this.logoSrc) { this.schedule(); return; }
    this.cb.showBusy('Vectorizando logo…');
    await nextFrame();
    try {
      const img = new Image(); img.src = this.logoSrc; await imageReady(img);
      const k = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, c.width, c.height);
      const o = this.cfg.logoOpt;
      this.cfg.icon.custom = traceLogo(cx.getImageData(0, 0, c.width, c.height), { heightMM: this.cfg.icon.height, minFeature: o.minFeature, invert: o.invert });
      if (!this.cfg.icon.custom.white.length) this.cb.toast('No se encontró el logo en la imagen (¿fondo no liso?)', true);
    } catch (err) {
      console.error(err);
      this.cb.toast('Error al vectorizar el logo: ' + err.message, true);
    } finally { this.cb.hideBusy(); }
    this.updateVisibility();
    await this.rebuild();
  }

  // ------------------------------------------------------------------ files
  async export() {
    if (!this.model) await this.rebuild();
    const files = this.files.map((f) => ({ name: f.name, data: f.svg }));
    const dir = await window.api.saveFilesToFolder({ files });
    if (dir) this.cb.toast(`✓ ${files.length} archivos guardados en ${dir}`);
    return dir;
  }

  async saveProject() {
    const data = JSON.stringify({ app: 'Relieve3D-Hablador', version: 1, cfg: this.cfg, logoSrc: this.logoSrc });
    const p = await window.api.saveFile({ defaultPath: (this.cfg.name || 'hablador') + '.r3h', filters: [{ name: 'Proyecto Hablador', extensions: ['r3h'] }], data });
    if (p) this.cb.toast('✓ Proyecto guardado');
  }

  openProject(j) {
    if (j.app !== 'Relieve3D-Hablador' || !j.cfg) throw new Error('no es un proyecto de hablador');
    const d = DEFAULT_HABLADOR();
    const merge = (a, b) => { for (const k of Object.keys(b)) a[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' ? merge(a[k], b[k]) : b[k]; return a; };
    this.cfg = merge(d, j.cfg);
    this.logoSrc = j.logoSrc || null;
    this.root.hidden = false;
    this.sync();
    return this.rebuild();
  }
}
