import * as THREE from 'three';
import { Viewer3D } from './viewer3d.js';
import { prepareKeyring, inspectKeyringSource, buildKeyring, exportKeyring } from './core/keyring_3mf.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => Number(String(v).trim().replace(',', '.'));
const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString('es-CO');
const fileBase = (s) => String(s || 'modelo').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/, '').trim() || 'modelo';

function boxFor(parts) {
  const box = new THREE.Box3();
  for (const p of parts) for (let i = 0; i < p.V.length; i += 3) box.expandByPoint(new THREE.Vector3(p.V[i], p.V[i + 1], p.V[i + 2]));
  return box;
}

export class Keyring3MFStudio {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.scene = null;
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
      <div class="brand"><span class="logo">◆</span> Relieve3D <span class="module-name">· 🔗 Argolla para 3MF</span></div>
      <button class="btn" data-a="open">📂 Abrir 3MF</button>
      <div class="spacer"></div>
      <button class="btn primary" data-a="export" data-r="export" disabled>⬇ Guardar copia con argolla</button>
    </header>
    <main class="layout studio-layout hb-layout cs-layout">
      <aside class="panel left">
        <section class="card">
          <h3>1. Modelo original</h3>
          <div class="muted small" data-r="info">Abre o arrastra un 3MF listo para imprimir. El original no se modifica.</div>
          <label class="row">Objeto a unir <select data-k="itemIndex" data-r="item"></select></label>
        </section>
        <section class="card">
          <h3>2. Posición de la argolla</h3>
          <label class="row">Lado <select data-k="side"><option value="top">Arriba</option><option value="bottom">Abajo</option><option value="left">Izquierda</option><option value="right">Derecha</option></select></label>
          <label class="row" title="0 % es izquierda o abajo; 100 % es derecha o arriba">Posición en el lado (%) <input ${N} data-k="position" value="50" /></label>
          <label class="row" title="Desde la cara inferior del objeto. Si es mayor que cero, la argolla puede necesitar soportes">Altura sobre la pieza (mm) <input ${N} data-k="zOffset" value="0" /></label>
          <label class="row">Diámetro exterior (mm) <input ${N} data-k="outer" value="10" /></label>
          <label class="row">Diámetro del agujero (mm) <input ${N} data-k="inner" value="4" /></label>
          <label class="row">Grosor (mm) <input ${N} data-k="thickness" value="2.4" /></label>
          <label class="row" title="Material que entra en el objeto; muy poco produce una unión débil">Solapamiento (mm) <input ${N} data-k="overlap" value="1.5" /></label>
          <label class="row">Color de referencia <input type="color" data-k="color" value="#ffffff" /></label>
          <label class="row" title="Número del filamento existente en Bambu Studio / Orca">Filamento del laminador <input ${N} data-k="extruder" value="1" /></label>
          <button class="btn wide primary" data-a="apply" data-r="apply" disabled>↻ Comprobar y actualizar</button>
        </section>
      </aside>
      <section class="center">
        <div class="views mode-3d"><div class="view dark" data-r="view"></div></div>
        <div class="statusbar"><span data-r="status">Abre un 3MF.</span></div>
      </section>
      <aside class="panel right">
        <section class="card">
          <h3>Comprobación</h3>
          <div class="small" data-r="summary">La argolla se coloca en el plano de impresión del archivo.</div>
          <div class="hb-warn" data-r="warn"></div>
        </section>
        <section class="card">
          <h3>Antes de imprimir</h3>
          <div class="small muted">Se conservan las mallas, colores y medidas originales; la argolla se agrega al objeto seleccionado. Las piezas separadas no se fusionan automáticamente. Abre la copia en el laminador, comprueba posición, color, unión y cama, y vuelve a laminar: se descartan el G-code y las miniaturas anteriores. Haz una impresión de prueba.</div>
        </section>
      </aside>
    </main>
    <input type="file" data-r="file" accept=".3mf" hidden />`;
    this.$ = (name) => this.root.querySelector(`[data-r="${name}"]`);
    this.root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'home') this.cb.onBack();
      else if (a === 'open') this.$('file').click();
      else if (a === 'apply') this.rebuild();
      else if (a === 'export') this.export();
    });
    this.root.addEventListener('input', (e) => {
      if (e.target.dataset.k && this.scene) {
        this.seq++;
        this.res = null;
        this.$('export').disabled = true;
        this.$('status').textContent = 'Cambios pendientes: pulsa «Comprobar y actualizar».';
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
    if (!/\.3mf$/i.test(file.name)) { this.cb.toast('Abre un archivo .3mf.', true); return; }
    const load = ++this.loadSeq;
    this.seq++;
    this.cb.showBusy('Leyendo y comprobando el 3MF…');
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      await prepareKeyring();
      const scene = inspectKeyringSource(new Uint8Array(await file.arrayBuffer()));
      if (load !== this.loadSeq) return;
      this.scene = scene;
      this.name = file.name.replace(/\.3mf$/i, '');
      this.res = null;
      this.$('item').innerHTML = scene.model.instances.map((item) => {
        const parts = scene.model.parts.filter((p) => p.instanceIndex === item.index);
        const label = parts[0]?.name || `Objeto ${item.index + 1}`;
        return `<option value="${item.index}">${esc(label)} (${parts.length} pieza${parts.length === 1 ? '' : 's'})</option>`;
      }).join('');
      this.$('apply').disabled = false;
      const box = boxFor(scene.model.parts), size = box.getSize(new THREE.Vector3());
      this.$('info').innerHTML = `<b>${esc(this.name)}</b><br>${scene.model.instances.length} objeto(s), ${scene.model.parts.length} pieza(s)<br>${fmt(size.x)} × ${fmt(size.y)} × ${fmt(size.z)} mm`;
      this.render();
      this.viewer.frame();
    } catch (err) {
      if (load !== this.loadSeq) return;
      this.scene = null;
      this.res = null;
      this.$('apply').disabled = true;
      this.$('export').disabled = true;
      this.$('info').textContent = 'No hay un 3MF válido abierto.';
      this.viewer?.clear();
      this.cb.toast('No se pudo abrir el 3MF: ' + err.message, true);
      return;
    } finally { this.cb.hideBusy(); }
    await this.rebuild();
  }

  options() {
    const get = (k) => this.root.querySelector(`[data-k="${k}"]`).value;
    return {
      itemIndex: Number(get('itemIndex')), side: get('side'), position: num(get('position')) / 100,
      zOffset: num(get('zOffset')), outer: num(get('outer')), inner: num(get('inner')),
      thickness: num(get('thickness')), overlap: num(get('overlap')), color: get('color'), extruder: num(get('extruder')),
    };
  }

  async rebuild() {
    if (!this.scene) return;
    const seq = ++this.seq;
    this.cb.showBusy('Comprobando la unión y el agujero…');
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const result = buildKeyring(this.scene, this.options());
      if (seq !== this.seq) return;
      this.res = result;
      const referenceOnly = /no[_ -]?imprimir/i.test(this.name);
      this.$('export').disabled = referenceOnly;
      this.$('warn').textContent = referenceOnly
        ? 'Este archivo se identifica como vista de montaje, no como placa imprimible. Agregar la argolla no convierte el montaje en una pieza imprimible.'
        : this.res.options.zOffset > 0 ? 'La argolla está elevada: revisa si necesita soportes y si llega a la cara deseada.' : '';
      this.$('summary').textContent = `Unión volumétrica: ${fmt(this.res.attachmentVolume)} mm³. Agujero libre. La argolla es un sólido cerrado; verifica la resistencia con una impresión de prueba.`;
      this.$('status').textContent = referenceOnly ? 'Vista de referencia: abre una placa imprimible para exportar.' : 'Argolla comprobada · guarda una copia y vuelve a laminar.';
      this.render();
      this.viewer.frame();
    } catch (err) {
      if (seq !== this.seq) return;
      this.res = null;
      this.$('export').disabled = true;
      this.$('warn').textContent = err.message;
      this.$('summary').textContent = 'No se exportará hasta que la unión y el agujero sean válidos.';
      this.$('status').textContent = 'Ajusta los valores y vuelve a comprobar.';
      this.render();
    } finally { this.cb.hideBusy(); }
  }

  render() {
    if (!this.viewer || !this.scene) return;
    const v = this.viewer, model = this.scene.model, box = boxFor(model.parts);
    v.clear();
    const cols = model.palette.map((color) => new THREE.Color(color));
    model.parts.forEach((p, index) => {
      const count = p.T.length / 3, pos = new Float32Array(count * 9), colors = new Float32Array(count * 9);
      for (let i = 0; i < count; i++) for (let j = 0; j < 3; j++) {
        const source = p.T[i * 3 + j] * 3, color = cols[p.tc[i]] || cols[0];
        pos.set([p.V[source], p.V[source + 1], p.V[source + 2]], i * 9 + j * 3);
        colors.set([color.r, color.g, color.b], i * 9 + j * 3);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      const mesh = v.addPiece(`original-${index}`, geometry);
      mesh.material.vertexColors = true;
      v.updatePiece(`original-${index}`, { color: '#ffffff', height: 1, z: 0, visible: true });
    });
    if (this.res) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.res.V), 3));
      geometry.setIndex(new THREE.BufferAttribute(this.res.T, 1));
      geometry.computeVertexNormals();
      v.addPiece('ring', geometry);
      v.updatePiece('ring', { color: this.res.options.color, height: 1, z: 0, visible: true });
    }
    const center = box.getCenter(new THREE.Vector3());
    v.model.position.set(-center.x, -center.y, -box.min.z);
    v.requestRender();
  }

  async export() {
    if (!this.scene || !this.res || /no[_ -]?imprimir/i.test(this.name)) return null;
    this.cb.showBusy('Guardando una copia del 3MF…');
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const data = exportKeyring(this.scene, this.res);
      const saved = await window.api.saveFile({ defaultPath: `${fileBase(this.name)}_con_argolla.3mf`, filters: [{ name: '3MF', extensions: ['3mf'] }], data });
      if (saved) this.cb.toast('Copia guardada. Compruébala y vuelve a laminar antes de imprimir.');
      return saved;
    } catch (err) {
      this.cb.toast('No se pudo guardar: ' + err.message, true);
      return null;
    } finally { this.cb.hideBusy(); }
  }
}
