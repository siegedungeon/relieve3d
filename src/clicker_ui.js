import * as THREE from 'three';
import { Viewer3D } from './viewer3d.js';
import { imageReady } from './core/imageload.js';
import { prepareClicker, buildClicker, exportClicker } from './core/clicker.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => Number(String(v).trim().replace(',', '.'));
const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString('es-CO');
const fileBase = (s) => String(s || 'clicker').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/, '').trim() || 'clicker';
const imageFile = (file) => /^image\//i.test(file.type || '') || /\.(png|jpe?g|webp|bmp|gif|svg)$/i.test(file.name || '');

async function imagePixels(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await imageReady(img);
    if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) throw new Error('La imagen no tiene dimensiones válidas.');
    const scale = Math.min(1, 700 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally { URL.revokeObjectURL(url); }
}

export class ClickerStudio {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.image = null;
    this.res = null;
    this.name = '';
    this.seq = 0;
    this.loadSeq = 0;
    this.build();
  }

  build() {
    const N = 'type="text" inputmode="decimal"';
    this.root.innerHTML = `
    <header class="topbar">
      <button class="btn" data-a="home">⌂ Inicio</button>
      <div class="brand"><span class="logo">◆</span> Relieve3D <span class="module-name">· 🖱️ Clicker desde imagen</span></div>
      <button class="btn" data-a="open">📂 Abrir imagen</button>
      <div class="spacer"></div>
      <button class="btn primary" data-a="export" data-r="export" disabled>⬇ Guardar 3MF</button>
    </header>
    <main class="layout studio-layout hb-layout cs-layout">
      <aside class="panel left">
        <section class="card">
          <h3>1. Imagen</h3>
          <div class="muted small" data-r="info">Abre o arrastra una imagen con una silueta conectada.</div>
          <label class="row">Fondo <select data-k="background"><option value="auto">Automático</option><option value="yes">Quitar fondo</option><option value="no">Conservar fondo</option></select></label>
          <label class="row">Colores del diseño <select data-k="colors"><option value="0">Automático</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option></select></label>
        </section>
        <section class="card">
          <h3>2. Medidas y colores</h3>
          <label class="row">Ancho del diseño (mm) <input ${N} data-k="width" value="45" /></label>
          <label class="row">Borde alrededor (mm) <input ${N} data-k="margin" value="0,8" /></label>
          <label class="row">Altura del relieve (mm) <input ${N} data-k="relief" value="0,8" /></label>
          <label class="row">Color de la tapa <input type="color" data-k="capColor" value="#f4e9dc" /></label>
          <label class="row">Color de la base <input type="color" data-k="baseColor" value="#333333" /></label>
        </section>
        <section class="card">
          <h3>3. Ajuste del interruptor MX</h3>
          <label class="row" title="Se suma a las medidas de la cruz interior de la tapa">Holgura del vástago (mm) <input ${N} data-k="stemClearance" value="0,1" /></label>
          <label class="row" title="Se suma a los 14 mm nominales de la abertura de montaje">Holgura del montaje (mm) <input ${N} data-k="mountClearance" value="0,1" /></label>
          <button class="btn wide primary" data-a="apply" data-r="apply" disabled>↻ Generar clicker</button>
        </section>
      </aside>
      <section class="center">
        <div class="views mode-3d"><div class="view dark" data-r="view"></div></div>
        <div class="statusbar"><span data-r="status">Abre una imagen.</span></div>
      </section>
      <aside class="panel right">
        <section class="card">
          <h3>Piezas y ajuste</h3>
          <div class="small" data-r="summary">Genera una tapa con relieve y una base para un interruptor mecánico tipo MX.</div>
          <div class="hb-warn" data-r="warn"></div>
          <label class="row">Formato <select data-r="format"><option value="bambu">Bambu A1 instalado</option><option value="standard">3MF estándar</option></select></label>
        </section>
        <section class="card">
          <h3>Antes de imprimir</h3>
          <div class="small muted">El interruptor MX no está incluido. La vectorización puede simplificar u omitir detalles finos: revisa la vista previa y los colores. La tapa se imprime con el encaje hacia la cama y el diseño hacia arriba; revisa el puente del encaje y usa soportes si tu impresora los necesita. La base queda abierta por detrás. Revisa ambas piezas en el laminador y haz una impresión de prueba: las tolerancias, el ajuste y la resistencia dependen del interruptor, el material y la impresora.</div>
        </section>
      </aside>
    </main>
    <input type="file" data-r="file" accept="image/*,.svg" hidden />`;
    this.$ = (name) => this.root.querySelector(`[data-r="${name}"]`);
    this.root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'home') this.cb.onBack();
      else if (a === 'open') this.$('file').click();
      else if (a === 'apply') this.rebuild();
      else if (a === 'export') this.export();
    });
    this.root.addEventListener('input', (e) => {
      if (e.target.dataset.k && this.image) {
        this.seq++;
        this.res = null;
        this.$('export').disabled = true;
        this.$('status').textContent = 'Cambios pendientes: pulsa «Generar clicker».';
      }
    });
    this.$('file').addEventListener('change', async (e) => {
      const file = e.target.files[0]; e.target.value = '';
      if (file) await this.loadFile(file);
    });
  }

  async open() {
    this.root.hidden = false;
    if (!this.viewer) this.viewer = new Viewer3D(this.$('view'));
    this.viewer.resize();
  }

  close() { this.root.hidden = true; }

  async loadFile(file) {
    if (!imageFile(file)) { this.cb.toast('Abre una imagen PNG, JPG, WebP o SVG.', true); return; }
    if (file.size > 25 * 1024 * 1024) { this.cb.toast('La imagen supera 25 MB; reduce su tamaño.', true); return; }
    const load = ++this.loadSeq;
    this.seq++;
    this.res = null;
    this.$('export').disabled = true;
    this.cb.showBusy('Leyendo la imagen…');
    try {
      const [image] = await Promise.all([imagePixels(file), prepareClicker()]);
      if (load !== this.loadSeq) return;
      this.image = image;
      this.name = file.name.replace(/\.[^.]+$/, '');
      this.$('info').innerHTML = `<b>${esc(file.name)}</b><br>${image.width} × ${image.height} px para el trazado`;
      this.$('apply').disabled = false;
    } catch (err) {
      if (load !== this.loadSeq) return;
      this.image = null;
      this.$('apply').disabled = true;
      this.$('info').textContent = 'No hay una imagen válida abierta.';
      this.$('status').textContent = 'Abre una imagen válida.';
      this.viewer?.clear();
      this.cb.toast('No se pudo abrir la imagen: ' + err.message, true);
      return;
    } finally { this.cb.hideBusy(); }
    await this.rebuild();
  }

  options() {
    const get = (k) => this.root.querySelector(`[data-k="${k}"]`).value;
    return {
      width: num(get('width')), margin: num(get('margin')), relief: num(get('relief')),
      colors: num(get('colors')), background: get('background'),
      stemClearance: num(get('stemClearance')), mountClearance: num(get('mountClearance')),
      capColor: get('capColor'), baseColor: get('baseColor'),
    };
  }

  async rebuild() {
    if (!this.image) return;
    const seq = ++this.seq;
    this.cb.showBusy('Creando la silueta, el relieve y la base…');
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const result = buildClicker(this.image, this.options());
      if (seq !== this.seq) return;
      this.res = result;
      this.$('export').disabled = false;
      this.$('warn').textContent = result.warnings.join(' ');
      this.$('summary').textContent = `2 objetos imprimibles: tapa y base. Abertura MX: ${fmt(result.info.switchOpening)} mm; cruz de la tapa: ${fmt(result.info.socketLength)} × ${fmt(result.info.socketWidth)} mm. ${result.colors.length} colores de filamento${result.colors.length > 4 ? ': comprueba cómo cambiar los filamentos en tu impresora' : ''}. Comprueba el ajuste con tu interruptor.`;
      this.$('status').textContent = 'Clicker generado · comprueba el 3MF y realiza una impresión de prueba.';
      this.render();
      this.viewer.frame();
    } catch (err) {
      if (seq !== this.seq) return;
      this.res = null;
      this.$('export').disabled = true;
      this.$('warn').textContent = err.message;
      this.$('summary').textContent = 'No se exportará hasta que la silueta y el encaje sean válidos.';
      this.$('status').textContent = 'Ajusta los valores o la imagen y vuelve a generar.';
      this.viewer?.clear();
    } finally { this.cb.hideBusy(); }
  }

  render() {
    if (!this.viewer || !this.res) return;
    const v = this.viewer, box = new THREE.Box3();
    v.clear();
    this.res.parts.forEach((p, index) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.V), 3));
      geometry.setIndex(new THREE.BufferAttribute(p.T, 1));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      box.union(geometry.boundingBox);
      v.addPiece(`clicker-${index}`, geometry);
      v.updatePiece(`clicker-${index}`, { color: p.color, height: 1, z: 0, visible: true });
    });
    const center = box.getCenter(new THREE.Vector3());
    v.model.position.set(-center.x, -center.y, -box.min.z);
    v.requestRender();
  }

  async export() {
    if (!this.res) return null;
    this.cb.showBusy('Guardando el clicker…');
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const native = this.$('format').value === 'bambu';
      if (native && !window.api.clickerBambuProfile) throw new Error('El perfil Bambu A1 no está disponible aquí. Selecciona 3MF estándar.');
      const profile = native ? await window.api.clickerBambuProfile(this.res.colors.length) : undefined;
      const data = exportClicker(this.res, this.name, { bambu: profile });
      const saved = await window.api.saveFile({ defaultPath: `${fileBase(this.name)}_clicker${native ? '_Bambu_A1' : ''}.3mf`, filters: [{ name: '3MF', extensions: ['3mf'] }], data });
      if (saved) this.cb.toast('3MF guardado. Comprueba las piezas y realiza una impresión de prueba.');
      return saved;
    } catch (err) {
      this.cb.toast('No se pudo guardar: ' + err.message + (this.$('format').value === 'bambu' ? ' Puedes seleccionar 3MF estándar.' : ''), true);
      return null;
    } finally { this.cb.hideBusy(); }
  }
}
