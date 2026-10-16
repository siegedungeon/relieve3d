import { COLORING_DEFAULTS, coloringOptions, coloringLayout, applyColoringEdits, validateColoringEdits,
  coloringShapes, coloringSVG, coloringPDF, coloringPngDPI } from './core/coloring.js';
import { imageReady } from './core/imageload.js';

const fmt = n => String(Math.round(n * 100) / 100);
const safeName = s => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/, '').trim() || 'lamina-colorear';
const fields = [
  ['colors', 'Colores a distinguir', 'Menos colores simplifica sombras y zonas pequeñas. Entre 2 y 24.'],
  ['contrast', 'Contraste mínimo', 'Une colores parecidos. Sube este valor para quitar fronteras entre sombras suaves.'],
  ['minDetail', 'Quitar detalles finos (mm)', 'Elimina zonas de color más estrechas que esto antes de dibujar sus bordes. 0 conserva los detalles.'],
  ['minArea', 'Quitar motas (mm²)', 'Fusiona elementos pequeños con su alrededor. 0 conserva las motas.'],
  ['smooth', 'Suavizado (0–4)', 'Pasadas adicionales para limpiar bordes irregulares.'],
  ['lineWidth', 'Grosor negro (mm)', 'Grosor de los contornos en la página final.'],
  ['shadowTolerance', 'Quitar sombras (0–120)', 'En modo ilustración une tonos del mismo color sin convertir cada sombra en un contorno. 0 conserva las sombras.'],
];

export class ColoringStudio {
  constructor(root, cb) {
    this.root = root; this.cb = cb;
    this.state = { name: 'lamina-colorear', source: null, options: { ...COLORING_DEFAULTS, mode: 'illustration', colors: 16 }, edits: [] };
    this.hist = []; this.hidx = -1; this.seq = 0; this.loadSeq = 0;
    this.fieldErrors = new Map(); this.stale = true; this.loading = false;
    this.tool = 'erase'; this.brushMM = 3; this.original = false;
    this.view = { scale: 1, x: 0, y: 0 };
    this.build();
  }

  build() {
    const row = ([key, label, title]) => `<label class="row" title="${title}">${label}<input type="text" inputmode="decimal" data-opt="${key}" /></label>`;
    this.root.innerHTML = `
      <header class="topbar">
        <button class="btn" data-a="home">⌂ Inicio</button>
        <div class="brand"><span class="logo">◆</span> Relieve3D <span class="module-name">· Para colorear</span></div>
        <button class="btn" data-a="image">🖼️ Imagen</button>
        <button class="btn" data-a="project">📂 Proyecto</button>
        <button class="btn" data-a="save">💾 Guardar</button>
        <button class="btn icon" data-a="undo" title="Deshacer (Ctrl+Z)">↶</button>
        <button class="btn icon" data-a="redo" title="Rehacer (Ctrl+Y)">↷</button>
        <div class="spacer"></div>
        <button class="btn" data-export="svg">SVG</button>
        <button class="btn" data-export="png">PNG</button>
        <button class="btn primary" data-export="pdf">PDF</button>
      </header>
      <main class="layout studio-layout hb-layout coloring-layout">
        <aside class="panel left">
          <section class="card">
            <h3>Convertir a contornos</h3>
            <label class="row">Conversión <select data-opt="mode"><option value="illustration">Ilustración sin sombras</option><option value="regions">Zonas de color</option></select></label>
            ${fields.map(row).join('')}
            <label class="row" title="Conserva líneas oscuras estrechas y, en modo ilustración, marcos de color como un solo trazo. Las áreas oscuras grandes se vacían.">Conservar trazos originales <input type="checkbox" data-opt="keepInk" /></label>
            <label class="row" title="Blanquea fondos claros conectados al borde, incluidos dameros grises incrustados. No quita fondos oscuros o de color intenso.">Limpiar fondo claro <input type="checkbox" data-opt="cleanBackground" /></label>
            ${row(['backgroundTolerance', 'Tolerancia de fondo', 'Diferencia RGB admitida al limpiar el fondo claro. Baja el valor si se pierden zonas pálidas del dibujo.'])}
            <button class="btn primary wide" data-a="generate">Generar / actualizar</button>
            <p class="small muted">Ideal para ilustraciones. Las fotos pueden necesitar menos colores y mayor limpieza. No usa IA ni envía la imagen a internet.</p>
          </section>
          <section class="card">
            <h3>Página</h3>
            <label class="row">Formato <select data-r="paper"><option value="a4">A4</option><option value="letter">Carta</option><option value="custom">Personalizado</option></select></label>
            ${[['pageWidth', 'Ancho (mm)', 'Ancho del papel.'], ['pageHeight', 'Alto (mm)', 'Alto del papel.'], ['margin', 'Margen (mm)', 'El dibujo se centra sin estirarse.']].map(row).join('')}
            <button class="btn wide" data-a="rotate">↔ Cambiar orientación</button>
            <label class="row">PNG (ppp) <select data-opt="dpi"><option>150</option><option>300</option></select></label>
            <p class="small muted">Fondo blanco opaco. PDF y SVG conservan el tamaño de página; imprime el PDF al 100%.</p>
          </section>
        </aside>
        <section class="center">
          <div class="views mode-2d"><div class="view st-view" data-r="view">
            <canvas data-r="canvas"></canvas>
            <div class="floating-tools">
              <button class="tool" data-a="fit" title="Ajustar página">⤢</button>
              <button class="tool toggle" data-a="original">Original</button>
            </div>
            <div class="dropzone" data-r="empty"><div class="dz-inner"><h2>Imagen → lámina para colorear</h2><p>Arrastra una imagen o ábrela para convertirla.</p><button class="btn primary" data-a="image">Abrir imagen</button><button class="btn" data-a="example">Probar ejemplo</button></div></div>
          </div></div>
          <div class="statusbar"><span data-r="status">Abre una imagen.</span></div>
        </section>
        <aside class="panel right">
          <section class="card">
            <h3>Editar líneas y elementos</h3>
            <div class="coloring-tools">
              <button class="btn" data-tool="pan">Mano / mover vista</button>
              <button class="btn" data-tool="erase">Goma: borrar líneas</button>
              <button class="btn" data-tool="rect">Borrar zona / elemento</button>
              <button class="btn" data-tool="draw">Lápiz negro: cerrar líneas</button>
            </div>
            <label class="row">Goma / lápiz (mm)<input type="text" inputmode="decimal" data-r="brush" value="3" /></label>
            <p class="small muted">Arrastra para editar. «Borrar zona» elimina todo dentro del rectángulo. Rueda: zoom. Botón derecho: mover vista.</p>
            <button class="btn wide" data-a="reset">Quitar ediciones manuales</button>
            <p class="small muted">Las ediciones se conservan al ajustar la limpieza y al guardar el proyecto. Deshacer y rehacer también recuperan parámetros.</p>
          </section>
          <section class="card">
            <h3>Salida</h3>
            <div class="hb-warn" data-r="warning"></div>
            <p class="small muted" data-r="info">Solo negro sólido y blanco, sin rellenos de color.</p>
            <p class="small muted">PNG: imagen en blanco y negro. SVG: contornos vectoriales editables. PDF: una lámina lista para imprimir.</p>
          </section>
        </aside>
      </main>
      <input type="file" data-r="file" accept="image/*" hidden />
      <input type="file" data-r="fileProject" accept=".r3c,.json" hidden />`;
    this.$ = name => this.root.querySelector(`[data-r="${name}"]`);
    this.canvas = this.$('canvas'); this.ctx = this.canvas.getContext('2d');
    this.bitmap = document.createElement('canvas');
    this.bind();
    new ResizeObserver(() => { if (!this.root.hidden) this.resize(); }).observe(this.$('view'));
    this.sync();
  }

  bind() {
    this.root.addEventListener('click', async e => {
      try {
        const action = e.target.closest('[data-a]')?.dataset.a;
        const tool = e.target.closest('[data-tool]')?.dataset.tool;
        const format = e.target.closest('[data-export]')?.dataset.export;
        if (tool) { this.tool = tool; this.original = false; this.sync(); this.draw(); }
        if (format) await this.export(format);
        if (action === 'home') this.cb.onBack();
        else if (action === 'image') this.$('file').click();
        else if (action === 'project') this.$('fileProject').click();
        else if (action === 'save') await this.saveProject();
        else if (action === 'undo') await this.undo();
        else if (action === 'redo') await this.redo();
        else if (action === 'generate') await this.generate();
        else if (action === 'fit') this.fit();
        else if (action === 'original') { this.original = !this.original; this.sync(); this.draw(); }
        else if (action === 'rotate') this.setOptions({ pageWidth: this.state.options.pageHeight, pageHeight: this.state.options.pageWidth });
        else if (action === 'reset' && this.state.edits.length) {
          this.assertReady(); this.state.edits = []; this.compose(); this.commit();
        } else if (action === 'example') {
          const response = await fetch('./examples/coloring-scene.svg');
          if (!response.ok) throw new Error('No se pudo cargar el ejemplo.');
          await this.loadFile(new File([await response.blob()], 'Ejemplo_colorear.svg', { type: 'image/svg+xml' }));
        }
      } catch (error) { this.report(error); }
    });
    this.root.addEventListener('change', e => {
      const el = e.target, key = el.dataset.opt;
      try {
        if (key) {
          const value = key === 'mode' ? el.value : el.type === 'checkbox' ? el.checked : Number(el.value.trim().replace(',', '.'));
          if (el.type !== 'checkbox' && !el.value.trim()) throw new Error('Escribe un valor numérico.');
          this.setOptions({ [key]: value }); this.fieldErrors.delete(key); el.removeAttribute('aria-invalid'); this.sync();
        } else if (el === this.$('paper') && el.value !== 'custom') {
          this.setOptions(el.value === 'a4' ? { pageWidth: 210, pageHeight: 297 } : { pageWidth: 215.9, pageHeight: 279.4 });
        } else if (el === this.$('brush')) {
          const value = Number(el.value.trim().replace(',', '.'));
          if (!Number.isFinite(value) || value < 0.2 || value > 30) throw new Error('Usa una goma o lápiz entre 0.2 y 30 mm.');
          this.brushMM = value;
        }
      } catch (error) {
        if (key) { this.fieldErrors.set(key, error.message); el.setAttribute('aria-invalid', 'true'); this.sync(); }
        else if (el === this.$('brush')) el.value = fmt(this.brushMM);
        this.report(error);
      }
    });
    for (const name of ['file', 'fileProject']) this.$(name).addEventListener('change', async e => {
      const file = e.target.files[0]; e.target.value = '';
      if (file) await this.loadFile(file);
    });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const p = this.screen(e), v = this.view, factor = Math.exp(-e.deltaY * 0.001);
      const scale = Math.min(80, Math.max(0.2, v.scale * factor)), k = scale / v.scale;
      v.x = p.x - (p.x - v.x) * k; v.y = p.y - (p.y - v.y) * k; v.scale = scale; this.draw();
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', e => this.pointerDown(e));
    this.canvas.addEventListener('pointermove', e => this.pointerMove(e));
    this.canvas.addEventListener('pointerup', e => this.pointerUp(e));
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; this.draw(); });
    window.addEventListener('keydown', async e => {
      if (this.root.hidden || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || !(e.ctrlKey || e.metaKey)) return;
      try {
        const k = e.key.toLowerCase();
        if (k === 'z' || k === 'y') { e.preventDefault(); await (k === 'y' || e.shiftKey ? this.redo() : this.undo()); }
        else if (k === 's') { e.preventDefault(); await this.saveProject(); }
      } catch (error) { this.report(error); }
    });
  }

  report(error) { console.error(error); this.cb.toast(error.message || String(error), true); }
  status(message) { this.$('status').textContent = message; }
  ready() { return !!this.base && !this.stale && !this.worker && !this.loading && !this.fieldErrors.size; }
  assertReady() {
    if (!this.ready() || this.drag?.edit) throw new Error('Termina la edición y pulsa «Generar / actualizar» antes de guardar o exportar.');
  }
  sync() {
    for (const el of this.root.querySelectorAll('[data-opt]')) {
      const key = el.dataset.opt;
      if (this.fieldErrors.has(key)) continue;
      el.removeAttribute('aria-invalid');
      if (el.type === 'checkbox') el.checked = this.state.options[key]; else el.value = this.state.options[key];
      if (key === 'shadowTolerance') el.disabled = this.state.options.mode !== 'illustration';
    }
    const o = this.state.options;
    this.$('paper').value = o.pageWidth === 210 && o.pageHeight === 297 ? 'a4' : o.pageWidth === 215.9 && o.pageHeight === 279.4 ? 'letter' : 'custom';
    this.root.querySelector('[data-a="undo"]').disabled = this.hidx <= 0 || this.loading;
    this.root.querySelector('[data-a="redo"]').disabled = this.hidx >= this.hist.length - 1 || this.loading;
    this.root.querySelector('[data-a="generate"]').disabled = !this.sourceCanvas || this.loading || this.fieldErrors.size > 0;
    this.root.querySelector('[data-a="save"]').disabled = !this.ready();
    for (const el of this.root.querySelectorAll('[data-export]')) el.disabled = !this.ready() || !this.pixels;
    for (const el of this.root.querySelectorAll('[data-tool]')) el.classList.toggle('primary', this.tool === el.dataset.tool && !this.original);
    this.root.querySelector('[data-a="original"]').classList.toggle('active', this.original);
    this.$('empty').hidden = !!this.sourceCanvas;
    this.$('warning').textContent = [...this.fieldErrors.values()][0] || this.error || (this.stale && this.sourceCanvas ? 'Hay cambios pendientes. Genera de nuevo antes de exportar.' : '');
    this.$('info').textContent = this.base ? `${this.base.colors} colores de origen → negro y blanco. ${this.state.edits.length} ediciones manuales. Página ${fmt(o.pageWidth)} × ${fmt(o.pageHeight)} mm.` : 'Solo negro sólido y blanco, sin rellenos de color.';
    this.canvas.style.cursor = this.tool === 'pan' ? 'grab' : 'crosshair';
  }

  async open() {
    this.root.hidden = false; this.resize(); this.fit(); this.sync();
    if (this.sourceCanvas && this.stale && !this.loading && !this.worker && !this.fieldErrors.size) await this.generate();
  }
  close() { this.root.hidden = true; ++this.loadSeq; this.loading = false; this.drag = null; this.cancelJob(); }
  cancelJob() {
    ++this.seq; this.worker?.terminate(); this.worker = null;
    this.cancelResolve?.({ cancelled: true }); this.cancelResolve = null;
  }
  setOptions(patch) {
    if (this.loading) throw new Error('Espera a que termine de abrirse la imagen.');
    const options = coloringOptions({ ...this.state.options, ...patch });
    this.cancelJob(); this.state.options = options; this.stale = true; this.error = '';
    this.commit(); this.sync(); this.draw();
  }
  async prepare(dataURL) {
    if (typeof dataURL !== 'string' || !/^data:image\//.test(dataURL) || dataURL.length > 60000000) throw new Error('Imagen del proyecto inválida o demasiado grande.');
    const image = new Image(); image.src = dataURL; await imageReady(image);
    const f = Math.min(4, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(image.naturalWidth * f)); canvas.height = Math.max(2, Math.round(image.naturalHeight * f));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  async loadFile(file) {
    let ticket;
    try {
      const project = /\.(r3c|json)$/i.test(file.name);
      if (!project && !/^image\//.test(file.type) && !/\.(png|jpe?g|webp|bmp|gif|svg)$/i.test(file.name)) throw new Error('Abre una imagen PNG, JPG, WEBP, BMP, GIF o SVG, o un proyecto .r3c.');
      if (!project && file.size > 40000000) throw new Error('La imagen supera 40 MB.');
      ticket = ++this.loadSeq; this.cancelJob(); this.loading = true; this.sync(); this.status(project ? 'Abriendo proyecto…' : 'Abriendo imagen…');
      if (project) {
        const data = JSON.parse(await file.text());
        if (ticket !== this.loadSeq) return false;
        return await this.openProject(data, ticket);
      }
      const dataURL = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('No se pudo leer la imagen.')); reader.readAsDataURL(file);
      });
      const canvas = await this.prepare(dataURL);
      if (ticket !== this.loadSeq) return;
      this.sourceCanvas = canvas;
      this.state = { name: safeName(file.name.replace(/\.[^.]+$/, '')), source: { dataURL: canvas.toDataURL('image/png') }, options: { ...this.state.options }, edits: [] };
      this.base = null; this.mask = null; this.error = ''; this.fieldErrors.clear(); this.original = false;
      this.hist = []; this.hidx = -1; this.loading = false; this.stale = true; this.commit(); this.fit();
      await this.generate();
    } catch (error) {
      if (ticket !== undefined && ticket !== this.loadSeq) return;
      this.loading = false; this.report(error); this.sync();
    }
  }
  async generate() {
    if (!this.sourceCanvas) { this.cb.toast('Abre una imagen primero.', true); return false; }
    this.cancelJob();
    const ticket = this.seq;
    this.stale = true; this.error = ''; this.sync();
    try {
      if (this.fieldErrors.size) throw new Error('Corrige los parámetros marcados.');
      const options = coloringOptions(this.state.options);
      const image = this.sourceCanvas.getContext('2d').getImageData(0, 0, this.sourceCanvas.width, this.sourceCanvas.height);
      this.status('Preparando la conversión…');
      const answer = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./coloring_worker.js', import.meta.url), { type: 'module' });
        this.worker = worker; this.cancelResolve = resolve;
        worker.onmessage = ({ data }) => {
          if (ticket !== this.seq) return;
          if (data.progress) this.status(data.progress);
          else if (data.error) reject(new Error(data.error)); else resolve(data);
        };
        worker.onerror = e => { e.preventDefault(); reject(new Error(e.message || 'Falló la conversión de la imagen.')); };
        worker.postMessage({ image, options }, [image.data.buffer]);
      });
      if (answer.cancelled || ticket !== this.seq) return false;
      this.base = answer.result; this.stale = false; this.compose(); this.commit();
      this.status('Lámina lista. Borra lo que no necesites o exporta.');
      return true;
    } catch (error) {
      if (ticket === this.seq) { this.error = error.message; this.status('No se pudo generar la lámina.'); this.report(error); }
      return false;
    } finally {
      if (ticket === this.seq) { this.worker?.terminate(); this.worker = null; this.cancelResolve = null; this.sync(); this.draw(); }
    }
  }
  compose() {
    if (!this.base) return;
    this.mask = applyColoringEdits(this.base, this.state.edits); this.pixels = 0;
    this.bitmap.width = this.base.width; this.bitmap.height = this.base.height;
    const ctx = this.bitmap.getContext('2d'), image = ctx.createImageData(this.base.width, this.base.height);
    for (let i = 0; i < this.mask.length; i++) {
      const v = this.mask[i] ? 0 : 255; this.pixels += this.mask[i];
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v; image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0); this.sync(); this.draw();
  }
  commit() {
    if (!this.state.source) return;
    const snapshot = JSON.stringify({ name: this.state.name, options: this.state.options, edits: this.state.edits });
    if (this.hist[this.hidx] === snapshot) return;
    this.hist = this.hist.slice(0, this.hidx + 1); this.hist.push(snapshot);
    if (this.hist.length > 50) this.hist.shift();
    this.hidx = this.hist.length - 1; this.sync();
  }
  async restore(index) {
    if (index < 0 || index >= this.hist.length || this.loading) return;
    this.cancelJob(); const old = JSON.stringify(this.state.options), next = JSON.parse(this.hist[index]);
    this.hidx = index; Object.assign(this.state, next); this.fieldErrors.clear(); this.error = ''; this.drag = null;
    if (old !== JSON.stringify(next.options) || this.stale) await this.generate();
    else this.compose();
    this.sync();
  }
  async undo() { await this.restore(this.hidx - 1); }
  async redo() { await this.restore(this.hidx + 1); }

  resize() {
    const rect = this.$('view').getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.canvas.width = Math.round(rect.width * devicePixelRatio); this.canvas.height = Math.round(rect.height * devicePixelRatio);
    this.draw();
  }
  fit() {
    const rect = this.$('view').getBoundingClientRect(), o = this.state.options;
    if (!rect.width || !rect.height) return;
    const scale = Math.max(0.2, Math.min((rect.width - 50) / o.pageWidth, (rect.height - 50) / o.pageHeight));
    this.view = { scale, x: (rect.width - o.pageWidth * scale) / 2, y: (rect.height - o.pageHeight * scale) / 2 }; this.draw();
  }
  draw() {
    if (this.root.hidden) return;
    const ctx = this.ctx, v = this.view, o = this.state.options, dpr = devicePixelRatio;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.x, dpr * v.y);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, o.pageWidth, o.pageHeight);
    if (this.sourceCanvas) {
      const l = coloringLayout(this.sourceCanvas.width, this.sourceCanvas.height, o);
      ctx.imageSmoothingEnabled = v.scale * l.scale < 2;
      const source = this.original || !this.mask ? this.sourceCanvas : this.bitmap;
      ctx.drawImage(source, l.x, l.y, l.width, l.height);
      if (this.drag?.edit) {
        const edit = this.drag.edit, points = edit.points.map(([x, y]) => [l.x + x * l.width, l.y + y * l.height]);
        ctx.lineJoin = ctx.lineCap = 'round';
        if (edit.kind === 'rect') {
          ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1 / v.scale;
          const [a, b] = points; ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
        } else {
          ctx.strokeStyle = edit.kind === 'erase' ? '#ffffff' : '#000000';
          ctx.lineWidth = edit.width * Math.max(this.sourceCanvas.width, this.sourceCanvas.height) * l.scale;
          ctx.beginPath(); ctx.moveTo(...points[0]); for (const p of points) ctx.lineTo(...p);
          if (points.length === 1) ctx.lineTo(points[0][0] + 0.001, points[0][1]);
          ctx.stroke();
        }
      }
    }
  }
  screen(e) { const b = this.canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
  imagePoint(e, clamp = false) {
    const p = this.screen(e), v = this.view, l = coloringLayout(this.sourceCanvas.width, this.sourceCanvas.height, this.state.options);
    const x = ((p.x - v.x) / v.scale - l.x) / l.width, y = ((p.y - v.y) / v.scale - l.y) / l.height;
    if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
  }
  pointerDown(e) {
    if (e.button !== 0 && e.button !== 2) return;
    if (e.button === 2 || this.tool === 'pan') this.drag = { start: this.screen(e), view: { ...this.view } };
    else {
      if (!this.ready() || this.original) { this.cb.toast('Genera la lámina y desactiva «Original» para editar.', true); return; }
      const p = this.imagePoint(e); if (!p) return;
      const l = coloringLayout(this.base.width, this.base.height, this.state.options);
      this.drag = { edit: { kind: this.tool, points: this.tool === 'rect' ? [p, p] : [p], width: this.brushMM / l.scale / Math.max(this.base.width, this.base.height) } };
    }
    this.canvas.setPointerCapture(e.pointerId); e.preventDefault(); this.draw();
  }
  pointerMove(e) {
    if (!this.drag) return;
    if (this.drag.view) {
      const p = this.screen(e); this.view.x = this.drag.view.x + p.x - this.drag.start.x; this.view.y = this.drag.view.y + p.y - this.drag.start.y;
    } else {
      const p = this.imagePoint(e, true), points = this.drag.edit.points, last = points[points.length - 1];
      if (this.drag.edit.kind === 'rect') points[1] = p;
      else if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.0005) points.push(p);
    }
    this.draw();
  }
  pointerUp(e) {
    if (!this.drag) return;
    this.pointerMove(e); const edit = this.drag.edit; this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (edit) {
      try { validateColoringEdits([...this.state.edits, edit]); this.state.edits.push(edit); this.compose(); this.commit(); }
      catch (error) { this.report(error); }
    }
    this.draw();
  }
  async saveProject() {
    this.assertReady();
    const data = JSON.stringify({ app: 'Relieve3D-Coloring', version: 1, state: this.state });
    const saved = await window.api.saveFile({ defaultPath: this.state.name + '.r3c', filters: [{ name: 'Proyecto para colorear', extensions: ['r3c'] }], data });
    if (saved) this.cb.toast('Proyecto guardado: ' + saved);
  }
  async openProject(j, ticket) {
    if (j?.app !== 'Relieve3D-Coloring' || j.version !== 1 || !j.state?.source) throw new Error('No es un proyecto válido para colorear.');
    const options = coloringOptions(j.state.options); validateColoringEdits(j.state.edits);
    ticket ??= ++this.loadSeq; this.cancelJob(); this.loading = true; this.sync();
    try {
      const canvas = await this.prepare(j.state.source.dataURL);
      if (ticket !== this.loadSeq) return false;
      this.state = { name: safeName(j.state.name), source: { dataURL: canvas.toDataURL('image/png') }, options, edits: JSON.parse(JSON.stringify(j.state.edits)) };
      this.sourceCanvas = canvas; this.base = null; this.mask = null; this.error = ''; this.fieldErrors.clear();
      this.hist = []; this.hidx = -1; this.loading = false; this.stale = true; this.original = false;
      this.root.hidden = false; this.resize(); this.fit(); this.commit(); await this.generate();
      return ticket === this.loadSeq && !this.root.hidden;
    } finally { if (ticket === this.loadSeq) { this.loading = false; this.sync(); } }
  }

  async export(kind) {
    this.assertReady();
    if (!['png', 'svg', 'pdf'].includes(kind)) throw new Error('Formato de exportación desconocido.');
    if (!this.pixels) throw new Error('La lámina está vacía. Deshaz el borrado o dibuja antes de exportar.');
    const { width: W, height: H } = this.base, o = { ...this.state.options }, name = this.state.name, mask = this.mask.slice();
    this.cb.showBusy('Preparando lámina…');
    try {
      await new Promise(resolve => setTimeout(resolve, 30));
      const shapes = coloringShapes(mask, W, H);
      if (!shapes.length) throw new Error('No hay contornos exportables.');
      let data;
      if (kind === 'svg') data = coloringSVG(shapes, W, H, o);
      else if (kind === 'pdf') data = coloringPDF(shapes, W, H, o);
      else {
        const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(coloringSVG(shapes, W, H, o)); await imageReady(image);
        const canvas = document.createElement('canvas'); canvas.width = Math.round(o.pageWidth * o.dpi / 25.4); canvas.height = Math.round(o.pageHeight * o.dpi / 25.4);
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const v = pixels.data[i] >= 128 ? 255 : 0;
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v; pixels.data[i + 3] = 255;
        }
        ctx.putImageData(pixels, 0, 0);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('No se pudo codificar el PNG.');
        data = coloringPngDPI(new Uint8Array(await blob.arrayBuffer()), o.dpi);
      }
      const saved = await window.api.saveFile({ defaultPath: name + '.' + kind, filters: [{ name: kind.toUpperCase(), extensions: [kind] }], data });
      if (saved) this.cb.toast('Exportado: ' + saved);
    } finally { this.cb.hideBusy(); }
  }
}
