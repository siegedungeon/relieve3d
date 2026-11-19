import { drawSettingDiagram, SETTING_ICONS } from './setting_diagrams.js';
import { settingHelp } from './setting_help.js';

const fields = 'input:not([type="hidden"]):not([type="password"]):not([type="radio"]), select, textarea';
const sectionSelector = '.card, fieldset, .q-card, .tk-card, .ib-card, .ib-section';
const clean = value => value.trim().replace(/\s+/g, ' ');
const unitFrom = caption => caption.match(/(?:\(|\s)(mm[²³]?|cm|px|ppp|°|%|COP|g|kg|h|min|s)(?=\)|\s|$)/i)?.[1] || '';

function captionElement(label, field) {
  const direct = [...label.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (direct.length) {
    const caption = document.createElement('span');
    direct[0].before(caption);
    for (const node of direct) caption.append(node);
    return caption;
  }
  return [...label.children].find(child => child.tagName === 'SPAN' && !child.contains(field) && child.textContent.trim());
}

function valueFor(field, caption) {
  const unit = unitFrom(caption);
  const format = value => value === '' ? '' : `${value}${unit ? ' ' + unit : ''}`;
  if (field.type === 'checkbox') return { value: field.checked ? 'Activado' : 'Desactivado', sample: field.checked ? 'on' : 'off' };
  if (field.tagName === 'SELECT') return { value: clean(field.selectedOptions[0]?.label || ''), sample: field.value };
  if (field.type === 'color') return { value: field.value.toUpperCase(), sample: field.value };
  if (['number', 'range'].includes(field.type) || ['decimal', 'numeric'].includes(field.inputMode)) {
    const min = field.dataset.min ?? field.min, max = field.dataset.max ?? field.max;
    return { value: format(field.value), sample: field.value, range: min && max ? `${format(min)} a ${format(max)}`
      : min ? `Desde ${format(min)}` : max ? `Hasta ${format(max)}` : '' };
  }
  return {};
}

export function installSettingGuides() {
  const card = document.createElement('div');
  card.className = 'setting-guide';
  card.setAttribute('popover', 'manual');
  card.setAttribute('aria-hidden', 'true');
  card.innerHTML = `<div class="setting-illustration"><canvas width="224" height="144"></canvas></div>
    <div class="setting-explanation"><div class="setting-section"></div><strong></strong><p></p>
    <div class="setting-value"></div><small></small></div>`;
  document.body.append(card);
  const [canvas, sectionText, title, description, current, note] = card.querySelectorAll('canvas, .setting-section, strong, p, .setting-value, small');

  let active = null, focused = null, hovered = null, dismissed = null, timer = 0, frame = 0;
  const guides = new WeakMap();

  const decorate = label => {
    if (guides.has(label) || label.closest('#home, .theme-bar, .native-setting-choice, [data-no-setting-guide]')) return;
    const field = label.control;
    if (!field?.matches(fields)) return;
    const caption = captionElement(label, field);
    if (!caption || caption.matches('.sr-only')) return;
    const name = clean(caption.textContent.replace(/^\p{Extended_Pictographic}\s*/u, ''));
    if (!name) return;
    const section = clean(label.closest(sectionSelector)?.querySelector('h3, h4, legend')?.textContent || '');
    const spec = settingHelp(label, field, name);
    caption.classList.add('setting-caption');
    caption.dataset.settingIcon = SETTING_ICONS[spec.kind];
    label.classList.add('has-setting-guide');
    if (spec.help && !field.hasAttribute('aria-description')) field.setAttribute('aria-description', spec.help);
    guides.set(label, { ...spec, label, field, name, section });
  };

  function targetFor(node) {
    if (!(node instanceof Element)) return null;
    const labels = node.labels ? [...node.labels] : [node.closest('label')];
    for (const label of labels) {
      if (!label) continue;
      decorate(label);
      const guide = guides.get(label);
      if (guide) return guide;
    }
    return null;
  }

  const close = () => {
    if (!active) return;
    card.hidePopover();
    active = null;
  };

  const position = () => {
    if (!active) return;
    const rect = active.label.getBoundingClientRect();
    const clip = active.label.closest('.panel, .laser-settings, .q-page, .tk-page, .ib-content')?.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < (clip?.top ?? 0) || rect.top > (clip?.bottom ?? innerHeight)) { close(); return; }
    const { width, height } = card.getBoundingClientRect();
    const gap = 10;
    const right = rect.right + gap, left = rect.left - width - gap;
    const x = right + width + gap <= innerWidth ? right : left >= gap ? left : Math.min(Math.max(gap, rect.left), innerWidth - width - gap);
    const beside = x === right || x === left;
    const y = beside ? rect.top - 4 : rect.bottom + height + gap * 2 <= innerHeight ? rect.bottom + gap : rect.top - height - gap;
    card.style.left = `${Math.max(gap, x)}px`;
    card.style.top = `${Math.max(gap, Math.min(y, innerHeight - height - gap))}px`;
  };

  const render = guide => {
    if (!guide || guide === dismissed || !guide.field.isConnected || guide.label.closest('[hidden]')) { close(); return; }
    const state = valueFor(guide.field, guide.name);
    sectionText.textContent = guide.section === guide.name ? '' : guide.section;
    title.textContent = guide.name;
    description.textContent = guide.help || '';
    description.hidden = !guide.help;
    current.textContent = state.value || '';
    current.hidden = !state.value;
    note.textContent = [state.range, guide.note].filter(Boolean).join(' · ');
    note.hidden = !note.textContent;
    const wasOpen = !!active;
    active = guide;
    if (!wasOpen) card.showPopover();
    drawSettingDiagram(canvas, guide.kind, state.sample);
    position();
  };

  const prefer = delay => {
    clearTimeout(timer);
    timer = setTimeout(() => render(hovered || focused), delay);
  };

  document.addEventListener('pointerover', event => {
    if (event.pointerType !== 'mouse') return;
    const guide = targetFor(event.target);
    if (!guide || guide === hovered) return;
    hovered = guide;
    if (guide !== dismissed) dismissed = null;
    prefer(300);
  });
  document.addEventListener('pointerout', event => {
    if (!hovered || !hovered.label.contains(event.target) || hovered.label.contains(event.relatedTarget)) return;
    hovered = null;
    prefer(100);
  });
  card.addEventListener('pointerenter', () => clearTimeout(timer));
  card.addEventListener('pointerleave', () => prefer(100));
  document.addEventListener('focusin', event => {
    focused = targetFor(event.target);
    dismissed = null;
    if (focused) hovered = null;
    prefer(0);
  });
  document.addEventListener('focusout', () => { focused = null; prefer(120); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !active) return;
    dismissed = active;
    close();
  });
  const refresh = event => {
    if (active?.field !== event.target) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => render(active));
  };
  document.addEventListener('input', refresh);
  document.addEventListener('change', refresh);
  document.addEventListener('scroll', position, true);
  window.addEventListener('resize', position);

  for (const label of document.querySelectorAll('label')) decorate(label);
  const observer = new MutationObserver(changes => {
    for (const change of changes) {
      for (const node of change.addedNodes) {
        if (!(node instanceof Element) || node === card || card.contains(node)) continue;
        if (node.matches('label')) decorate(node);
        for (const label of node.querySelectorAll('label')) decorate(label);
      }
    }
    if (active && (!active.field.isConnected || active.label.closest('[hidden]'))) close();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributeFilter: ['hidden'] });
}
