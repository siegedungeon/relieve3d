import { newQuote, newQuickQuote, decimal, calculateQuote, wholesaleTable, scenarios, compareQuotes, quoteAnalytics, cloneQuote } from './core/quotation.js';
import { escapeHTML as e, formatCOP as cash, formatNumber as num, commercialQuote, commercialHTML } from './core/quote_document.js';

const tabs = [['quick', 'Rápida'], ['quote', 'Cotización completa'], ['wholesale', 'Precios por volumen'], ['scenarios', 'Escenarios'], ['compare', 'Comparar'], ['production', 'Producción'], ['history', 'Historial'], ['analytics', 'Análisis'], ['settings', 'Configuración']];
const statuses = { draft: 'Borrador', sent: 'Enviada', accepted: 'Aceptada', rejected: 'Rechazada', expired: 'Vencida', converted: 'Convertida en pedido' };
const categories = { material: 'Material y purgas', machine: 'Máquina', labor: 'Mano de obra', accessories: 'Accesorios', packaging: 'Empaque', indirect: 'Otros / indirectos', contingency: 'Contingencia', risk: 'Reserva de fallos', fees: 'Comisiones de pago' };
const bases = [['unit', 'Por unidad'], ['order', 'Por pedido'], ['batch', 'Por tanda']];
const readPath = (o, path) => path.split('.').reduce((v, key) => v?.[key], o);
function writePath(o, path, value) {
  const keys = path.split('.'), last = keys.pop();
  if (keys.some(k => ['__proto__', 'prototype', 'constructor'].includes(k)) || ['__proto__', 'prototype', 'constructor'].includes(last)) throw new Error('Campo no permitido.');
  const parent = keys.reduce((v, key) => v[key], o); parent[last] = value;
}
const table = (headers, rows) => `<div class="q-table"><table><thead><tr>${headers.map(h => `<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="q-empty">Todavía no hay registros.</td></tr>`}</tbody></table></div>`;
const row = cells => `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
const percent = n => n === null ? 'No disponible' : `${num(n)}%`;
const date = s => s ? new Date(s).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export class QuoteStudio {
  constructor(root, cb) {
    this.root = root; this.cb = cb; this.tab = 'quick'; this.seq = 0;
    this.input = null; this.record = null; this.dirty = false; this.readOnly = false;
    this.filter = { text: '', from: '', to: '', status: '', printer: '', material: '' };
    this.comparison = { minutes: '90', grams: '30', quality: false, samePrice: true };
    window.matchMedia('(max-width: 760px)').addEventListener('change', () => {
      if (!root.hidden && this.library) this.render();
    });
    root.addEventListener('input', event => this.inputEvent(event));
    root.addEventListener('change', event => {
      if (event.target.matches('select')) this.render();
      if (event.target.matches('[data-logo]')) this.loadLogo(event.target.files[0]);
    });
    root.addEventListener('click', event => {
      const target = event.target.closest('[data-action], [data-tab]');
      if (!target || this.busy) return;
      if (target.dataset.tab) {
        if (target.dataset.tab === 'quote' && this.input.entryMode === 'quick' && !this.readOnly) {
          this.input.entryMode = 'full'; this.dirty = true;
        }
        this.tab = target.dataset.tab; this.render(); return;
      }
      this.perform(() => this.action(target.dataset.action, target.dataset));
    });
    window.addEventListener('keydown', event => {
      if (!root.hidden && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); if (!this.busy && !this.readOnly) this.perform(() => this.save(false));
      }
    });
  }

  async open() {
    const seq = ++this.seq;
    this.root.hidden = false;
    this.root.innerHTML = '<div class="q-loading">Cargando el historial local de Pabonitas…</div>';
    try {
      await window.api.quoteWindow(true);
      const library = await window.api.quoteLoad();
      if (seq !== this.seq) return false;
      this.library = library;
      if (!this.input) this.newDocument();
      this.loadSettings();
      this.render(); return true;
    } catch (error) {
      if (seq !== this.seq) return false;
      console.error(error);
      this.root.innerHTML = `<div class="q-loading q-error"><h2>No se pudo abrir el cotizador</h2><p>${e(error.message)}</p><button class="btn" data-action="home">Volver al inicio</button></div>`;
      this.cb.toast(error.message, true); return false;
    }
  }
  close() {
    if (this.root.hidden) return;
    this.seq++; this.root.hidden = true;
    window.api.quoteWindow(false).catch(error => { console.error(error); this.cb.toast(error.message, true); });
  }
  loadSettings() {
    if (this.settingsDirty) return;
    const latest = this.library.configs.at(-1);
    this.settings = cloneQuote(latest.value); this.settingsVersion = latest.version;
  }
  activeConfig() {
    const today = new Date().toISOString().slice(0, 10);
    const choices = this.library.configs.filter(c => c.value.effectiveAt <= today);
    if (!choices.length) throw new Error('No existe una configuración vigente para hoy.');
    return choices.at(-1);
  }
  newDocument(copy = null) {
    const c = this.activeConfig();
    this.config = cloneQuote(c.value); this.configVersion = c.version;
    const fresh = this.tab === 'quick' ? newQuickQuote(this.config) : newQuote(this.config);
    this.input = copy ? cloneQuote(copy) : fresh;
    if (copy) {
      this.input.date = fresh.date; this.input.validUntil = fresh.validUntil;
      this.input.deliveryDate = ''; this.input.print.start = fresh.print.start;
    }
    this.record = null; this.exportVersion = null; this.readOnly = false; this.dirty = true;
    this.quickDuration = null; this.quickTimeError = ''; this.quickTouched = false;
    this.tab = this.input.entryMode === 'quick' ? 'quick' : 'quote';
  }
  field(label, path, { type = 'number', config = false, help = '', disabled = false, options = null } = {}) {
    const object = config ? this.settings : this.input, value = readPath(object, path);
    const attr = `${config ? 'data-config' : 'data-field'}="${e(path)}"`;
    const off = disabled || (!config && this.readOnly) ? ' disabled' : '';
    let control;
    if (options) control = `<select ${attr}${off}>${options.map(([v, title]) => `<option value="${e(v)}"${String(v) === String(value) ? ' selected' : ''}>${e(title)}</option>`).join('')}</select>`;
    else if (type === 'checkbox') control = `<input type="checkbox" ${attr}${value ? ' checked' : ''}${off}>`;
    else if (type === 'textarea') control = `<textarea ${attr} rows="2"${off}>${e(value)}</textarea>`;
    else control = `<input type="${type}" ${type === 'number' ? 'step="any" inputmode="decimal"' : ''} ${attr} value="${e(value)}"${off}>`;
    return `<label class="q-field${type === 'checkbox' ? ' q-check' : ''}"><span>${e(label)}</span>${control}${help ? `<small>${e(help)}</small>` : ''}</label>`;
  }
  group(title, content, open = true, id = title) {
    return `<details class="q-card" data-section="${e(id)}"${open ? ' open' : ''}><summary>${e(title)}</summary><div class="q-card-body">${content}</div></details>`;
  }
  inputEvent(event) {
    const el = event.target;
    if (this.busy) return;
    if (el.dataset.field && !this.readOnly) {
      writePath(this.input, el.dataset.field, el.type === 'checkbox' ? el.checked : el.value);
      if (this.tab === 'quick') {
        this.quickTouched = true;
        if (['print.mode', 'quantity'].includes(el.dataset.field) && this.supportsQuickShape()) {
          if (this.input.print.mode === 'batch' || el.dataset.field === 'print.mode') {
            this.input.print.unitsPerBatch = this.input.print.capacity = this.input.print.mode === 'batch' ? this.input.quantity : 1;
          }
        }
      }
      if (el.dataset.field === 'print.minutes') { this.quickTimeError = ''; this.quickDuration = null; }
      this.lastError = '';
      const previousError = this.root.querySelector('[data-action-error]');
      if (previousError) previousError.hidden = true;
      this.dirty = true; this.updateResults();
    } else if (el.dataset.quickDuration && !this.readOnly) {
      this.quickDuration[el.dataset.quickDuration] = el.value; this.quickTouched = true;
      try {
        const { hours, minutes } = this.quickDuration;
        this.input.print.minutes = decimal(hours || '0', 'Horas').times(60).plus(decimal(minutes || '0', 'Minutos')).toFixed();
        this.quickTimeError = '';
      } catch (error) { this.input.print.minutes = ''; this.quickTimeError = error.message; }
      this.quickDuration.total = this.input.print.minutes;
      this.dirty = true; this.updateResults();
    } else if (el.dataset.config) {
      writePath(this.settings, el.dataset.config, el.type === 'checkbox' ? el.checked : el.value);
      this.settingsDirty = true;
    } else if (el.dataset.filter) {
      this.filter[el.dataset.filter] = el.value;
      this.updateHistory();
    } else if (el.dataset.compare) {
      this.comparison[el.dataset.compare] = el.type === 'checkbox' ? el.checked : el.value;
      this.updateComparison();
    }
  }
  async perform(action) {
    this.busy = true;
    this.root.querySelectorAll('button,input,select,textarea').forEach(b => { b.disabled = true; });
    try { await action(); }
    catch (error) { console.error(error); this.cb.toast(error.message, true); this.lastError = error.message; }
    finally { this.busy = false; if (!this.root.hidden && this.library) this.render(); }
  }
  async save(issue) {
    if (this.readOnly) throw new Error('Duplica o abre el borrador actual para editar una versión histórica.');
    const saved = await window.api.quoteSave({ id: this.record?.id, revision: this.record?.revision,
      input: this.input, configVersion: this.configVersion, issue });
    this.record = saved; this.input = cloneQuote(saved.input); this.dirty = false;
    this.exportVersion = saved.versions.at(-1)?.version;
    this.library = await window.api.quoteLoad();
    this.lastError = '';
    this.cb.toast(issue ? `Emitida ${saved.number}, versión ${this.exportVersion}. Se marcó como enviada; no se envía automáticamente.` : `Borrador ${saved.number} guardado.`);
  }
  loadRecord(id, version = null) {
    const r = this.library.quotes.find(r => r.id === id);
    if (!r) throw new Error('La cotización no está en el historial.');
    const v = version ? r.versions.find(v => v.version === Number(version)) : null;
    if (version && !v) throw new Error('Versión histórica inexistente.');
    this.record = r; this.input = cloneQuote(v ? v.input : r.input);
    this.configVersion = v ? v.configVersion : r.configVersion;
    this.config = cloneQuote(v ? v.configSnapshot : this.library.configs.find(c => c.version === r.configVersion).value);
    this.exportVersion = v?.version || r.versions.at(-1)?.version;
    this.readOnly = !!v || ['accepted', 'converted'].includes(r.status);
    this.dirty = !v && r.status === 'draft' && r.versions.length > 0;
    this.tab = this.input.entryMode === 'quick' && !this.readOnly ? 'quick' : 'quote'; this.lastError = '';
    this.quickDuration = null; this.quickTimeError = ''; this.quickTouched = false;
  }
  async action(action, data) {
    if (action === 'home') return this.cb.onBack();
    if (action === 'new') {
      if (this.dirty && await window.api.confirm({ message: '¿Crear otra cotización? Los cambios sin guardar de esta se descartarán.', buttons: ['Crear otra', 'Cancelar'], cancelId: 1 }) !== 0) return;
      this.newDocument(); return;
    }
    if (action === 'save') return this.save(false);
    if (action === 'issue') return this.save(true);
    if (action === 'duplicate') { this.newDocument(this.input); return; }
    if (action === 'load') {
      if (this.dirty && await window.api.confirm({ message: '¿Abrir esta cotización? Los cambios sin guardar de la actual se descartarán.', buttons: ['Abrir', 'Cancelar'], cancelId: 1 }) !== 0) return;
      this.loadRecord(data.id, data.version || null); return;
    }
    if (action === 'reload') { this.library = await window.api.quoteLoad(); this.loadSettings(); return; }
    if (action === 'refresh-costs') {
      if (this.readOnly) throw new Error('Duplica primero la cotización histórica.');
      const c = this.activeConfig(); this.config = cloneQuote(c.value); this.configVersion = c.version; this.dirty = true; return;
    }
    if (action === 'save-settings') {
      const saved = await window.api.quoteConfig(this.settings, this.settingsVersion);
      this.library = await window.api.quoteLoad(); this.settingsDirty = false;
      this.loadSettings();
      this.cb.toast(`Costos v${saved.version} guardados. La cotización actual conserva v${this.configVersion}; usa Actualizar costos si deseas recalcularla.`);
      return;
    }
    if (action === 'tier') {
      const target = this.volumeResults.find(r => r.quantity === Number(data.quantity));
      if (this.input.print.mode === 'batch' && this.input.print.partialMethod === 'actual' &&
          target.quantity % Number(this.input.print.unitsPerBatch) !== Number(this.input.quantity) % Number(this.input.print.unitsPerBatch)) {
        this.input.print.partialMethod = 'estimate';
      }
      this.input.quantity = target.quantity;
      if (this.input.strategy === 'manual') { this.input.strategy = 'markup'; this.input.target = this.config.markup; }
      this.dirty = true; this.tab = this.input.entryMode === 'quick' && this.supportsQuick() ? 'quick' : 'quote'; return;
    }
    if (action === 'scenario') {
      const s = this.config.scenarios[Number(data.index)];
      this.input.strategy = s.strategy; this.input.target = s.value; this.dirty = true;
      this.tab = this.input.entryMode === 'quick' && this.supportsQuick() ? 'quick' : 'quote'; return;
    }
    if (action === 'status') {
      if (this.record?.id === data.id && this.dirty && await window.api.confirm({ message: 'Se cambiará el estado de la versión guardada, no de los cambios pendientes. Estos cambios se descartarán. ¿Continuar?', buttons: ['Continuar', 'Cancelar'], cancelId: 1 }) !== 0) return;
      await window.api.quoteStatus({ id: data.id, revision: Number(data.revision), status: data.status });
      this.library = await window.api.quoteLoad();
      if (this.record?.id === data.id) {
        const tab = this.tab;
        this.loadRecord(data.id, this.readOnly ? this.exportVersion : null); this.tab = tab;
      }
      this.cb.toast(data.status === 'converted' ? 'Pedido local registrado, vinculado a la versión aceptada.' : 'Estado actualizado.');
      return;
    }
    if (action === 'actuals') {
      const r = this.library.quotes.find(r => r.id === data.id);
      const get = key => this.root.querySelector(`[data-actual="${key}"][data-id="${data.id}"]`).value;
      await window.api.quoteActuals({ id: r.id, revision: r.revision, actuals: { totalCost: get('cost'), machineHours: get('hours'), grams: get('grams') } });
      this.library = await window.api.quoteLoad();
      if (this.record?.id === data.id) this.record = this.library.quotes.find(r => r.id === data.id);
      this.cb.toast('Costos reales registrados sin modificar la versión emitida.'); return;
    }
    if (action === 'export') return this.export(data.format);
    if (action === 'preview') {
      const v = this.record?.versions.find(v => v.version === this.exportVersion);
      if (!v || this.dirty) throw new Error('Emite y guarda la cotización antes de ver su documento comercial.');
      this.previewHTML = commercialHTML(commercialQuote(v, this.record.number)); return;
    }
    if (action === 'close-preview') { this.previewHTML = null; return; }
    if (action === 'quick-labor' || action === 'quick-package') {
      if (this.readOnly) throw new Error('Duplica primero la cotización histórica.');
      if (action === 'quick-labor') this.input.labor.push(newQuote(this.config).labor[0]);
      else this.input.packaging = { basis: 'unit', cost: this.config.defaultPackaging };
      this.dirty = true; return;
    }
    if (action === 'duration') {
      const values = ['days', 'hours', 'minutes'].map(k => Number(this.root.querySelector(`[data-duration="${k}"]`).value));
      if (values.some(v => !Number.isFinite(v) || v < 0) || values[1] >= 24 || values[2] >= 60) throw new Error('Usa días, horas entre 0 y 23 y minutos entre 0 y 59.');
      this.input.print.minutes = String(values[0] * 1440 + values[1] * 60 + values[2]); this.dirty = true; return;
    }
    if (action === 'add-labor' || action === 'add-extra') {
      this.input[action === 'add-labor' ? 'labor' : 'extras'].push({ name: action === 'add-labor' ? 'Nueva actividad' : 'Transporte / servicio', basis: 'order', method: 'fixed', amount: '0', minutes: '0', rate: '0', cash: true });
    } else if (action === 'add-accessory') {
      this.input.accessories.push({ name: 'Nuevo accesorio', basis: 'unit', quantity: '1', cost: '0', wastePercent: '0' });
    } else if (action === 'ring') {
      this.input.accessories.push({ name: data.kind === 'standard' ? 'Anillo metálico estándar' : 'Anillo alternativo', basis: 'unit', quantity: '1', cost: data.kind === 'standard' ? this.config.ringStandard : this.config.ringAlternative, wastePercent: '0' });
    } else if (action === 'add-material') {
      this.input.materials.push({ materialId: this.config.materials[0].id, color: 'Nuevo color', grams: '1', partialGrams: '', kgCost: '', includesPurge: false, includesSupports: false });
    } else if (action === 'add-printer') {
      const p = this.config.printers.find(p => !this.input.printers.some(s => s.printerId === p.id));
      if (!p) throw new Error('Todas las impresoras están seleccionadas. Usa Máquinas iguales o añade otra en Configuración.');
      this.input.printers.push({ printerId: p.id, copies: 1, hourlyRate: '' });
    } else if (action === 'remove') {
      if (!['labor', 'extras', 'accessories', 'materials', 'printers'].includes(data.list)) throw new Error('Lista no permitida.');
      this.input[data.list].splice(Number(data.index), 1);
    } else if (action === 'add-config-material') {
      this.settings.materials.push({ id: crypto.randomUUID(), name: 'Nuevo material', supplier: '', kgCost: '90000', spoolKg: '1', availableGrams: '0' }); this.settingsDirty = true; return;
    } else if (action === 'add-config-printer') {
      this.settings.printers.push({ ...cloneQuote(this.settings.printers[0]), id: crypto.randomUUID(), name: 'Nueva impresora' }); this.settingsDirty = true; return;
    } else if (action === 'add-config-tier') {
      const last = this.settings.tiers.at(-1), start = Number(last.from);
      this.settings.tiers.splice(this.settings.tiers.length - 1, 0, { from: start, to: start + 99, discount: last.discount });
      last.from = start + 100; this.settingsDirty = true; return;
    } else if (action === 'remove-config-tier') {
      const index = Number(data.index), tiers = this.settings.tiers;
      if (tiers.length === 1) throw new Error('Conserva al menos una escala.');
      if (index + 1 < tiers.length) tiers[index + 1].from = tiers[index].from;
      else tiers[index - 1].to = null;
      tiers.splice(index, 1); this.settingsDirty = true; return;
    } else throw new Error('Acción de cotización desconocida.');
    this.dirty = true;
  }
  async loadLogo(file) {
    if (!file) return;
    await this.perform(async () => {
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 1000000) throw new Error('Elige un logo PNG/JPEG menor de 1 MB.');
      const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(file); });
      this.settings.brand.logo = data; this.settingsDirty = true;
    });
  }
  async export(format) {
    if (!this.record || this.dirty || !this.exportVersion) throw new Error('Guarda y emite una versión antes de exportarla.');
    const output = await window.api.quoteExport({ id: this.record.id, version: this.exportVersion, format });
    if (format === 'text') {
      await navigator.clipboard.writeText(output.text); this.cb.toast('Texto comercial copiado, sin información interna.'); return output;
    }
    const saved = await window.api.saveFile({ defaultPath: output.name, filters: [{ name: 'Cotización comercial', extensions: [output.extension] }], data: output.bytes || output.text });
    if (saved) this.cb.toast(`Cotización guardada: ${saved}`);
    return output;
  }

  render() {
    const opened = new Map([...this.root.querySelectorAll('details[data-section]')].map(d => [d.dataset.section, d.open]));
    const quick = this.tab === 'quick';
    const visibleTabs = quick ? tabs.filter(([key]) => ['quick', 'quote', 'wholesale', 'history', 'settings'].includes(key)) : tabs;
    this.root.classList.toggle('q-quick', quick);
    const current = this.record ? `${this.record.number}${this.readOnly ? ` · versión ${this.exportVersion} (solo lectura)` : ''}` : 'Nueva cotización';
    this.root.innerHTML = `<header class="q-header"><button class="btn" data-action="home">← Inicio</button>
      <div class="q-brand"><span>PABONITAS</span><strong>${quick ? 'Cotización rápida' : 'Cotizador de impresión 3D'}</strong><small>${e(current)} · costos v${this.configVersion}</small></div>
      <div class="q-actions"><button class="btn" data-action="new">${quick ? 'Nueva rápida' : 'Nueva'}</button>${quick ? '' : '<button class="btn" data-action="duplicate">Duplicar</button>'}
      <button class="btn${quick ? ' primary' : ''}" data-action="save"${this.readOnly ? ' disabled' : ''}>${quick ? 'Guardar cálculo' : 'Guardar borrador'}</button>${quick ? '' : `<button class="btn primary" data-action="issue"${this.readOnly ? ' disabled' : ''}>Emitir / marcar enviada</button>`}</div></header>
      <nav class="q-tabs" aria-label="Secciones del cotizador">${visibleTabs.map(([key, title]) => `<button data-tab="${key}" class="${this.tab === key ? 'active' : ''}" aria-current="${this.tab === key ? 'page' : 'false'}">${title}</button>`).join('')}</nav>
      <div class="q-notice">${quick ? 'Calcula sin cliente, sin formulario comercial y sin guardar obligatoriamente. Solo tiempo y filamento; los extras los eliges tú.' : `Vista interna · ${e(this.library.actor)} · almacenamiento local. Los documentos del cliente no incluyen costos ni utilidad.`}</div>
      ${this.lastError ? `<div class="q-error" data-action-error role="alert">${e(this.lastError)}</div>` : ''}
      <div class="q-error" data-result-error role="alert" hidden></div>
      <main class="q-page">${quick ? this.quickForm() : this.tab === 'quote' ? this.quoteForm() : this.tab === 'settings' ? this.settingsForm() : this.tab === 'history' || this.tab === 'analytics' ? this.historyPage() : this.tab === 'compare' ? this.comparePage() : `<section data-results="${this.tab}"></section>`}</main>
      ${this.previewHTML ? `<div class="q-preview"><header><strong>Documento comercial · versión ${this.exportVersion}</strong><button class="btn" data-action="close-preview">Cerrar</button></header><iframe title="Cotización comercial" sandbox="" srcdoc="${e(this.previewHTML)}"></iframe></div>` : ''}`;
    for (const detail of this.root.querySelectorAll('details[data-section]')) if (opened.has(detail.dataset.section)) detail.open = opened.get(detail.dataset.section);
    this.updateResults();
    if (this.tab === 'history' || this.tab === 'analytics') this.updateHistory();
  }

  supportsQuickShape() {
    return this.input.materials.length === 1 && this.input.printers.length === 1 && Number(this.input.printers[0].copies) === 1;
  }
  supportsQuick() {
    const q = this.input;
    return this.supportsQuickShape() && Number(q.print.turnaround) === 0 &&
      Number(q.print.unitsPerBatch) === (q.print.mode === 'unit' ? 1 : Number(q.quantity));
  }
  quickForm() {
    const q = this.input, f = (...args) => this.field(...args);
    if (!this.supportsQuick()) return `<section class="q-card"><h2>Este cálculo tiene una planificación avanzada</h2>
      <p>Conservamos todos sus materiales, impresoras y tandas. Edítalo en la cotización completa o pulsa Nueva rápida para empezar otro cálculo sin modificarlo.</p>
      <button class="btn primary" data-tab="quote">Abrir cotización completa</button></section><aside class="q-summary" data-summary></aside>`;
    if (!this.quickDuration || this.quickDuration.total !== q.print.minutes) {
      this.quickDuration = { hours: '0', minutes: q.print.minutes, total: q.print.minutes };
    }
    const unit = q.print.mode === 'unit', material = this.config.materials.find(m => m.id === q.materials[0].materialId);
    return `<div class="q-workspace"><div class="q-form"><section class="q-card q-quick-inputs"><h2>Tiempo + filamento = precio</h2>
      <p class="q-help">Ingresa los datos del laminador. El resultado cambia al instante.</p><div class="q-grid">
      <fieldset class="q-quick-time"><legend>Tiempo ${unit ? 'por unidad' : 'de toda la placa'}</legend><div>
      ${['hours', 'minutes'].map((key, i) => `<label class="q-field"><span>${i ? 'Minutos' : 'Horas'}</span><input type="number" step="any" min="0" inputmode="decimal" data-quick-duration="${key}" value="${e(this.quickDuration[key])}"${this.readOnly ? ' disabled' : ''}></label>`).join('')}</div></fieldset>
      ${f(unit ? 'Filamento por unidad (gramos)' : 'Filamento de toda la placa (gramos)', 'materials.0.grams')}
      ${f('Cantidad de piezas', 'quantity')}${f('El tiempo y los gramos son de', 'print.mode', { options: [['unit', 'Una unidad'], ['batch', 'La placa completa (todas las piezas)']] })}</div>
      <p class="q-help">${unit ? 'Para varias piezas se suman los consumos unitarios.' : 'El consumo indicado se cobra una sola vez y se reparte entre las piezas; no se multiplica por la cantidad.'}
      Usa Cotización completa para distintas placas, tandas parciales o varios materiales.</p></section>
      ${this.group('Opcional: anillo, acabado y empaque', `<p class="q-help">No se añaden automáticamente. Solo se cobran los extras que tú incluyas.</p>
      <div class="q-actions"><button class="btn" data-action="ring" data-kind="standard">+ Anillo ${cash(this.config.ringStandard)}</button>
      <button class="btn" data-action="quick-labor">+ Acabado ${cash(this.config.defaultLabor)}</button><button class="btn" data-action="quick-package">+ Empaque ${cash(this.config.defaultPackaging)}</button>
      <button class="btn" data-action="add-accessory">+ Otro accesorio</button></div>
      ${this.accessoryRows()}${this.costRows('labor')}${this.costRows('extras')}
      <div class="q-grid">${f('Empaque COP (0 = sin empaque)', 'packaging.cost')}${f('Aplicar empaque', 'packaging.basis', { options: bases })}</div>`, false, 'quick-extras')}
      ${this.group('Opcional: material, tarifas y precio', `<div class="q-grid">
      ${f('Material', 'materials.0.materialId', { options: this.config.materials.map(m => [m.id, m.name]) })}
      ${f('Precio/kg específico (opcional)', 'materials.0.kgCost', { help: `Vacío usa ${cash(material?.kgCost || 0)}/kg del catálogo.` })}
      ${f('Impresora', 'printers.0.printerId', { options: this.config.printers.map(p => [p.id, p.name]) })}
      ${f('Tarifa/h específica (opcional)', 'printers.0.hourlyRate', { help: 'Vacío usa la tarifa configurada de la impresora.' })}
      ${f('Ya incluye purgas', 'materials.0.includesPurge', { type: 'checkbox' })}${f('Ya incluye soportes', 'materials.0.includesSupports', { type: 'checkbox' })}
      ${f('Estrategia de precio', 'strategy', { options: [['markup', 'Recargo sobre costo'], ['margin', 'Margen sobre venta'], ['manual', 'Probar un precio de venta']] })}
      ${q.strategy === 'manual' ? f(`Precio por unidad ${this.config.vatMode === 'included' ? 'con IVA' : 'sin IVA'}`, 'manualPrice') : f(q.strategy === 'margin' ? 'Margen objetivo %' : 'Recargo sobre costo %', 'target')}
      ${f('Nombre para identificar el cálculo', 'product', { type: 'text' })}</div>
      <p class="q-help">Purgas/reserva ${e(this.config.purgePercent)}%, soportes ${e(this.config.supportPercent)}%, merma ${e(this.config.wastePercent)}%. Impuestos, comisiones y redondeo usan tu Configuración.</p>`, false, 'quick-rates')}
      </div><aside class="q-summary" data-summary aria-live="polite"></aside></div>`;
  }
  costRows(key) {
    const f = (...args) => this.field(...args);
    return this.input[key].map((l, i) => `<div class="q-line">${f('Actividad / costo', `${key}.${i}.name`, { type: 'text' })}
      ${f('Aplicación', `${key}.${i}.basis`, { options: bases })}${f('Cálculo', `${key}.${i}.method`, { options: [['fixed', 'Importe fijo'], ['time', 'Minutos × tarifa/h']] })}
      ${l.method === 'fixed' ? f('Importe COP', `${key}.${i}.amount`) : `${f('Minutos de trabajo', `${key}.${i}.minutes`)}${f('Tarifa laboral COP/h', `${key}.${i}.rate`)}`}
      ${key === 'extras' ? f('Requiere desembolso', `${key}.${i}.cash`, { type: 'checkbox' }) : ''}
      <button class="btn q-remove" data-action="remove" data-list="${key}" data-index="${i}">Quitar</button></div>`).join('');
  }
  accessoryRows() {
    const f = (...args) => this.field(...args);
    return this.input.accessories.map((a, i) => `<div class="q-line">${f('Accesorio', `accessories.${i}.name`, { type: 'text' })}
      ${f('Aplicación', `accessories.${i}.basis`, { options: bases })}${f('Cantidad de accesorio', `accessories.${i}.quantity`)}${f('Costo unitario COP', `accessories.${i}.cost`)}
      ${f('Merma adicional %', `accessories.${i}.wastePercent`)}<button class="btn q-remove" data-action="remove" data-list="accessories" data-index="${i}">Quitar</button></div>`).join('');
  }
  quoteForm() {
    const f = (...args) => this.field(...args), q = this.input;
    const materials = q.materials.map((m, i) => `<div class="q-line">${f('Material', `materials.${i}.materialId`, { options: this.config.materials.map(m => [m.id, m.name]) })}
      ${f('Color', `materials.${i}.color`, { type: 'text' })}${f(q.print.mode === 'unit' ? 'Gramos por unidad' : 'Gramos por tanda completa', `materials.${i}.grams`)}
      ${f('Precio/kg específico (opcional)', `materials.${i}.kgCost`, { help: `Vacío: catálogo ${cash(this.config.materials.find(x => x.id === m.materialId)?.kgCost || 0)}/kg.` })}
      ${q.print.mode === 'batch' && q.print.partialMethod === 'actual' ? f('Gramos tanda parcial (laminador)', `materials.${i}.partialGrams`) : ''}
      ${f('Ya incluye purgas/desperdicio', `materials.${i}.includesPurge`, { type: 'checkbox' })}${f('Ya incluye soportes', `materials.${i}.includesSupports`, { type: 'checkbox' })}
      <button class="btn q-remove" data-action="remove" data-list="materials" data-index="${i}">Quitar color</button></div>`).join('');
    const printers = q.printers.map((p, i) => `<div class="q-line">${f('Impresora', `printers.${i}.printerId`, { options: this.config.printers.map(p => [p.id, p.name]) })}
      ${f('Máquinas iguales simultáneas', `printers.${i}.copies`)}${f('Tarifa/h específica (opcional)', `printers.${i}.hourlyRate`, { help: 'Vacío usa la tarifa integrada o componentes del catálogo, nunca ambos.' })}
      <button class="btn q-remove" data-action="remove" data-list="printers" data-index="${i}">Quitar</button></div>`).join('');
    const costs = key => this.costRows(key), accessories = this.accessoryRows();
    return `<div class="q-workspace"><div class="q-form">
      ${this.group('1. Cliente y producto', `<div class="q-grid">${f('Cliente', 'customer.name', { type: 'text' })}${f('Contacto del cliente', 'customer.contact', { type: 'text' })}
      ${f('Identificación / NIT', 'customer.taxId', { type: 'text' })}${f('Dirección', 'customer.address', { type: 'text' })}
      ${f('Producto', 'product', { type: 'text' })}${f('Cantidad vendible', 'quantity')}${f('Descripción comercial', 'description', { type: 'textarea' })}
      ${f('Fecha', 'date', { type: 'date' })}${f('Válida hasta', 'validUntil', { type: 'date' })}${f('Entrega comprometida (opcional)', 'deliveryDate', { type: 'date' })}</div>
      <small>Para reutilizar cliente y producto de un trabajo anterior, abre el Historial y duplica su cotización.</small>`)}
      ${this.group('2. Datos reales del laminador', `<div class="q-grid">${f('Estos valores corresponden a', 'print.mode', { options: [['unit', 'UNA UNIDAD'], ['batch', 'UNA TANDA / PLACA COMPLETA']] })}
      ${f(q.print.mode === 'unit' ? 'Minutos por unidad' : 'Minutos por tanda completa', 'print.minutes')}
      ${f('Unidades por tanda', 'print.unitsPerBatch')}${f('Capacidad máxima de placa', 'print.capacity')}
      ${f('Preparación/retiro entre tandas (min)', 'print.turnaround')}${f('Tanda parcial', 'print.partialMethod', { options: [['estimate', 'Aproximación proporcional (se advertirá)'], ['actual', 'Valores reales del laminador']] })}
      ${q.print.mode === 'batch' && q.print.partialMethod === 'actual' ? f('Minutos reales de tanda parcial', 'print.partialMinutes') : ''}
      ${f('Perfil de impresión', 'profile', { type: 'text' })}${f('Altura de capa (mm)', 'layerHeight')}${f('Inicio previsto', 'print.start', { type: 'datetime-local' })}</div>
      <details class="q-sub"><summary>Ingresar tiempo en días, horas y minutos</summary><div class="q-duration"><label>Días<input data-duration="days" type="number" min="0" value="0"></label><label>Horas<input data-duration="hours" type="number" min="0" max="23" value="0"></label><label>Minutos<input data-duration="minutes" type="number" min="0" max="59" value="0"></label><button class="btn" data-action="duration">Aplicar duración</button></div></details>
      <p class="q-help">No confundas una pieza con una placa. Una tanda parcial solo es exacta si ingresas sus datos medidos.</p>${materials}<button class="btn" data-action="add-material">+ Otro material / color</button>`)}
      ${this.group('3. Impresoras', `${printers}<button class="btn" data-action="add-printer">+ Otra impresora</button>`, false)}
      ${this.group('4. Mano de obra', `<p class="q-help">Los ${cash(this.config.defaultLabor)} iniciales son POR UNIDAD. Cambia a “Por pedido” únicamente si ese trabajo realmente se comparte.</p>${costs('labor')}<button class="btn" data-action="add-labor">+ Actividad: preparación, retiro, soportes, lijado, pegado, personalización, control…</button>`, false)}
      ${this.group('5. Accesorios y empaque', `${accessories}<div class="q-actions"><button class="btn" data-action="ring" data-kind="standard">+ Anillo ${cash(this.config.ringStandard)}</button><button class="btn" data-action="ring" data-kind="alternative">+ Anillo alternativo ${cash(this.config.ringAlternative)}</button><button class="btn" data-action="add-accessory">+ Otro accesorio</button></div>
      <div class="q-grid">${f('Empaque aplicado', 'packaging.basis', { options: bases })}${f('Costo empaque COP', 'packaging.cost')}</div>`, true)}
      ${this.group('6. Otros costos y riesgos', `${costs('extras')}<button class="btn" data-action="add-extra">+ Transporte, servicio, embalaje o costo indirecto</button><div class="q-grid">
      ${f('Fallos / reimpresiones previstos %', 'failurePercent')}${f('Origen del porcentaje', 'failureSource', { options: [['assumption', 'Supuesto de planificación'], ['history', 'Histórico ingresado por el usuario']] })}
      ${f('Contingencia general adicional %', 'contingencyPercent')}${f('Notas internas (NO se exportan)', 'internalNotes', { type: 'textarea' })}</div>`, false)}
      ${this.group('7. Precio y condiciones', `<div class="q-grid">${f('Estrategia', 'strategy', { options: [['markup', 'Recargo sobre costo (markup)'], ['margin', 'Margen sobre venta'], ['manual', 'Simular un precio final']] })}
      ${q.strategy === 'manual' ? f(`Precio unitario final ${this.config.vatMode === 'included' ? 'con IVA' : 'sin IVA'} (COP)`, 'manualPrice', { help: 'No se vuelve a aplicar la escala mayorista a este precio manual.' }) : f(q.strategy === 'margin' ? 'Margen objetivo %' : 'Markup sobre costo %', 'target')}
      ${f('Descuento adicional %', 'discountPercent')}${f('Aplicar escala mayorista al precio sugerido', 'wholesale', { type: 'checkbox' })}
      ${f('Anticipo %', 'depositPercent')}${f('Condiciones comerciales', 'terms', { type: 'textarea' })}${f('Observaciones para el cliente', 'commercialNotes', { type: 'textarea' })}</div>
      <button class="btn" data-action="refresh-costs"${this.readOnly ? ' disabled' : ''}>Actualizar a costos vigentes</button>`, false)}
      </div><aside class="q-summary" data-summary></aside></div>`;
  }

  updateResults() {
    const errorBox = this.root.querySelector('[data-result-error]');
    try {
      if (this.tab === 'quick' && this.quickTimeError) throw new Error(this.quickTimeError);
      const issued = this.readOnly && !this.dirty ? this.record?.versions.find(v => v.version === this.exportVersion) : null;
      this.result = issued ? cloneQuote(issued.result) : calculateQuote(this.input, this.config);
      if (errorBox) errorBox.hidden = true;
      const summary = this.root.querySelector('[data-summary]');
      if (summary) {
        const expanded = new Map([...summary.querySelectorAll('[data-summary-detail]')].map(d => [d.dataset.summaryDetail, d.open]));
        summary.innerHTML = this.tab === 'quick' ? this.quickSummaryHTML() : this.summaryHTML(expanded);
      }
      const issue = this.root.querySelector('[data-action="issue"]');
      if (issue) issue.disabled = this.readOnly || !this.result.canIssue || this.busy;
      const save = this.root.querySelector('[data-action="save"]');
      if (save) save.disabled = this.readOnly || this.busy;
      this.root.querySelectorAll('[data-action="remove"],[data-action^="add-"]:not([data-action^="add-config"]),[data-action="ring"],[data-action="duration"],[data-action="quick-labor"],[data-action="quick-package"]').forEach(b => { b.disabled = this.readOnly; });
      this.root.querySelectorAll('[data-action="export"],[data-action="preview"]').forEach(b => { b.disabled = this.dirty || !this.exportVersion; });
      if (this.tab === 'wholesale') this.renderWholesale();
      if (this.tab === 'scenarios') this.renderScenarios();
      if (this.tab === 'production') this.renderProduction();
      if (this.tab === 'compare') this.updateComparison();
    } catch (error) {
      this.result = null;
      const emptyQuick = this.tab === 'quick' && !this.quickTouched && this.input.print.minutes === '' && this.input.materials[0]?.grams === '';
      if (errorBox) { errorBox.hidden = emptyQuick; errorBox.textContent = error.message; }
      const target = this.root.querySelector('[data-summary]') || this.root.querySelector('[data-results]');
      if (target) target.innerHTML = `<div class="q-card q-empty">${emptyQuick ? '<h2>¿Cuánto cuesta imprimirlo?</h2><p>Ingresa tiempo y gramos para ver el costo, el precio sugerido y tu utilidad estimada.</p>' : 'Corrige los datos indicados. No se muestran resultados de una entrada anterior.'}</div>`;
      this.root.querySelectorAll('[data-action="issue"],[data-action="save"],[data-action="export"]').forEach(b => { b.disabled = true; });
    }
  }
  quickSummaryHTML() {
    const r = this.result;
    const rows = Object.entries(r.categories).filter(([key, value]) => ['material', 'machine'].includes(key) || Number(value) !== 0)
      .map(([key, value]) => row([e(categories[key]), cash(r.categoryUnits[key]), cash(value)]));
    return `<section class="q-price${r.canIssue ? '' : ' q-loss'}"><span>${this.input.strategy === 'manual' ? 'Precio de venta' : 'Precio sugerido'} por unidad ${this.config.vatMode === 'included' ? '(IVA incluido)' : '(antes de IVA)'}</span>
      <strong>${cash(r.unitPrice)}</strong><p>${num(r.quantity)} piezas · Venta total <b>${cash(r.total)}</b></p></section>
      <div class="q-metrics"><div><span>Costo por unidad</span><strong>${cash(r.unitCost)}</strong></div>
      <div><span>Utilidad estimada total</span><strong class="${Number(r.profit) < 0 ? 'q-negative' : 'q-positive'}">${cash(r.profit)}</strong><small>Margen ${percent(r.margin)}</small></div></div>
      <section class="q-card"><h3>Lo que cuesta imprimirlo</h3>${table(['Concepto', '/ pieza', 'Total'], rows)}
      <div class="q-total"><span>Costo total</span><strong>${cash(r.totalCost)}</strong></div>
      <p class="q-help">Solo se incluyen los conceptos del desglose. Añade acabado, accesorios y empaque si los necesitas. La utilidad estimada no es ganancia neta.</p></section>
      ${r.canIssue ? '' : '<p class="q-error">Este precio está por debajo del mínimo permitido. Ajusta el precio antes de emitir una cotización completa.</p>'}
      <div class="q-actions"><button class="btn" data-tab="wholesale">Ver precios por volumen</button><button class="btn primary" data-tab="quote">Continuar con cotización completa</button></div>
      <p class="q-help">Puedes guardar este cálculo sin cliente. Los datos comerciales y el PDF se completan solo si decides continuar.</p>
      <details class="q-sub"><summary>Supuestos del cálculo</summary>${r.warnings.map(w => `<p class="q-help">${e(w)}</p>`).join('')}</details>`;
  }
  summaryHTML(expanded = new Map()) {
    const r = this.result;
    const open = key => (expanded.get(key) ?? window.innerWidth > 760) ? ' open' : '';
    const breakdown = Object.entries(r.categories).map(([key, value]) => row([e(categories[key]), cash(r.categoryUnits[key]), cash(value)]));
    return `<section class="q-price ${!r.canIssue ? 'q-loss' : ''}"><span>Precio unitario ${this.config.vatMode === 'included' ? 'con IVA' : 'antes de IVA'}</span><strong>${cash(r.unitPrice)}</strong><p>${num(r.quantity)} unidades · Total cliente <b>${cash(r.total)}</b></p></section>
      <div class="q-metrics"><div><span>Costo por unidad</span><strong>${cash(r.unitCost)}</strong></div><div><span>Utilidad estimada total</span><strong class="${Number(r.profit) < 0 ? 'q-negative' : 'q-positive'}">${cash(r.profit)}</strong></div>
      <div><span>Margen sobre venta</span><strong>${percent(r.margin)}</strong></div><div><span>Markup efectivo</span><strong>${percent(r.markup)}</strong></div></div>
      <details class="q-card" data-summary-detail="costs"${open('costs')}><summary>Desglose interno · COP</summary><div class="q-card-body">${table(['Concepto', '/ unidad', 'Pedido'], breakdown)}
      <div class="q-total"><span>Costo total</span><strong>${cash(r.totalCost)}</strong></div>
      <details class="q-sub"><summary>Ver todos los cargos</summary>${table(['Cargo', 'Aplicación', 'Total'], r.lines.map(l => row([e(l.name), l.basis === 'fixed' ? 'Fijo del pedido' : 'Variable', cash(l.amount)])))}</details></div></details>
      <details class="q-card" data-summary-detail="profit"${open('profit')}><summary>Rentabilidad y recursos</summary><div class="q-card-body">${table(['Indicador', 'Resultado'], [
        row(['Utilidad por unidad', cash(r.unitProfit)]), row(['Utilidad / hora de máquina', cash(r.machineProfitPerHour)]),
        row(['Utilidad / hora laboral', r.laborProfitPerHour === null ? 'Falta duración laboral' : cash(r.laborProfitPerHour)]),
        row(['Mínimo unitario sin IVA', cash(r.minimumUnitNet)]), row(['Capital estimado a financiar', cash(r.fundingEstimate)]),
        row(['Unidades a vender para recuperar este pedido', r.breakEvenUnits === null ? 'No recuperable' : num(r.breakEvenUnits)]),
      ])}</div></details>
      <section class="q-card q-commercial"><h3>Documento del cliente</h3><p class="q-help">Primero guarda/emite una versión. Los cambios posteriores no alteran el documento emitido.</p>
      <div class="q-actions"><button class="btn" data-action="preview">Vista comercial</button>${[['pdf','PDF A4'],['png','Imagen WhatsApp'],['compact','Imagen compacta'],['html','Imprimible'],['text','Copiar texto']].map(([format, label]) => `<button class="btn" data-action="export" data-format="${format}">${label}</button>`).join('')}</div></section>
      <div class="q-warnings">${r.warnings.map(w => `<p>${e(w)}</p>`).join('')}<strong>No es ganancia neta del negocio.</strong></div>`;
  }
  renderWholesale() {
    const q = cloneQuote(this.input);
    if (q.strategy === 'manual') { q.strategy = 'markup'; q.target = this.config.markup; }
    this.volumeResults = wholesaleTable(q, this.config);
    this.root.querySelector('[data-results="wholesale"]').innerHTML = `<div class="q-section-title"><h1>Una unidad, veinte o más de cien</h1><p>Costos recalculados para cada cantidad. Las preparaciones por pedido se reparten; los cargos por unidad no desaparecen.</p></div>
      ${table(['Cantidad','Costo / unidad','Venta / unidad','Venta total con IVA','Utilidad estimada','Margen','Descuento de escala',''], this.volumeResults.map(r => row([
        `<strong>${num(r.quantity)}</strong>${r.approximate ? '<small>Placa parcial aproximada</small>' : ''}`, cash(r.unitCost), `<strong>${cash(r.unitPrice)}</strong>`, cash(r.total),
        `<span class="${Number(r.profit) < 0 ? 'q-negative' : 'q-positive'}">${cash(r.profit)}</span>`, percent(r.margin),
        `${e(r.appliedTier.discount)}%${r.discountLimited ? '<small>Limitado por margen mínimo</small>' : ''}`,
        `<button class="btn" data-action="tier" data-quantity="${r.quantity}"${this.readOnly ? ' disabled' : ''}>Usar cantidad</button>`,
      ])))}
      <div class="q-card"><h3>Reglas visibles, no descuentos ocultos</h3>${table(['Desde','Hasta','Descuento propuesto'], this.config.tiers.map(t => row([num(t.from),t.to === null ? 'Sin límite' : num(t.to),`${e(t.discount)}%`])))}
      <p class="q-help">Edita estas reglas en Configuración. El precio sugerido se redondea hacia arriba a ${cash(this.config.roundTo)} y nunca baja del margen mínimo de ${e(this.config.minimumMargin)}%. Un precio manual se simula en Cotizar sin aplicar otra vez esta escala.</p></div>`;
  }
  renderScenarios() {
    const all = scenarios(this.input, this.config);
    this.root.querySelector('[data-results="scenarios"]').innerHTML = `<div class="q-section-title"><h1>Cuatro formas de vender</h1><p>Todos parten de los mismos costos reales. Las estrategias y objetivos son editables.</p></div><div class="q-scenarios">
      ${all.map((r, i) => `<article class="q-card"><span class="q-pill">${e(r.name)}</span><h2>${cash(r.unitPrice)} <small>/ unidad</small></h2>
      <p>${r.strategy === 'markup' ? 'Markup' : 'Margen objetivo'}: ${e(r.target)}%</p>
      ${table(['Indicador','Pedido'], [row(['Venta total',cash(r.total)]),row(['Utilidad estimada',cash(r.profit)]),row(['Margen efectivo',percent(r.margin)])])}
      ${r.discountLimited ? '<p class="q-warning">Objetivo ajustado al mínimo permitido.</p>' : ''}
      <button class="btn primary" data-action="scenario" data-index="${i}"${this.readOnly ? ' disabled' : ''}>Seleccionar ${e(r.name)}</button></article>`).join('')}</div>`;
  }
  comparePage() {
    return `<div class="q-section-title"><h1>Original vs. optimizado</h1><p>El diseño actual es la versión optimizada. Se conservan cantidad, accesorios, materiales, tarifas y condiciones para una comparación justa.</p></div>
      <section class="q-card"><div class="q-grid"><label class="q-field"><span>Minutos originales (${this.input.print.mode === 'unit' ? 'por unidad' : 'por placa'})</span><input type="number" step="any" data-compare="minutes" value="${e(this.comparison.minutes)}"></label>
      <label class="q-field"><span>Gramos originales del primer color</span><input type="number" step="any" data-compare="grams" value="${e(this.comparison.grams)}"></label>
      <label class="q-field q-check"><span>Comparar al mismo precio final de venta</span><input type="checkbox" data-compare="samePrice"${this.comparison.samePrice ? ' checked' : ''}></label>
      <label class="q-field q-check"><span>Confirmo que la optimización conserva la calidad requerida</span><input type="checkbox" data-compare="quality"${this.comparison.quality ? ' checked' : ''}></label></div></section><section data-comparison></section>`;
  }
  updateComparison() {
    const target = this.root.querySelector('[data-comparison]'); if (!target) return;
    try {
      const original = cloneQuote(this.input); original.print.minutes = this.comparison.minutes; original.materials[0].grams = this.comparison.grams;
      if (original.print.mode === 'batch' && original.print.partialMethod === 'actual') original.print.partialMethod = 'estimate';
      const r = compareQuotes(original, this.input, this.config, { samePrice: this.comparison.samePrice });
      const metrics = [['Costo total',r.original.totalCost,r.optimized.totalCost,cash],['Venta total',r.original.total,r.optimized.total,cash],
        ['Utilidad estimada',r.original.profit,r.optimized.profit,cash],['Horas de máquina',r.original.production.machineHours,r.optimized.production.machineHours,num],
        ['Utilidad / hora de máquina',r.original.machineProfitPerHour,r.optimized.machineProfitPerHour,cash],
        ['Mínimo / unidad sin IVA',r.original.minimumUnitNet,r.optimized.minimumUnitNet,cash],
        ['Finalización prevista',r.original.production.completion,r.optimized.production.completion,date]];
      target.innerHTML = table(['Indicador','Original','Optimizado'],metrics.map(([name,a,b,format])=>row([name,format(a),format(b)]))) +
        `<div class="q-metrics"><div><span>Ahorro de material</span><strong>${num(r.savedGrams)} g</strong></div><div><span>Ahorro de máquina</span><strong>${num(r.savedHours)} h</strong></div><div><span>Reducción de costo</span><strong>${percent(r.costReductionPercent)}</strong></div><div><span>Diferencia de utilidad</span><strong>${cash(r.profitDifference)}</strong></div><div><span>Capacidad productiva potencial adicional</span><strong>${percent(r.capacityGainPercent)}</strong></div></div>
        <div class="q-bars">${[['Original',r.original],['Optimizado',r.optimized]].map(([label,v])=>`<div><span>${label}</span><i style="width:${Math.max(1,Number(v.totalCost)/Math.max(Number(r.original.totalCost),Number(r.optimized.totalCost),1)*100)}%"></i><strong>${cash(v.totalCost)}</strong></div>`).join('')}</div>
        <p class="q-notice">${this.comparison.quality ? `Con la calidad confirmada, la opción con mayor utilidad estimada es: ${r.recommended === 'optimized' ? 'optimizada' : 'original'}.` : 'No se recomienda sacrificar calidad: confirma la equivalencia antes de elegir solo por rentabilidad.'}</p>
        <p class="q-help">La capacidad adicional presupone demanda, disponibilidad y posprocesamiento suficientes. Los datos de una tanda parcial original se aproximan si no hay una medición propia.</p>`;
    } catch (error) { target.innerHTML = `<div class="q-error">${e(error.message)}</div>`; }
  }
  renderProduction() {
    const r = this.result.production;
    this.root.querySelector('[data-results="production"]').innerHTML = `<div class="q-section-title"><h1>Plan de producción</h1><p>Horas de máquina acumuladas y horas calendario son cosas distintas.</p></div>
      <div class="q-metrics"><div><span>Tandas / placas</span><strong>${num(r.batches)}</strong><small>${r.fullBatches} completas · ${r.partialUnits} unidades en la parcial</small></div>
      <div><span>Horas de máquina</span><strong>${num(r.machineHours)}</strong></div><div><span>Horas calendario</span><strong>${num(r.calendarHours)}</strong></div>
      <div><span>Trabajo humano registrado</span><strong>${num(r.laborHours)} h</strong></div><div><span>Reserva adicional por fallos</span><strong>${num(r.failureReserveHours)} h</strong></div></div>
      <h2>Finalización base estimada: ${e(date(r.completion))}</h2><p class="q-help">No incluye la reserva probabilística de fallos ni el posprocesamiento posterior. No es una promesa de entrega.</p>
      ${table(['Impresora','Unidades','Tandas','Horas impresión','Fin desde inicio (h)','Costo base'],r.printers.map(p=>row([e(p.name),num(p.units),num(p.batches),num(p.hours),num(p.finishHours),cash(p.cost)])))}
      <h2>Material por color</h2>${table(['Material','Color','Modelo g','Purgas/soportes/merma g','Reserva fallos g','Total g'],r.usage.map(u=>row([e(u.material),e(u.color),num(u.baseGrams),num(u.extraGrams),num(u.failureGrams),num(u.grams)])))}
      <h2>Compras e inventario referencial</h2>${table(['Material','Necesario kg','Disponible g','Faltante g','Bobinas a comprar'],r.inventory.map(i=>row([e(i.material),num(i.kg),num(i.availableGrams),num(i.missingGrams),num(i.spoolsToBuy)])))}
      <div class="q-warnings">${this.result.warnings.map(w=>`<p>${e(w)}</p>`).join('')}</div>`;
  }

  status(record) {
    return record.status === 'sent' && record.input.validUntil < new Date().toISOString().slice(0,10) ? 'expired' : record.status;
  }
  filtered() {
    const f = this.filter, search = f.text.toLocaleLowerCase('es');
    return this.library.quotes.filter(r => (!search || `${r.number} ${r.input.customer.name} ${r.input.product}`.toLocaleLowerCase('es').includes(search)) &&
      (!f.from || r.input.date >= f.from) && (!f.to || r.input.date <= f.to) && (!f.status || this.status(r) === f.status) &&
      (!f.printer || r.input.printers.some(p=>p.printerId===f.printer)) && (!f.material || r.input.materials.some(m=>m.materialId===f.material))).slice().reverse();
  }
  historyPage() {
    const opts=(list,value)=>list.map(([v,n])=>`<option value="${e(v)}"${v===value?' selected':''}>${e(n)}</option>`).join('');
    return `<div class="q-section-title"><h1>${this.tab === 'history' ? 'Historial y versiones' : 'Análisis del negocio'}</h1><p>Snapshots emitidos inmutables, con usuario y fecha. Las cifras son estimaciones del pedido, no utilidad neta ni recaudos.</p></div>
      <div class="q-filters"><label>Cliente, producto o código<input data-filter="text" value="${e(this.filter.text)}"></label><label>Desde<input type="date" data-filter="from" value="${e(this.filter.from)}"></label><label>Hasta<input type="date" data-filter="to" value="${e(this.filter.to)}"></label>
      <label>Estado<select data-filter="status">${opts([['','Todos'],...Object.entries(statuses)],this.filter.status)}</select></label>
      <label>Impresora<select data-filter="printer">${opts([['','Todas'],...this.config.printers.map(p=>[p.id,p.name])],this.filter.printer)}</select></label>
      <label>Material<select data-filter="material">${opts([['','Todos'],...this.config.materials.map(m=>[m.id,m.name])],this.filter.material)}</select></label><button class="btn" data-action="reload">Recargar</button></div><div data-history></div>`;
  }
  updateHistory() {
    const target=this.root.querySelector('[data-history]'); if(!target)return;
    const records=this.filtered();
    if(this.tab==='analytics') {
      const a=quoteAnalytics(records), groups=list=>table(['Nombre','Pedidos','Ventas sin IVA','Utilidad estimada','Margen'],list.map(x=>row([e(x.name),num(x.count),cash(x.sales),cash(x.profit),percent(x.margin)])));
      target.innerHTML=`<div class="q-metrics"><div><span>Total cotizado sin IVA</span><strong>${cash(a.quoted)}</strong></div><div><span>Pedidos aceptados sin IVA</span><strong>${cash(a.sold)}</strong></div><div><span>Conversión</span><strong>${percent(a.conversion)}</strong><small>${a.accepted} de ${a.issued}</small></div><div><span>Utilidad estimada comprometida</span><strong>${cash(a.profit)}</strong></div><div><span>Horas de máquina comprometidas</span><strong>${num(a.hours)}</strong></div><div><span>Material estimado / real registrado</span><strong>${num(a.estimatedGrams)} / ${num(a.actualGrams)} g</strong></div></div>
        <h2>Productos</h2>${groups(a.products)}<h2>Clientes</h2>${groups(a.customers)}
        <h2>Impresoras</h2><p class="q-help">Utilidad asignada proporcionalmente a las horas del pedido; no es una medición contable individual.</p>${table(['Impresora','Horas','Utilidad asignada'],a.printers.map(p=>row([e(p.name),num(p.hours),cash(p.profit)])))}
        <h2>Estimado contra real</h2>${table(['Cotización','Versión','Costo estimado','Costo real','Desviación','Resultado del pedido'],a.actuals.map(x=>row([e(x.number),num(x.version),cash(x.estimated),cash(x.actual),cash(x.difference),cash(x.profit)])))}`;
      return;
    }
    target.innerHTML=table(['Cotización / fecha','Cliente / producto','Estado','Venta total','Utilidad estimada','Versiones y acciones'],records.map(r=>row([
      `<strong>${e(r.number)}</strong><small>${e(r.input.date)} · costos v${r.configVersion}</small><small>Creó ${e(r.createdBy)} · ${e(date(r.createdAt))}</small>`,
      `${e(r.input.customer.name||'Sin cliente')}<small>${e(r.input.product)} · ${num(r.input.quantity)} unidades</small>`,
      `<span class="q-pill">${e(statuses[this.status(r)])}</span>${r.order?`<small>${e(r.order.number)}</small>`:''}`,cash(r.result.total),`<span class="${Number(r.result.profit)<0?'q-negative':'q-positive'}">${cash(r.result.profit)}</span>`,
      `<div class="q-actions"><button class="btn" data-action="load" data-id="${r.id}">Abrir</button>${r.versions.map(v=>`<button class="btn" data-action="load" data-id="${r.id}" data-version="${v.version}" title="${e(date(v.issuedAt))} · ${e(v.issuedBy)}">v${v.version}</button>`).join('')}
      ${this.status(r)==='sent'?`<button class="btn" data-action="status" data-id="${r.id}" data-revision="${r.revision}" data-status="accepted">Aceptar</button><button class="btn" data-action="status" data-id="${r.id}" data-revision="${r.revision}" data-status="rejected">Rechazar</button>`:''}
      ${r.status==='accepted'?`<button class="btn" data-action="status" data-id="${r.id}" data-revision="${r.revision}" data-status="converted">Crear pedido local</button>`:''}</div>`,
    ])))+records.filter(r=>r.versions.length).map(r=>`<details class="q-card"><summary>Costos reales · ${e(r.number)}</summary><div class="q-card-body q-grid">
      <label class="q-field"><span>Costo real total COP, incluidas comisiones</span><input type="number" step="any" data-actual="cost" data-id="${r.id}" value="${e(r.actuals?.totalCost??'')}"></label>
      <label class="q-field"><span>Horas reales de máquina</span><input type="number" step="any" data-actual="hours" data-id="${r.id}" value="${e(r.actuals?.machineHours??'')}"></label>
      <label class="q-field"><span>Gramos reales consumidos</span><input type="number" step="any" data-actual="grams" data-id="${r.id}" value="${e(r.actuals?.grams??'')}"></label>
      <button class="btn" data-action="actuals" data-id="${r.id}">Registrar real · v${r.versions.at(-1).version}</button></div></details>`).join('');
  }

  settingsForm() {
    const f=(label,path,options={})=>this.field(label,path,{...options,config:true}), c=this.settings;
    const materials=c.materials.map((m,i)=>`<div class="q-line">${f('Material',`materials.${i}.name`,{type:'text'})}${f('Proveedor',`materials.${i}.supplier`,{type:'text'})}${f('Precio/kg COP',`materials.${i}.kgCost`)}${f('Peso de bobina kg',`materials.${i}.spoolKg`)}${f('Disponible g (referencial)',`materials.${i}.availableGrams`)}</div>`).join('');
    const printers=c.printers.map((p,i)=>`<div class="q-line">${f('Impresora',`printers.${i}.name`,{type:'text'})}${f('Tarifa',`printers.${i}.mode`,{options:[['bundled','Integrada (todo incluido)'],['components','Sumar componentes']]})}
      ${f('Tarifa integrada COP/h',`printers.${i}.hourlyRate`,{disabled:p.mode!=='bundled'})}${f('Consumo promedio kW',`printers.${i}.kw`,{disabled:p.mode!=='components'})}${f('Electricidad COP/kWh',`printers.${i}.kwhCost`,{disabled:p.mode!=='components'})}
      ${f('Depreciación COP/h',`printers.${i}.depreciation`,{disabled:p.mode!=='components'})}${f('Mantenimiento COP/h',`printers.${i}.maintenance`,{disabled:p.mode!=='components'})}
      ${f('Factor de tiempo del perfil',`printers.${i}.factor`,{help:'1 = tiempo indicado; 1.2 = 20% más lento. Es una calibración explícita.'})}${f('Disponible después de (min)',`printers.${i}.availableMinutes`)}</div>`).join('');
    return `<div class="q-section-title"><h1>Configuración versionada</h1><p>Cada guardado crea una versión. Las cotizaciones históricas conservan sus parámetros y resultados originales.</p><button class="btn primary" data-action="save-settings">Guardar nueva versión de costos</button></div>
      ${this.group('Negocio y vigencia',`<div class="q-grid">${f('Vigente desde','effectiveAt',{type:'date'})}${f('Marca','brand.name',{type:'text'})}${f('Contacto comercial','brand.contact',{type:'text'})}${f('NIT / identificación','brand.taxId',{type:'text'})}${f('Dirección','brand.address',{type:'text'})}<label class="q-field"><span>Logo PNG/JPEG hasta 1 MB</span><input type="file" data-logo accept="image/png,image/jpeg"></label></div>${c.brand.logo?`<img class="q-logo-preview" src="${e(c.brand.logo)}" alt="Logo comercial">`:''}`)}
      ${this.group('Materiales y proveedores',`${materials}<button class="btn" data-action="add-config-material">+ Material</button><div class="q-grid">${f('Purgas / reserva inicial %','purgePercent')}${f('Soportes adicionales %','supportPercent')}${f('Merma de proceso independiente %','wastePercent')}</div><p class="q-help">Marcar “ya incluye” en el material evita sumar nuevamente purgas o soportes. La merma de proceso es un concepto separado.</p>`)}
      ${this.group('Impresoras y costos horarios',`${printers}<button class="btn" data-action="add-config-printer">+ Impresora</button><p class="q-help">La tarifa integrada excluye la suma de componentes. No se cobra electricidad o depreciación dos veces.</p>`,false)}
      ${this.group('Precios, impuestos y comisiones',`<div class="q-grid">${f('Markup inicial %','markup')}${f('Margen mínimo permitido %','minimumMargin')}${f('Precio mínimo unitario sin IVA','minimumUnitPrice')}${f('Redondeo comercial hacia arriba COP','roundTo')}
      ${f('IVA %','vatPercent')}${f('Precio mostrado','vatMode',{options:[['excluded','Antes de IVA'],['included','IVA incluido']]})}${f('Comisión de pago %','feePercent')}${f('Comisión fija por pedido COP','feeFixed')}${f('La comisión se aplica también al IVA','feeOnTax',{type:'checkbox'})}
      ${f('Preparación/acabado inicial por unidad','defaultLabor')}${f('Empaque inicial por unidad','defaultPackaging')}${f('Anillo estándar','ringStandard')}${f('Anillo alternativo','ringAlternative')}</div><p class="q-help">Markup 55% equivale a un margen de aproximadamente 35.48%, no a un margen de 55%. El IVA no se cuenta como utilidad.</p>`)}
      ${this.group('Escenarios comerciales (reglas visibles)',c.scenarios.map((s,i)=>`<div class="q-line">${f('Nombre',`scenarios.${i}.name`,{type:'text'})}${f('Estrategia',`scenarios.${i}.strategy`,{options:[['markup','Markup sobre costo'],['margin','Margen sobre venta']]})}${f('Objetivo %',`scenarios.${i}.value`)}</div>`).join(''),false)}
      ${this.group('Escalas mayoristas',c.tiers.map((t,i)=>`<div class="q-line">${f('Desde unidades',`tiers.${i}.from`)}${t.to===null?'<p>Hasta: sin límite</p>':f('Hasta unidades',`tiers.${i}.to`)}${f('Descuento propuesto %',`tiers.${i}.discount`)}<button class="btn" data-action="remove-config-tier" data-index="${i}">Unir con tramo vecino</button></div>`).join('')+'<button class="btn" data-action="add-config-tier">+ Agregar tramo</button><p class="q-help">Los rangos deben ser continuos. Los descuentos se limitan si comprometen el margen mínimo.</p>',false)}
      <section class="q-card"><h3>Versiones de configuración</h3>${table(['Versión','Vigencia','Guardó','Fecha'],this.library.configs.slice().reverse().map(v=>row([`v${v.version}`,e(v.value.effectiveAt),e(v.actor),e(date(v.createdAt))])))}</section>`;
  }
}
