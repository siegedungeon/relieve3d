import { drawSettingDiagram } from './setting_diagrams.js';
const registered = new WeakMap();
const choiceDetails = {
  finish: { relief: 'Sobresale de la cara', flat: 'Color al ras', engrave: 'Hundido en la pieza' },
  coloring: { illustration: 'Ignora sombras suaves', regions: 'Traza los límites de cada zona' },
  layout: { fill: 'Aprovecha el espacio de la lámina', exact: 'Respeta lo pedido por diseño' },
  source: { param: 'Se dibuja con tus medidas', mockup: 'Toma la forma de una imagen' },
  split: { carve: 'Mantiene el tamaño original', covers: 'Piezas que se pegan sobre la base', inlays: 'Piezas que entran en huecos',
    skin: 'Añade material sobre la superficie', sculpt: 'Aumenta y suaviza la envolvente' },
};

export function syncVisualSettingChoices(root) {
  for (const select of root.querySelectorAll('select[data-visual-setting]')) {
    if (!registered.has(select)) registered.set(select, visualSettingChoices(select, {
      title: select.dataset.visualTitle, kind: select.dataset.visualSetting,
    }));
    registered.get(select).sync();
  }
}

// The native select stays the form's source of truth, including project loading and validation.
export function visualSettingChoices(select, { title, kind, paint }) {
  const group = document.createElement('fieldset');
  group.className = 'setting-choices';
  group.dataset.noSettingGuide = '';
  const legend = document.createElement('legend');
  legend.textContent = title;
  group.append(legend);

  const name = `visual-${select.closest('[id]')?.id || 'main'}-${select.dataset.k || select.dataset.set || select.dataset.config || select.dataset.opt}`;
  const choices = document.createElement('div');
  choices.className = 'setting-choice-grid';
  choices.dataset.columns = String(select.options.length === 3 || select.options.length > 6 ? 3 : 2);
  group.append(choices);
  const cards = [...select.options].map(option => {
    const label = document.createElement('label');
    label.className = 'setting-choice';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = name;
    radio.value = option.value;
    const info = document.createElement('span');
    const canvas = document.createElement('canvas');
    canvas.width = 224;
    canvas.height = 144;
    canvas.setAttribute('aria-hidden', 'true');
    const caption = document.createElement('span');
    caption.textContent = option.label;
    info.append(canvas, caption);
    const detail = choiceDetails[kind]?.[option.value];
    if (detail) {
      const hint = document.createElement('small');
      hint.textContent = detail;
      info.append(hint);
    }
    label.append(radio, info);
    choices.append(label);
    return { radio, canvas };
  });
  const source = select.closest('label');
  source.classList.add('native-setting-choice');
  source.after(group);
  const sync = () => {
    group.hidden = source.hidden;
    group.disabled = select.disabled;
    for (const { radio } of cards) radio.checked = radio.value === select.value;
  };
  const redraw = () => {
    for (const { radio, canvas } of cards) {
      if (paint) paint(canvas, radio.value);
      else drawSettingDiagram(canvas, kind, radio.value);
    }
  };
  group.addEventListener('change', event => {
    const radio = event.target;
    if (!radio.checked || select.disabled) return;
    select.value = radio.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    sync();
  });
  select.addEventListener('change', () => queueMicrotask(sync));
  window.addEventListener('r3d-theme-change', redraw);
  redraw();
  sync();
  return { sync };
}
