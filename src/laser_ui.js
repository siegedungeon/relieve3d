import { LASER_DEFAULTS, bounds, transformLoops, validateConfig, validateLayout } from './core/laser_geometry.js';
import { importLaserSVG, groupLaserTemplates, laserSVG, laserProject, readLaserProject, escapeXML as esc } from './laser_svg.js';

const clone = value => JSON.parse(JSON.stringify(value));
const number = value => Number(String(value).replace(',', '.').trim());
const fmt = value => value == null ? '—' : value.toFixed(2);

export class LaserStudio {
  constructor(root, cb) {
    this.root = root; this.cb = cb;
    this.templates = []; this.placements = []; this.config = { ...LASER_DEFAULTS };
    this.selected = new Set(); this.instance = null; this.worker = null; this.best = null;
    this.history = []; this.index = -1; this.dirty = false; this.zoom = 1;
    this.build(); this.commit(false);
  }
  build() {
    this.root.innerHTML = `
      <header class="topbar">
        <button class="btn" data-action="home">⌂ Inicio</button>
        <div class="brand">◆ Relieve3D <span class="module-name">· Distribución para corte láser</span></div>
        <button class="btn" data-action="import">Importar SVG</button>
        <button class="btn" data-action="open">Abrir proyecto</button>
        <button class="btn" data-action="save">Guardar</button>
        <button class="btn" data-action="undo" title="Deshacer">↶</button>
        <button class="btn" data-action="redo" title="Rehacer">↷</button>
        <div class="spacer"></div>
        <button class="btn primary" data-action="export">Exportar SVG 1:1</button>
      </header>
      <main class="laser-layout">
        <aside class="laser-settings">
          <section class="card">
            <h3>Lámina y separación</h3>
            <label class="row">Ancho (mm)<input data-config="width" type="number" min="5" max="3000" step="1"></label>
            <label class="row">Alto (mm)<input data-config="height" type="number" min="5" max="3000" step="1"></label>
            <label class="row">Margen (mm)<input data-config="margin" type="number" min="0.1" step="0.1"></label>
            <label class="row">Separación libre (mm)<input data-config="gap" type="number" min="0.1" step="0.1"></label>
            <p class="muted small">Incluye una reserva conservadora para el grosor de línea. No compensa el kerf: configúralo una sola vez en tu software de corte.</p>
          </section>
          <section class="card">
            <h3>Distribución</h3>
            <label class="row">Modo<select data-config="mode"><option value="fill">Llenar una lámina</option><option value="exact">Cantidades exactas</option></select></label>
            <label class="chk"><input type="checkbox" data-config="balanced"> Equilibrar cantidades por diseño</label>
            <label class="row">Giro cada<select data-config="angleStep">${[5, 10, 15, 30, 45, 90, 180, 360].map(n => `<option value="${n}">${n === 360 ? 'Sin giro' : n + '°'}</option>`).join('')}</select></label>
            <label class="row">Tiempo de búsqueda (s)<input data-config="seconds" type="number" min="1" max="300"></label>
            <button class="btn primary wide" data-action="optimize">Optimizar juegos completos</button>
            <button class="btn wide" data-action="cancel" hidden>Cancelar y conservar mejor resultado</button>
            <button class="btn wide" data-action="apply" disabled>Aplicar mejor resultado</button>
            <p class="muted small">Sin escalado ni reflejos. No coloca piezas en huecos interiores. Hasta 250 figuras / 1000 piezas por lámina. La búsqueda no demuestra un máximo matemático.</p>
          </section>
          <section class="card">
            <h3>Importación</h3>
            <label class="row">SVG sin unidades<select data-role="units"><option value="reject">Rechazar y avisar</option><option value="mm">Milímetros</option><option value="cm">Centímetros</option><option value="px">Píxeles · 96 ppp</option></select></label>
            <label class="chk"><input type="checkbox" data-role="join"> Importar todo como una sola pieza</label>
            <p class="muted small">SVG vectorial con curvas y grupos. Convierte textos y efectos a curvas. DXF no está soportado; expórtalo como SVG desde tu editor.</p>
            <button class="btn wide" data-action="example">Cargar ejemplo de seis figuras y anillo</button>
          </section>
          <section class="card" data-role="position" hidden>
            <h3>Pieza seleccionada</h3>
            <p data-role="instance-name"></p>
            <label class="row">X (mm)<input data-position="x" type="number" step="0.1"></label>
            <label class="row">Y (mm)<input data-position="y" type="number" step="0.1"></label>
            <label class="row">Giro (°)<input data-position="angle" type="number" step="1"></label>
            <p class="muted small">También puedes arrastrarla. Los conflictos bloquean la exportación.</p>
          </section>
        </aside>
        <section class="laser-work">
          <section class="card laser-library">
            <div class="laser-actions">
              <h3>Figuras y complementos</h3>
              <button class="btn" data-action="group">Agrupar selección</button>
              <button class="btn" data-action="remove">Quitar selección</button>
            </div>
            <p class="muted small">Marca las casillas de la izquierda para agrupar. Para un anillo de dos círculos, selecciónalos y agrúpalos; después elige «Complemento». En cada figura selecciona su complemento y proporción.</p>
            <div data-role="library"></div>
          </section>
          <div class="laser-actions">
            <button class="btn" data-action="zoom-out">−</button><button class="btn" data-action="fit">Ajustar lámina</button><button class="btn" data-action="zoom-in">+</button>
            <button class="btn" data-action="validate">Revisar todas las piezas</button>
            <span data-role="dimensions"></span><small class="muted">Trazos realzados solo en pantalla.</small>
          </div>
          <div class="laser-board" data-role="board"><svg xmlns="http://www.w3.org/2000/svg" data-role="drawing"></svg></div>
          <section class="card laser-report" data-role="report" aria-live="polite"></section>
        </section>
      </main>
      <footer class="laser-status" data-role="status" role="status" aria-live="polite">Importa tus figuras SVG o envía el diseño desde el estudio 2D.</footer>
      <input hidden type="file" accept=".svg" multiple data-role="import-file">
      <input hidden type="file" accept=".r3l,.json" data-role="project-file">`;
    this.root.addEventListener('click', e => {
      const button = e.target.closest('[data-action]');
      if (button) this.guard(() => this.action(button.dataset.action));
    });
    this.root.addEventListener('change', e => this.guard(() => this.change(e.target)));
    this.q('drawing').addEventListener('pointerdown', e => this.dragStart(e));
    this.q('drawing').addEventListener('pointermove', e => this.dragMove(e));
    this.q('drawing').addEventListener('pointerup', e => this.dragEnd(e));
    this.q('drawing').addEventListener('pointercancel', () => {
      if (!this.drag) return;
      Object.assign(this.placements.find(p => p.id === this.drag.id), this.drag.original);
      this.drag = null; this.render();
    });
    this.root.addEventListener('keydown', e => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && ['z', 'y', 's'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        this.guard(() => this.action(e.key.toLowerCase() === 's' ? 'save' : e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo'));
      }
    });
  }
  q(role) { return this.root.querySelector(`[data-role="${role}"]`); }
  button(action) { return this.root.querySelector(`[data-action="${action}"]`); }
  status(message, error = false) {
    this.q('status').textContent = message; this.q('status').classList.toggle('error', error);
    if (error) this.cb.toast(message, true);
  }
  async guard(action) {
    try { return await action(); } catch (error) { this.render(); this.status(error.message, true); }
  }
  open() { this.root.hidden = false; this.render(); }
  close() { this.stop(); this.root.hidden = true; }
  snapshot() { return clone({ templates: this.templates, placements: this.placements, config: this.config }); }
  commit(dirty = true) {
    this.history.splice(this.index + 1); this.history.push(this.snapshot());
    if (this.history.length > 30) this.history.shift();
    this.index = this.history.length - 1; this.dirty = dirty; this.render();
  }
  invalidate() { this.stop(); this.placements = []; this.best = null; this.instance = null; this.commit(); }
  stop() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    this.button('cancel').hidden = true; this.button('optimize').disabled = false;
    this.button('apply').disabled = !this.best?.placements?.length;
  }
  async action(action) {
    if (action === 'home') {
      if (this.dirty && await window.api.confirm({ message: 'Hay cambios de distribución sin guardar. ¿Volver al inicio conservándolos en esta sesión?', buttons: ['Volver', 'Seguir editando'], cancelId: 1 }) !== 0) return;
      this.cb.onBack(); return;
    }
    if (action === 'import') { this.q('import-file').click(); return; }
    if (action === 'open') { this.q('project-file').click(); return; }
    if (action === 'example') {
      const response = await fetch('./examples/laser-shapes.svg');
      if (!response.ok) throw new Error('No se pudo cargar el ejemplo local.');
      await this.importSVG(await response.text(), { name: 'Ejemplo' }); return;
    }
    if (action === 'group') {
      const chosen = this.templates.filter(t => this.selected.has(t.id));
      if (this.templates.some(t => chosen.some(c => c.id === t.complementId))) throw new Error('Quita primero las asociaciones a las piezas que vas a agrupar.');
      const group = groupLaserTemplates(chosen, 'Grupo / anillo');
      this.templates = [...this.templates.filter(t => !this.selected.has(t.id)), group]; this.selected = new Set([group.id]); this.invalidate(); return;
    }
    if (action === 'remove') {
      if (!this.selected.size) throw new Error('Selecciona piezas de la lista.');
      if (this.templates.some(t => !this.selected.has(t.id) && this.selected.has(t.complementId))) throw new Error('Quita primero las asociaciones a ese complemento.');
      this.templates = this.templates.filter(t => !this.selected.has(t.id)); this.selected.clear(); this.invalidate(); return;
    }
    if (action === 'optimize') { this.optimize(); return; }
    if (action === 'cancel') { this.stop(); this.status(this.best ? 'Búsqueda cancelada. Puedes aplicar el mejor resultado válido encontrado.' : 'Búsqueda cancelada; la distribución anterior se conserva.'); return; }
    if (action === 'apply') {
      if (!this.best?.placements.length) throw new Error('Todavía no hay resultado válido.');
      this.stop();
      const check = validateLayout(this.templates, this.best.placements, this.config);
      if (!check.valid) throw new Error(check.issues[0]?.message || 'Resultado inválido.');
      this.placements = clone(this.best.placements); this.best = null; this.commit();
      this.status('Distribución aplicada. Revisa el conteo y guarda el proyecto.'); return;
    }
    if (action === 'undo' || action === 'redo') {
      this.stop(); const index = this.index + (action === 'undo' ? -1 : 1);
      if (index < 0 || index >= this.history.length) return;
      Object.assign(this, clone(this.history[index])); this.index = index; this.best = null; this.instance = null; this.dirty = true; this.render(); return;
    }
    if (action === 'save') {
      if (!this.templates.length) throw new Error('Importa al menos una pieza antes de guardar.');
      validateLayout(this.templates, [], this.config);
      const file = await window.api.saveFile({ defaultPath: 'distribucion_laser.r3l', filters: [{ name: 'Distribución láser', extensions: ['r3l'] }],
        data: JSON.stringify(laserProject(this.templates, this.placements, this.config)) });
      if (file) { this.dirty = false; this.status(`Proyecto guardado: ${file}`); }
      return;
    }
    if (action === 'export') {
      const data = laserSVG(this.templates, this.placements, this.config);
      const file = await window.api.saveFile({ defaultPath: 'distribucion_laser.svg', filters: [{ name: 'SVG a escala real', extensions: ['svg'] }], data });
      if (file) this.status(`SVG guardado a escala 1:1: ${file}`); return;
    }
    if (action === 'validate') {
      if (!this.placements.length) throw new Error('Aplica primero una distribución.');
      const check = validateLayout(this.templates, this.placements, this.config);
      this.render();
      this.status(check.valid ? `${check.pairs} parejas revisadas: ninguna se toca ni se superpone; separación conservadora mínima ${fmt(check.minGap)} mm.` : check.issues.map(i => i.message).join(' '), !check.valid);
      return;
    }
    if (action === 'fit') this.zoom = 1;
    if (action === 'zoom-in') this.zoom = Math.min(5, this.zoom * 1.25);
    if (action === 'zoom-out') this.zoom = Math.max(0.5, this.zoom / 1.25);
    this.draw();
  }
  async importSVG(text, options = {}) {
    const imported = importLaserSVG(text, { unitless: this.q('units').value, join: this.q('join').checked, ...options });
    if (this.templates.length + imported.length > 100) throw new Error('Máximo 100 plantillas por proyecto.');
    this.templates.push(...imported); this.selected = new Set(imported.map(t => t.id)); this.invalidate();
    this.status(`${imported.length} piezas importadas a escala real. Revisa grupos, medidas y complementos.`);
  }
  async loadFile(file) {
    if (/\.(r3l|json)$/i.test(file.name)) return this.openProject(JSON.parse(await file.text()));
    if (!/\.svg$/i.test(file.name)) throw new Error('Importa SVG vectorial. DXF, CDR e imágenes no se interpretan como trayectorias de corte.');
    return this.importSVG(await file.text(), { name: file.name.replace(/\.svg$/i, '') });
  }
  openProject(project) {
    const parsed = readLaserProject(project);
    this.stop(); Object.assign(this, { templates: parsed.templates, placements: parsed.placements, config: parsed.config });
    this.best = null; this.instance = null; this.selected.clear(); this.history = []; this.index = -1; this.commit(false);
    this.root.hidden = false;
    this.status(parsed.validation.issues.length ? 'Proyecto abierto con conflictos: corrígelos antes de exportar.' : 'Proyecto abierto; curvas y escala reconstruidas desde los SVG originales.', parsed.validation.issues.length > 0);
  }
  async change(input) {
    if (input === this.q('import-file') || input === this.q('project-file')) {
      for (const file of input.files) await this.loadFile(file);
      input.value = ''; return;
    }
    if (input.dataset.select) {
      if (input.checked) this.selected.add(input.dataset.select); else this.selected.delete(input.dataset.select);
      return;
    }
    if (input.dataset.config) {
      const key = input.dataset.config, value = input.type === 'checkbox' ? input.checked : key === 'mode' ? input.value : number(input.value);
      const next = validateConfig({ ...this.config, [key]: value });
      this.config = next; this.invalidate(); return;
    }
    if (input.dataset.template) {
      const t = this.templates.find(t => t.id === input.dataset.template), key = input.dataset.field;
      const value = input.type === 'checkbox' ? input.checked : ['quantity', 'ratio'].includes(key) ? number(input.value) : input.value;
      if (['quantity', 'ratio'].includes(key) && (!Number.isInteger(value) || value < (key === 'ratio' ? 1 : 0) || value > (key === 'ratio' ? 20 : 500))) throw new Error('Cantidad o proporción fuera de rango.');
      if (key === 'role' && value !== 'complement' && this.templates.some(o => o.complementId === t.id)) throw new Error('Quita primero las asociaciones a este complemento.');
      t[key] = value;
      if (key === 'role') t.complementId = '';
      this.invalidate(); return;
    }
    if (input.dataset.position) {
      const p = this.placements.find(p => p.id === this.instance), value = number(input.value);
      if (!p || !Number.isFinite(value)) throw new Error('Coordenada inválida.');
      this.stop(); p[input.dataset.position] = value; this.commit();
    }
  }
  optimize() {
    this.stop(); validateConfig(this.config);
    validateLayout(this.templates, [], this.config);
    this.best = null;
    this.worker = new Worker(new URL('./laser_worker.js', import.meta.url), { type: 'module' });
    this.button('cancel').hidden = false; this.button('optimize').disabled = true; this.button('apply').disabled = true;
    this.status('Preparando siluetas reales y rotaciones…');
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'error') { this.stop(); this.status(data.message, true); return; }
      if (data.type === 'progress') {
        const p = data.progress;
        if (p.phase === 'best') { this.best = p; this.button('apply').disabled = false; this.draw(); }
        this.status(p.phase === 'preparing' ? `Preparando ${p.name}…` : `Buscando: ${p.figures || 0} figuras con sus complementos · ${p.trials || 0} intentos · ${fmt(p.elapsed)} s`);
      }
      if (data.type === 'done') {
        if (data.result.placements.length) this.best = data.result;
        this.stop(); this.draw(); this.status(data.result.message);
      }
    };
    this.worker.onerror = event => { this.stop(); this.status(`Error del motor local: ${event.message}`, true); };
    this.worker.postMessage({ templates: this.templates.map(({ body, svg, ...t }) => t), config: this.config });
  }
  render() {
    for (const input of this.root.querySelectorAll('[data-config]')) {
      if (input.type === 'checkbox') input.checked = this.config[input.dataset.config]; else input.value = this.config[input.dataset.config];
    }
    const complements = this.templates.filter(t => t.role === 'complement');
    this.q('library').innerHTML = this.templates.length ? this.templates.map(t => `
      <article class="laser-piece">
        <input type="checkbox" data-select="${esc(t.id)}" ${this.selected.has(t.id) ? 'checked' : ''} aria-label="Seleccionar ${esc(t.name)}">
        <svg class="laser-thumb" viewBox="${-t.padding - 1} ${-t.padding - 1} ${t.width + t.padding * 2 + 2} ${t.height + t.padding * 2 + 2}">${t.body}</svg>
        <div class="laser-piece-fields">
          <input aria-label="Nombre de pieza" data-template="${esc(t.id)}" data-field="name" value="${esc(t.name)}">
          <small>${fmt(t.width)} × ${fmt(t.height)} mm · escala original</small>
          <label><input type="checkbox" data-template="${esc(t.id)}" data-field="enabled" ${t.enabled ? 'checked' : ''}> Usar</label>
        </div>
        <div class="laser-piece-fields">
          <label>Tipo <select data-template="${esc(t.id)}" data-field="role"><option value="figure" ${t.role === 'figure' ? 'selected' : ''}>Figura</option><option value="complement" ${t.role === 'complement' ? 'selected' : ''}>Complemento</option></select></label>
          ${t.role === 'figure' ? `<label>Cantidad <input type="number" min="0" max="500" data-template="${esc(t.id)}" data-field="quantity" value="${t.quantity}" ${this.config.mode === 'fill' ? 'disabled title="Se calcula al llenar la lámina"' : ''}></label>` : '<small>Se calcula por asociación, no por círculos.</small>'}
        </div>
        ${t.role === 'figure' ? `<div class="laser-piece-fields"><label>Complemento <select data-template="${esc(t.id)}" data-field="complementId"><option value="">Ninguno</option>${complements.map(c => `<option value="${esc(c.id)}" ${t.complementId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label>Por figura <input type="number" min="1" max="20" data-template="${esc(t.id)}" data-field="ratio" value="${t.ratio}"></label></div>` : ''}
      </article>`).join('') : '<p class="muted">Todavía no hay figuras. Importa un SVG; sus grupos aparecerán aquí.</p>';
    this.button('undo').disabled = this.index <= 0; this.button('redo').disabled = this.index >= this.history.length - 1;
    this.button('apply').disabled = !this.best?.placements?.length;
    this.draw();
  }
  draw() {
    const placements = this.best?.placements || this.placements, preview = !!this.best;
    const byId = new Map(this.templates.map(t => [t.id, t]));
    let validation = null;
    if (this.templates.some(t => t.enabled && t.role === 'figure')) {
      try { validation = validateLayout(this.templates, placements, this.config); }
      catch (error) { this.q('report').textContent = error.message; this.button('export').disabled = true; }
    }
    const conflicts = new Set(validation?.issues.flatMap(i => i.ids) || []);
    const svg = this.q('drawing');
    svg.setAttribute('viewBox', `0 0 ${this.config.width} ${this.config.height}`);
    svg.style.width = `${this.zoom * 100}%`; svg.style.height = `${this.zoom * 100}%`;
    svg.innerHTML = `<rect width="${this.config.width}" height="${this.config.height}" fill="white"/>
      <rect x="${this.config.margin}" y="${this.config.margin}" width="${this.config.width - 2 * this.config.margin}" height="${this.config.height - 2 * this.config.margin}" fill="none" stroke="#9ca3af" stroke-width=".25" stroke-dasharray="2 2" pointer-events="none"/>` +
      placements.map(p => `<g data-instance="${esc(p.id)}" transform="translate(${p.x} ${p.y}) rotate(${p.angle})" pointer-events="all" style="cursor:move">${byId.get(p.templateId)?.body || ''}</g>`).join('') +
      placements.filter(p => p.id === this.instance || conflicts.has(p.id)).map(p => {
        const bb = bounds(transformLoops(byId.get(p.templateId).loops, p));
        return `<rect x="${bb.minX - 0.5}" y="${bb.minY - 0.5}" width="${bb.width + 1}" height="${bb.height + 1}" fill="none" stroke="${conflicts.has(p.id) ? '#dc2626' : '#2563eb'}" stroke-width=".6" stroke-dasharray="2 1" pointer-events="none"/>`;
      }).join('');
    this.q('dimensions').textContent = `${this.config.width} × ${this.config.height} mm${preview ? ' · Vista previa; falta aplicar' : ''}`;
    const p = this.placements.find(p => p.id === this.instance);
    this.q('position').hidden = !p || preview;
    if (p && !preview) {
      this.q('instance-name').textContent = byId.get(p.templateId).name;
      for (const input of this.root.querySelectorAll('[data-position]')) input.value = Number(p[input.dataset.position].toFixed(3));
    }
    this.button('export').disabled = preview || !validation?.valid;
    if (!placements.length) this.q('report').textContent = 'Optimiza y aplica una distribución para obtener el conteo y la revisión de separaciones.';
    else if (validation) {
      const pending = this.config.mode === 'exact' ? validation.pending.filter(p => p.count) : [];
      this.q('report').innerHTML = `<h3>${validation.figures} figuras + ${validation.complements} complementos · ${placements.length} piezas agrupadas</h3>
        <p class="${validation.valid ? 'laser-ok' : 'error'}">${validation.valid ? 'Sin contactos ni solapamientos. ' : 'NO LISTO PARA CORTE. '}${validation.pairs} parejas revisadas. Separación conservadora mínima: ${fmt(validation.minGap)} mm. Margen mínimo: ${fmt(validation.minMargin)} mm.</p>
        <div class="laser-counts">${this.templates.filter(t => validation.counts[t.id]).map(t => `<span>${esc(t.name)}: <b>${validation.counts[t.id]}</b></span>`).join('')}</div>
        ${pending.length ? `<p class="error">No cupieron: ${pending.map(p => `${esc(p.name)} × ${p.count}`).join(', ')}. No se crearon láminas adicionales.</p>` : ''}
        ${validation.issues.length ? `<p class="error">${validation.issues.slice(0, 8).map(i => esc(i.message)).join(' ')}</p>` : ''}`;
    }
    this.validation = validation;
  }
  point(event) {
    const matrix = this.q('drawing').getScreenCTM();
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  }
  dragStart(event) {
    if (this.worker || this.best || event.button !== 0) return;
    const element = event.target.closest('[data-instance]');
    if (!element) { this.instance = null; this.draw(); return; }
    this.instance = element.dataset.instance;
    const p = this.placements.find(p => p.id === this.instance);
    this.drag = { id: p.id, start: this.point(event), original: { x: p.x, y: p.y } };
    this.q('drawing').setPointerCapture(event.pointerId); event.preventDefault();
  }
  dragMove(event) {
    if (!this.drag) return;
    const point = this.point(event), p = this.placements.find(p => p.id === this.drag.id);
    p.x = this.drag.original.x + point.x - this.drag.start.x;
    p.y = this.drag.original.y + point.y - this.drag.start.y;
    const element = this.q('drawing').querySelector(`[data-instance="${CSS.escape(p.id)}"]`);
    element.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${p.angle})`);
  }
  dragEnd(event) {
    if (!this.drag) return;
    this.dragMove(event); this.drag = null; this.commit();
  }
}
