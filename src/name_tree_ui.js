import * as THREE from 'three';
import { parse as parseFont } from 'opentype.js';
import { Viewer3D } from './viewer3d.js';
import { FontPicker } from './font_picker.js';
import { ensureFont } from './core/text.js';
import { imageReady } from './core/imageload.js';
import { traceLogo, flatten } from './core/hablador.js';
import { computeForeground } from './core/processing.js';
import {
  DEFAULT_NAME_TREE, NAME_TREE_FONTS, normalizeNameTree, prepareNameTree, buildNameTree, packNameTree,
  placedTreeGeometry, nameTreeProject, readNameTreeProject, nameTreeFiles, nameTreeAssembly,
} from './core/name_tree.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const dispose = res => res?.parts.forEach(p => p.geometry.dispose());
const basename = s => 'Arbol_' + String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/, '').slice(0, 60);
const storageKey = 'relieve3d.nameTree.v2', legacyKey = 'relieve3d.nameTree';
// Version 1.24 remembered a different design (flat back, its own example). Only names the user typed carry over.
function rememberedTree() {
  const saved = localStorage.getItem(storageKey), legacy = localStorage.getItem(legacyKey), d = DEFAULT_NAME_TREE();
  if (saved) return readNameTreeProject(saved);
  if (!legacy) return d;
  const old = readNameTreeProject(legacy);
  return old.names.map(n => n.text).join('\n') === 'Sofía\nMateo\nValentina' ? d
    : normalizeNameTree({ ...d, name: old.name, names: old.names, order: old.order, colors: old.colors });
}

export class NameTreeStudio {
  constructor(root, cb) {
    this.root = root; this.cb = cb; this.cfg = DEFAULT_NAME_TREE();
    try { this.cfg = rememberedTree(); } catch { /* Invalid old preferences never block the application. */ }
    this.fonts = new Map(); this.revision = 0; this.activeBuilds = 0; this.view = 'assembled'; this.plate = 0;
    this.res = null; this.error = ''; this.suggestions = []; this.busy = false;
    this.build();
  }
  build() {
    const number = (label, key, title = '') => `<label class="row" title="${esc(title)}">${label}<input type="text" inputmode="decimal" data-k="${key}" /></label>`;
    const color = (label, key) => `<label class="row">${label}<input type="color" data-color="${key}" /></label>`;
    this.root.innerHTML = `
      <header class="topbar">
        <button class="btn" data-a="home">⌂ Inicio</button>
        <div class="brand"><span class="module-name">🎄 Árbol de nombres</span></div>
        <div class="tb-group">
          <button class="btn" data-a="open">📂 Abrir</button>
          <button class="btn" data-a="save" data-result>💾 Guardar proyecto</button>
          <button class="btn" data-a="photo" data-result>📸 Foto</button>
        </div><div class="spacer"></div>
        <button class="btn" data-a="assembly" data-result title="Vista armada de referencia, no para imprimir en esta posición">3MF armado</button>
        <button class="btn primary" data-a="export" data-result>⬇ Placas por color</button>
      </header>
      <main class="layout studio-layout hb-layout nt-layout">
        <aside class="panel left">
          <section class="card">
            <h3>Nombres del árbol</h3>
            <label for="treeNames" class="muted small">Uno por renglón; admite nombres compuestos y repetidos.</label>
            <textarea id="treeNames" data-r="names" rows="7" spellcheck="false"></textarea>
            <label class="row">Orden<select data-k="order"><option value="auto">Automático: largos abajo</option><option value="manual">Mi listado: de abajo arriba</option></select></label>
            <label class="row">Tronco<select data-k="trunk"><option value="text">Con texto</option><option value="block">Liso</option></select></label>
            <label class="row" title="Por ejemplo el año o el apellido; hasta 16 caracteres.">Texto del tronco<input type="text" data-k="trunkText" maxlength="16" spellcheck="false" /></label>
            <label class="row">Fuente<select data-k="font">${Object.keys(NAME_TREE_FONTS).map(f => `<option>${esc(f)}</option>`).join('')}</select></label>
            <label class="row">Mayúsculas<input type="checkbox" data-k="uppercase" /></label>
            <div class="muted small">Cada nombre se escala sin estirar las letras, entre dos barras finas como en el modelo de referencia. Los acentos quedan calados en la barra superior: cada palabra es una sola pieza.</div>
          </section>
          <section class="card">
            <h3>Medidas máximas del conjunto</h3>
            ${number('Alto máximo (mm)', 'maxHeight', 'Incluye tronco, nombres y remate. El árbol puede quedar más bajo para respetar el ancho y la forma.')}
            ${number('Ancho máximo (mm)', 'maxWidth')}
            ${number('Grosor inferior (mm)', 'bottomDepth', 'Grosor en la base. Más grosor = más estable.')}
            ${number('Grosor superior (mm)', 'topDepth', 'Igual al inferior = espesor uniforme. Menor = el árbol se afina hacia arriba por igual delante y detrás.')}
            <p class="muted small">El grosor se reparte por igual delante y detrás: el árbol queda vertical, sin inclinarse. Sin palabras inclinadas. Los grosores son independientes del alto y ancho.</p>
          </section>
          <section class="card">
            <h3>Remate de la cima</h3>
            <label class="row">Forma<select data-k="shape"><option value="star">Estrella</option><option value="heart">Corazón</option><option value="circle">Círculo</option><option value="custom">Mi silueta</option></select></label>
            <button class="btn wide" data-a="shape">Cargar silueta PNG / JPG / SVG</button>
            <p class="muted small">Una figura conectada, oscura sobre fondo claro o transparente. Se añade el encaje inferior automáticamente.</p>
          </section>
        </aside>
        <section class="center">
          <div class="hb-tabs seg nt-tabs">${[['assembled', 'Armado'], ['front', 'Frente'], ['side', 'De lado'], ['exploded', 'Despiece'], ['plates', 'Placas']].map(([v, label]) => `<button class="seg-btn" data-view="${v}">${label}</button>`).join('')}
            <button class="btn mini" data-a="fit" title="Encuadrar">⌖</button>
          </div>
          <label class="nt-plate" data-r="plateRow" hidden>Placa <select data-r="plate"></select></label>
          <div class="views mode-3d"><div class="view dark" data-r="view"></div></div>
          <div class="statusbar"><span data-r="status" role="status" aria-live="polite"></span></div>
        </section>
        <aside class="panel right">
          <section class="card">
            <h3>Colores de filamento</h3>
            ${color('Primer color', 'first')}${color('Segundo color', 'second')}${color('Tronco', 'trunk')}${color('Remate', 'top')}
            <div class="muted small">Los nombres alternan los dos colores. También puedes dar un color propio a cada nombre:</div>
            <div data-r="parts" class="nt-parts"></div>
          </section>
          <section class="card">
            <h3>Encajes e impresión</h3>
            ${number('Holgura por lado (mm)', 'clearance', '0,2 mm por lado. Si queda apretado, aumenta; si queda flojo, reduce. Prueba primero una pareja.')}
            ${number('Trazo / unión mín. (mm)', 'minStroke', 'Engrosa trazos, une acentos y refuerza barras. Recomendado: 1,2 mm para boquilla de 0,4.')}
            ${number('Placa: ancho (mm)', 'bedWidth')}${number('Placa: largo (mm)', 'bedHeight')}
            <p class="muted small">Piezas acostadas, espalda sobre la cama, sin soportes. Una placa por color: no requiere AMS.</p>
            <p class="muted small">Guías ocultas dentro del grosor: no se ven por delante ni por detrás. Monta bajando cada pieza en vertical sobre la anterior, con las caras alineadas.</p>
          </section>
          <section class="card" data-r="summary"></section>
          <section class="card warn" data-r="warnings" hidden></section>
          <section class="card">
            <label class="row">Proyecto<input type="text" data-k="name" maxlength="60" /></label>
            <button class="btn wide" data-a="reset">Restablecer ejemplo</button>
          </section>
        </aside>
      </main>
      <input type="file" data-r="fileProject" accept=".r3t,.json" hidden />
      <input type="file" data-r="fileShape" accept="image/png,image/jpeg,image/svg+xml,.svg" hidden />`;
    this.$ = key => this.root.querySelector(`[data-r="${key}"]`);
    this.picker = new FontPicker(this.root.querySelector('[data-k="font"]'), {
      sample: () => ({ text: this.res?.parts.find(p => p.role === 'name')?.name || 'FAMILIA', weight: 400 }),
      label: 'Fuente de los nombres', onError: this.cb.toast,
      loadFont: family => ensureFont(family, 400, { file: NAME_TREE_FONTS[family] }),
    });
    this.root.addEventListener('click', e => {
      const tab = e.target.closest('[data-view]'), button = e.target.closest('[data-a]');
      if (tab) { this.view = tab.dataset.view; this.render(); return; }
      if (button) this.action(button.dataset.a, button).catch(error => this.cb.toast(error.message, true));
    });
    this.$('names').addEventListener('input', () => {
      const previous = Array.isArray(this.cfg.names) ? this.cfg.names : [];
      this.cfg.names = this.$('names').value.split(/[\r\n;,]+/).filter(n => n.trim())
        .map((text, i) => ({ text: text.trim(), color: previous[i]?.text === text.trim() ? previous[i].color : '' }));
      this.schedule();
    });
    this.root.addEventListener('change', e => {
      const el = e.target, key = el.dataset.k;
      if (key) {
        if (key === 'shape' && el.value === 'custom' && !this.cfg.custom) { el.value = this.cfg.shape; this.$('fileShape').click(); return; }
        this.cfg[key] = el.type === 'checkbox' ? el.checked : el.value;
        if (key === 'trunk') this.root.querySelector('[data-k="trunkText"]').disabled = el.value === 'block';
        this.schedule();
      } else if (el.dataset.color) { this.cfg.colors[el.dataset.color] = el.value; this.schedule(); }
      else if (el.dataset.nameColor !== undefined) { this.cfg.names[+el.dataset.nameColor].color = el.value; this.schedule(); }
    });
    this.$('plate').onchange = () => { this.plate = +this.$('plate').value; this.render(); };
    this.$('fileProject').onchange = e => {
      const f = e.target.files[0]; e.target.value = '';
      if (f) f.text().then(text => this.openProject(text)).catch(error => this.cb.toast(error.message, true));
    };
    this.$('fileShape').onchange = e => {
      const f = e.target.files[0]; e.target.value = '';
      if (f) this.loadShape(f).catch(error => this.cb.toast(error.message, true));
    };
    this.sync();
  }
  sync() {
    this.$('names').value = this.cfg.names.map(n => n.text).join('\n');
    for (const el of this.root.querySelectorAll('[data-k]')) {
      if (el.type === 'checkbox') el.checked = !!this.cfg[el.dataset.k];
      else el.value = this.cfg[el.dataset.k];
    }
    for (const el of this.root.querySelectorAll('[data-color]')) el.value = this.cfg.colors[el.dataset.color];
    this.root.querySelector('[data-k="trunkText"]').disabled = this.cfg.trunk === 'block';
    this.picker.sync();
  }
  async font(family) {
    if (!this.fonts.has(family)) this.fonts.set(family, fetch('fonts/' + NAME_TREE_FONTS[family])
      .then(r => { if (!r.ok) throw new Error('No se pudo cargar la fuente.'); return r.arrayBuffer(); }).then(parseFont));
    try { return await this.fonts.get(family); }
    catch (error) { this.fonts.delete(family); throw error; }
  }
  async generate(cfg) {
    const normalized = normalizeNameTree(cfg);
    const [, font] = await Promise.all([prepareNameTree(), this.font(normalized.font)]);
    await wait(0);
    return buildNameTree(normalized, { font });
  }
  async open() {
    this.root.hidden = false;
    if (!this.viewer) this.viewer = new Viewer3D(this.$('view'));
    this.viewer.resize();
    if (!this.res) await this.rebuild();
    else this.render();
  }
  close() { this.root.hidden = true; }
  ready() { return !!this.res && !this.error && !this.timer && !this.activeBuilds; }
  buttons() {
    for (const b of this.root.querySelectorAll('[data-result]')) b.disabled = !this.ready() || this.busy;
    this.root.setAttribute('aria-busy', String(!!this.timer || !!this.activeBuilds || this.busy));
  }
  schedule() {
    this.revision++; clearTimeout(this.timer);
    this.error = ''; this.suggestions = [];
    for (const b of this.$('warnings').querySelectorAll('[data-a="suggest"]')) b.disabled = true;
    this.$('status').textContent = 'Actualizando árbol…';
    this.timer = setTimeout(() => { this.timer = null; this.rebuild(); }, 180);
    this.buttons();
  }
  async rebuild() {
    const revision = this.revision; this.activeBuilds++; this.buttons();
    try {
      const result = await this.generate(this.cfg);
      if (revision !== this.revision) { dispose(result); return; }
      this.accept(result);
    } catch (error) {
      if (revision !== this.revision) return;
      this.error = error.message; this.suggestions = error.suggestions || [];
      this.$('status').textContent = 'Vista anterior · ' + error.message;
      this.$('warnings').hidden = false;
      this.$('warnings').innerHTML = `<p>${esc(error.message)}</p>` + this.suggestions
        .map((s, i) => `<button class="btn wide" data-a="suggest" data-i="${i}">${esc(s.label)}</button>`).join('');
      if (this.suggestions.length) this.$('warnings').scrollIntoView({ block: 'nearest' });
    } finally { this.activeBuilds--; this.buttons(); }
  }
  accept(result) {
    dispose(this.res); this.res = result; this.cfg = normalizeNameTree(result.cfg); this.error = ''; this.plate = 0;
    try { localStorage.setItem(storageKey, nameTreeProject(this.cfg)); localStorage.removeItem(legacyKey); } catch { this.cb.toast('No se pudo recordar el árbol. Guárdalo como proyecto.', true); }
    this.renderInfo(); this.render();
  }
  async whenIdle() {
    for (let i = 0; i < 1500 && (this.timer || this.activeBuilds); i++) await wait(20);
    if (!this.ready()) throw new Error(this.error || 'El árbol todavía no está listo.');
    return true;
  }
  renderInfo() {
    const r = this.res, c = this.cfg, p = r.plan;
    this.picker.sync();
    this.$('status').textContent = `${c.names.length} nombres · ${p.width.toFixed(1)} × ${p.height.toFixed(1)} mm · grosor ${c.bottomDepth} → ${c.topDepth} mm`;
    this.$('parts').innerHTML = r.parts.filter(part => part.role === 'name').map(part => `<label class="nt-part">${esc(part.name)}
      <input type="color" data-name-color="${part.sourceIndex}" value="${part.color}" aria-label="Color de ${esc(part.name)}" /></label>`).join('');
    this.plates = []; const warnings = [...r.warnings];
    try { this.plates = packNameTree(r); } catch (error) { warnings.push(error.message); }
    this.$('plate').innerHTML = this.plates.map((plate, i) => `<option value="${i}">${i + 1} · ${plate.color} · ${plate.placements.length} pieza(s)</option>`).join('');
    this.$('summary').innerHTML = `<h3>Resultado</h3><div>${r.parts.length} piezas encajables</div><div>${this.plates.length} placas · ${r.filaments.length} colores</div>
      <div>Estabilidad: ${p.stability.frontBack.toFixed(1)}° adelante/atrás · ${p.stability.sideways.toFixed(1)}° de lado</div>
      <p class="muted small">El alto incluye el tronco y la figura. Se respeta el límite más restrictivo sin deformar las letras.</p>`;
    this.$('warnings').hidden = !warnings.length;
    this.$('warnings').textContent = warnings.join(' ');
  }
  render() {
    if (!this.viewer || !this.res) return;
    const v = this.viewer, r = this.res, plateMode = this.view === 'plates';
    v.clear(); v.model.position.set(0, 0, 0);
    v.grid.scale.set(plateMode ? r.cfg.bedWidth / 256 : 1, 1, plateMode ? r.cfg.bedHeight / 256 : 1);
    this.$('plateRow').hidden = !plateMode;
    for (const b of this.root.querySelectorAll('[data-view]')) b.classList.toggle('active', b.dataset.view === this.view);
    const placements = plateMode ? this.plates?.[this.plate]?.placements || [] : r.parts.map((_, index) => ({ index }));
    for (const placement of placements) {
      const part = r.parts[placement.index];
      const geometry = plateMode ? placedTreeGeometry(part, placement) : part.geometry.clone().rotateX(Math.PI / 2);
      if (plateMode) geometry.translate(-r.cfg.bedWidth / 2, -r.cfg.bedHeight / 2, 0);
      else if (this.view === 'exploded') geometry.translate(0, 0, placement.index * Math.max(12, 0.06 * r.plan.height));
      const m = v.addPiece('p' + placement.index, geometry); m.material.color.set(part.color);
    }
    this.fit();
  }
  fit() {
    if (!this.viewer) return;
    const v = this.viewer; v.scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const mesh of v.meshes.values()) box.expandByObject(mesh);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere()), rad = Math.PI / 180;
    const angle = Math.min(v.camera.fov * rad / 2, Math.atan(Math.tan(v.camera.fov * rad / 2) * v.camera.aspect));
    const distance = sphere.radius / Math.sin(angle) * 1.08;
    const az = this.view === 'side' ? 90 : ['front', 'exploded'].includes(this.view) ? 0 : 20;
    const el = this.view === 'plates' ? 65 : this.view === 'assembled' ? 12 : 0;
    v.controls.target.copy(sphere.center);
    v.camera.position.copy(sphere.center).add(new THREE.Vector3(Math.sin(az * rad) * Math.cos(el * rad), Math.sin(el * rad), Math.cos(az * rad) * Math.cos(el * rad)).multiplyScalar(distance));
    v.camera.near = Math.max(0.1, distance / 1000); v.camera.far = distance * 10;
    v.camera.updateProjectionMatrix(); v.controls.update(); v.requestRender();
  }
  async openProject(value) {
    const candidate = readNameTreeProject(value), result = await this.generate(candidate);
    this.revision++; clearTimeout(this.timer); this.timer = null;
    this.root.hidden = false;
    if (!this.viewer) this.viewer = new Viewer3D(this.$('view'));
    this.accept(result); this.sync(); this.buttons();
  }
  async loadShape(file) {
    if (file.size > 10 * 1024 * 1024) throw new Error('La silueta no debe superar 10 MB.');
    const src = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
    });
    const image = new Image(); image.src = src; await imageReady(image);
    const canvas = document.createElement('canvas'), scale = Math.min(1, 800 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), foreground = computeForeground(pixels, { removeBg: 'auto', tolerance: 40 });
    let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (foreground[y * canvas.width + x]) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (x1 < x0) throw new Error('La imagen no contiene una silueta visible.');
    // Bound the tracing raster by the actual ink, including very wide shapes inside a square image.
    const heightMM = 50 * Math.min(1, (y1 - y0 + 1) / (x1 - x0 + 1));
    const traced = traceLogo(pixels, { heightMM, minFeature: 0.4, minAreaMM2: 0.5 });
    if (traced.white.length !== 1) throw new Error('Usa una sola silueta conectada sobre fondo claro o transparente.');
    const custom = traced.white[0].map(c => flatten(c, 0.03).map(([x, y]) => [x, -y]));
    const result = await this.generate({ ...this.cfg, shape: 'custom', custom });
    this.revision++; clearTimeout(this.timer); this.timer = null;
    this.accept(result); this.sync(); this.buttons();
  }
  async saveProject() {
    await this.whenIdle();
    const saved = await window.api.saveFile({ defaultPath: basename(this.cfg.name) + '.r3t', filters: [{ name: 'Árbol de nombres', extensions: ['r3t'] }], data: nameTreeProject(this.cfg) });
    if (saved) this.cb.toast('Proyecto guardado: ' + saved);
    return saved;
  }
  async exportAll() {
    await this.whenIdle();
    const snapshot = { ...this.res, cfg: normalizeNameTree(this.res.cfg),
      parts: this.res.parts.map(p => ({ ...p, geometry: p.geometry.clone() })) };
    this.busy = true; this.buttons();
    try {
      const profile = snapshot.cfg.bedWidth === 256 && snapshot.cfg.bedHeight === 256 ? await window.api.nameTreeProfile?.() : undefined;
      const batch = nameTreeFiles(snapshot, { profile });
      const folder = await window.api.saveFilesToFolder({ files: batch.files, folderName: basename(snapshot.cfg.name),
        ...(profile ? { bambuPlates: batch.plateFiles } : {}) });
      if (folder) this.cb.toast(`${batch.plates.length} placas por color, STL, montaje y proyecto guardados en: ${folder}`);
      return folder;
    } finally { dispose(snapshot); this.busy = false; this.buttons(); }
  }
  async action(action, el) {
    if (action === 'home') { this.cb.onBack(); return; }
    if (action === 'suggest') {
      const changes = this.suggestions?.[+el?.dataset.i]?.changes;
      if (changes) { Object.assign(this.cfg, changes); this.sync(); this.schedule(); }
      return;
    }
    if (action === 'open') { this.$('fileProject').click(); return; }
    if (action === 'shape') { this.$('fileShape').click(); return; }
    if (action === 'reset') { this.cfg = DEFAULT_NAME_TREE(); this.sync(); this.schedule(); return; }
    if (action === 'fit') { this.fit(); return; }
    if (action === 'save') return this.saveProject();
    if (action === 'export') return this.exportAll();
    await this.whenIdle();
    if (action === 'assembly') return window.api.saveFile({ defaultPath: basename(this.cfg.name) + '_armado_NO_IMPRIMIR.3mf',
      filters: [{ name: 'Vista armada', extensions: ['3mf'] }], data: nameTreeAssembly(this.res) });
    if (action === 'photo') return window.api.saveFile({ defaultPath: basename(this.cfg.name) + '.png',
      filters: [{ name: 'Imagen PNG', extensions: ['png'] }], data: Uint8Array.from(atob(this.viewer.snapshot().split(',')[1]), c => c.charCodeAt(0)) });
  }
}
