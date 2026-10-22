import { ensureFont } from './core/text.js';

let nextId = 0;
const node = (tag, className, text) => {
  const el = document.createElement(tag);
  el.className = className;
  if (text != null) el.textContent = text;
  return el;
};
const normalized = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

export class FontPicker {
  constructor(select, { sample, label = 'Fuente', loadFont = ensureFont, onError }) {
    this.select = select;
    this.sample = sample;
    this.label = label;
    this.loadFont = loadFont;
    this.onError = onError;
    this.id = `font-picker-${++nextId}`;
    this.button = node('button', 'font-picker-trigger');
    this.button.type = 'button';
    this.button.setAttribute('aria-label', label);
    this.button.setAttribute('aria-haspopup', 'listbox');
    this.button.setAttribute('aria-expanded', 'false');
    this.name = node('span', 'font-picker-name');
    this.preview = node('span', 'font-picker-sample');
    this.preview.setAttribute('aria-hidden', 'true');
    this.button.append(this.name, this.preview);
    this.popup = node('div', 'font-picker-popup');
    this.popup.popover = 'auto';
    this.search = node('input', 'font-picker-search');
    this.search.type = 'search';
    this.search.placeholder = 'Buscar fuente...';
    this.search.setAttribute('aria-label', 'Buscar fuente');
    this.search.setAttribute('role', 'combobox');
    this.search.setAttribute('aria-autocomplete', 'list');
    this.search.setAttribute('aria-expanded', 'false');
    this.list = node('div', 'font-picker-list');
    this.list.id = this.id;
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', label);
    this.button.setAttribute('aria-controls', this.id);
    this.search.setAttribute('aria-controls', this.id);
    this.status = node('div', 'font-picker-status');
    this.status.setAttribute('role', 'status');
    this.popup.append(this.search, this.list, this.status);
    select.after(this.button, this.popup);
    select.hidden = true;
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        this.observer.unobserve(entry.target);
        this.paint(entry.target.querySelector('.font-picker-sample'), entry.target.dataset.font, this.sample());
      }
    }, { root: this.list, rootMargin: '80px' });
    this.button.addEventListener('click', () => this.opened ? this.close() : this.open());
    this.button.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation(); this.open();
      }
    });
    this.search.addEventListener('input', () => this.render());
    this.popup.addEventListener('keydown', event => this.keydown(event));
    this.list.addEventListener('click', event => {
      const option = event.target.closest('[data-font]');
      if (option && !option.disabled) this.choose(option.dataset.font);
    });
    this.popup.addEventListener('toggle', () => {
      this.button.setAttribute('aria-expanded', String(this.opened));
      this.search.setAttribute('aria-expanded', String(this.opened));
      if (!this.opened) { this.observer.disconnect(); this.choice = null; }
    });
    select.addEventListener('change', () => this.sync());
    this.mutations = new MutationObserver(() => this.sync());
    this.mutations.observe(select, { childList: true, subtree: true, attributes: true });
    this.resize = new ResizeObserver(() => { if (this.opened) this.position(); });
    this.resize.observe(this.button);
    window.addEventListener('resize', () => { if (this.opened) this.position(); });
    document.addEventListener('scroll', event => {
      if (this.opened && !this.popup.contains(event.target)) this.position();
    }, true);
    this.sync();
  }

  get opened() { return this.popup.matches(':popover-open'); }

  async paint(el, family, sample = {}) {
    const text = String(sample?.text || '').trim().replace(/\s+/g, ' ') || 'Aa Bb 123';
    const weight = sample?.weight || 400, italic = !!sample?.italic;
    const key = JSON.stringify([family, text, weight, italic]);
    if (el.dataset.preview === key) return;
    el.dataset.preview = key;
    el.dataset.state = 'loading';
    el.textContent = 'Cargando vista previa...';
    el.style.fontFamily = '';
    el.title = text;
    try {
      await this.loadFont(family, weight);
      if (el.dataset.preview !== key) return;
      el.style.fontFamily = `${JSON.stringify(family)}, sans-serif`;
      el.style.fontWeight = weight;
      el.style.fontStyle = italic ? 'italic' : 'normal';
      el.textContent = text;
      el.dataset.state = 'ready';
    } catch (error) {
      if (el.dataset.preview !== key) return;
      el.textContent = 'Vista previa no disponible';
      el.title = error.message;
      el.dataset.state = 'error';
      console.warn('font preview', family, error);
    }
  }

  sync() {
    const family = this.select.value;
    this.button.disabled = this.select.disabled;
    this.name.textContent = family || 'Elegir fuente';
    this.button.setAttribute('aria-label', `${this.label}: ${family || 'Elegir fuente'}`);
    this.button.title = `Fuente: ${family}`;
    if (family) this.paint(this.preview, family, this.sample());
    if (this.opened) {
      if (this.button.disabled) this.close();
      else this.render();
    }
  }

  open() {
    if (this.button.disabled || this.opened) return;
    this.search.value = '';
    this.popup.showPopover();
    this.render();
    this.position();
    this.search.focus({ preventScroll: true });
  }

  close(focus = false) {
    this.choice = null;
    if (this.opened) this.popup.hidePopover();
    if (focus) this.button.focus({ preventScroll: true });
  }

  position() {
    const rect = this.button.getBoundingClientRect();
    if (!rect.width || !rect.height) { this.close(); return; }
    const width = Math.min(400, innerWidth - 16);
    const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
    const upward = below < 240 && above > below;
    this.popup.style.width = `${width}px`;
    this.popup.style.maxHeight = `${Math.max(100, Math.min(490, innerHeight - 16, upward ? above : below))}px`;
    this.popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    const height = this.popup.offsetHeight, top = upward ? rect.top - height - 4 : rect.bottom + 4;
    this.popup.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`;
  }

  render() {
    this.observer.disconnect();
    const query = normalized(this.search.value.trim());
    const fragment = document.createDocumentFragment();
    this.rows = [];
    let lastGroup = null;
    for (const option of this.select.options) {
      if (option.hidden || !option.value || !normalized(option.text).includes(query)) continue;
      const group = option.parentElement.tagName === 'OPTGROUP' ? option.parentElement : null;
      if (group?.label && group !== lastGroup) {
        const heading = node('div', 'font-picker-group', group.label);
        heading.setAttribute('role', 'presentation');
        fragment.append(heading);
      }
      lastGroup = group;
      const row = node('button', 'font-picker-option');
      row.type = 'button';
      row.tabIndex = -1;
      row.id = `${this.id}-${this.rows.length}`;
      row.dataset.font = option.value;
      row.disabled = option.disabled || !!group?.disabled;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-label', option.text);
      row.setAttribute('aria-selected', String(option.value === this.select.value));
      const preview = node('span', 'font-picker-sample', 'Cargando vista previa...');
      preview.dataset.state = 'loading';
      preview.setAttribute('aria-hidden', 'true');
      row.append(node('span', 'font-picker-name', option.text), preview);
      fragment.append(row);
      this.rows.push(row);
    }
    this.list.replaceChildren(fragment);
    const count = this.rows.length;
    this.status.textContent = count ? `${count} ${count === 1 ? 'fuente' : 'fuentes'}. Flechas para explorar, Enter para elegir, Esc para cancelar.` : 'No hay fuentes con ese nombre.';
    this.active = -1;
    const selected = this.rows.findIndex(row => row.dataset.font === this.select.value && !row.disabled);
    this.activate(selected >= 0 ? selected : this.rows.findIndex(row => !row.disabled));
    for (const row of this.rows) this.observer.observe(row);
    this.position();
  }

  activate(index) {
    this.rows[this.active]?.classList.remove('active');
    this.active = index;
    const row = this.rows[index];
    if (!row) { this.search.removeAttribute('aria-activedescendant'); return; }
    row.classList.add('active');
    this.search.setAttribute('aria-activedescendant', row.id);
    const item = row.getBoundingClientRect(), list = this.list.getBoundingClientRect();
    if (item.top < list.top) this.list.scrollTop -= list.top - item.top;
    else if (item.bottom > list.bottom) this.list.scrollTop += item.bottom - list.bottom;
    this.paint(row.querySelector('.font-picker-sample'), row.dataset.font, this.sample());
  }

  keydown(event) {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape', 'Tab'];
    if (!keys.includes(event.key)) return;
    event.stopPropagation();
    if (event.key === 'Tab') { this.close(true); return; }
    event.preventDefault();
    if (event.key === 'Escape') { this.close(true); return; }
    if (event.key === 'Enter') {
      const row = this.rows[this.active];
      if (row) this.choose(row.dataset.font);
      return;
    }
    const indices = this.rows.map((row, index) => row.disabled ? -1 : index).filter(index => index >= 0);
    if (!indices.length) return;
    const current = indices.indexOf(this.active);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? indices.length - 1
      : Math.max(0, Math.min(indices.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    this.activate(indices[index]);
  }

  async choose(family) {
    const choice = {};
    this.choice = choice;
    try {
      await this.loadFont(family, this.sample()?.weight || 400);
      if (this.choice !== choice || !this.opened || this.select.disabled) return;
      const option = [...this.select.options].find(option => option.value === family);
      if (!option || option.disabled || option.parentElement.disabled) return;
      const changed = this.select.value !== family;
      this.select.value = family;
      this.close(true);
      if (changed) this.select.dispatchEvent(new Event('change', { bubbles: true }));
      this.sync();
    } catch (error) {
      if (this.choice !== choice) return;
      const message = `No se pudo cargar la fuente ${family}: ${error.message}`;
      this.status.textContent = message;
      this.onError(message, true);
    }
  }
}
