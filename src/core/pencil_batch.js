import * as THREE from 'three';
import { DEFAULT_TEXT, ensureFont, renderTextImage } from './text.js';
import { DEFAULT_SETTINGS, buildFeatures } from './features.js';
import { DEFAULT_PROC, processImage } from './processing.js';
import { imageReady } from './imageload.js';
import { shapesToGeometry, toWorld } from './geometry.js';
import { preparePencil, joinedPencilGeometry } from './pencil.js';
import { mergeToIndexed, stlBinary, threeMF } from './exporters.js';

export const PENCIL_PRESET = {
  patch: {
    widthMM: 50,
    base: { enabled: true, margin: 2, thickness: 11.6, weld: true },
    pencil: { enabled: true, mount: 'integrated', type: 'round', value: 7.9, tolerance: 0, wall: 1.6, ends: 'open', relief: 1.4 },
  },
  text: { text: 'Linda', font: 'Matemasie', weight: 400, outline: false, fill: '#ffffff', baseColor: '#5e43b7', decoration: 'none' },
};

export function parsePencilNames(input) {
  const names = String(input).split(/[\r\n,;]+/).map(n => n.trim()).filter(Boolean);
  if (!names.length) throw new Error('Escribe al menos un nombre, uno por renglón.');
  if (names.some(n => /[\x00-\x1f\x7f]/.test(n))) throw new Error('El listado contiene caracteres de control no válidos.');
  return names;
}

export function fitPencilName(metrics) {
  const w = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
  const h = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  if (!(w > 0 && h > 0)) throw new Error('El nombre no contiene letras visibles.');
  const naturalWidth = w / h * 14;
  const widthMM = Math.min(70.8, naturalWidth);
  const scaleX = widthMM / naturalWidth * 100;
  if (scaleX < 25) throw new Error('El nombre es demasiado largo: acórtalo para conservar letras imprimibles.');
  return { widthMM, scaleX };
}

export async function planPencilName(name) {
  await ensureFont('Matemasie', 400);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = '400 220px "Matemasie"';
  const plan = fitPencilName(ctx.measureText(name));
  return { widthMM: plan.widthMM, text: { ...DEFAULT_TEXT(), ...PENCIL_PRESET.text, text: name, scaleX: plan.scaleX } };
}

export function packPencilModels(models) {
  const plates = [];
  let plate = [], x = 6, y = 6, rowHeight = 0;
  for (const [index, model] of models.entries()) {
    const [width, height, depth] = model.size;
    if (![width, height, depth].every(n => Number.isFinite(n) && n > 0)
      || width > 75 || height > 19 || depth > 13.001) throw new Error(`«${model.name}» supera 75 × 19 × 13 mm.`);
    if (x + width > 250) { x = 6; y += rowHeight + 3; rowHeight = 0; }
    if (y + height > 205) { plates.push(plate); plate = []; x = 6; y = 6; rowHeight = 0; }
    plate.push({ index, name: model.name, x, y, width, height, shift: [x - model.bounds.min[0], y - model.bounds.min[1]] });
    x += width + 3; rowHeight = Math.max(rowHeight, height);
  }
  if (plate.length) plates.push(plate);
  return plates;
}

const interrupted = signal => {
  if (signal?.aborted) throw new DOMException('Lote cancelado.', 'AbortError');
};
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));

async function buildName(name) {
  const plan = await planPencilName(name);
  const settings = DEFAULT_SETTINGS();
  settings.widthMM = plan.widthMM;
  Object.assign(settings.base, PENCIL_PRESET.patch.base, { filament: 1 });
  Object.assign(settings.pencil, PENCIL_PRESET.patch.pencil, { filament: 1 });
  await preparePencil(settings);
  const rendered = renderTextImage(plan.text, plan.widthMM);
  const image = new Image(); image.src = rendered.dataURL; await imageReady(image);
  const canvas = document.createElement('canvas');
  const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const proc = { ...DEFAULT_PROC, colors: 1, removeBg: 'no', maxRes: 1600, detail: 0.6, minArea: 0, upscale: false };
  const result = processImage(ctx.getImageData(0, 0, canvas.width, canvas.height), { ...proc, widthMM: plan.widthMM });
  const b = result.fgBBox, scale = plan.widthMM / (b[2] - b[0]), center = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const feat = buildFeatures(result, settings, { scale, center, detail: proc.detail, smooth: proc.smooth });
  const owned = [], own = g => { owned.push(g); return g; };
  try {
    feat.solids.forEach(s => own(s.geometry));
    if (!feat.pencilChannel || feat.solids.length !== 1 || feat.layers.length) throw new Error('No se pudo crear la base con el canal integrado.');
    const base = own(mergeToIndexed([own(toWorld(feat.solids[0].geometry, scale, 1, 0))]));
    const letters = result.pieces.map(p => own(toWorld(own(shapesToGeometry(p.shapes, ...center)), scale, settings.pencil.relief, feat.pieceZ)));
    const white = own(mergeToIndexed(letters));
    const parts = [
      { name: 'Base con canal', color: plan.text.baseColor, filamentIndex: 0, geometry: base },
      { name: 'Nombre blanco', color: plan.text.fill, filamentIndex: 1, geometry: white },
    ];
    const joined = own(joinedPencilGeometry(parts.map(p => p.geometry)));
    joined.computeBoundingBox();
    const bounds = { min: joined.boundingBox.min.toArray(), max: joined.boundingBox.max.toArray() };
    const size = joined.boundingBox.getSize(new THREE.Vector3()).toArray();
    packPencilModels([{ name, size, bounds }]);
    const state = {
      module: 'pencil', source: 'text', text: plan.text, proc, settings,
      pieces: result.pieces.map(() => ({ height: settings.pencil.relief, elevation: 0, filament: 2, enabled: true })),
      filaments: [{ id: 1, name: 'Base morada', color: plan.text.baseColor }, { id: 2, name: 'Nombre blanco', color: plan.text.fill }],
      clusterFilament: [2], groups: [],
    };
    const project = JSON.stringify({ app: 'Relieve3D', version: 1, image: { name: 'texto.png', dataURL: rendered.dataURL }, state });
    const stl = stlBinary([joined]), model = threeMF(parts, name);
    return { name, size, bounds, channel: feat.pencilChannel, project, stl, model, parts: parts.map(p => ({ ...p, geometry: p.geometry.clone() })) };
  } finally { owned.forEach(g => g.dispose()); }
}

export async function generatePencilBatch(input, { profile, signal, onProgress = () => {} } = {}) {
  const names = parsePencilNames(input), models = [];
  if (!profile || profile.printer_model !== 'Bambu Lab A1') throw new Error('Falta el perfil de impresión Bambu A1.');
  try {
    for (const [index, name] of names.entries()) {
      interrupted(signal);
      onProgress({ completed: index, total: names.length, name });
      await yieldUI(); interrupted(signal);
      try { models.push(await buildName(name)); }
      catch (error) { throw new Error(`«${name}»: ${error.message}`, { cause: error }); }
      await yieldUI(); interrupted(signal);
    }
    const plates = packPencilModels(models), files = [];
    const report = models.map((model, index) => {
      const file = `${String(index + 1).padStart(3, '0')}_${model.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/, '').slice(0, 80)}`;
      files.push({ name: file + '.r3d', data: model.project }, { name: file + '.3mf', data: model.model }, { name: file + '.stl', data: model.stl });
      return { name: model.name, file, size: model.size, bounds: model.bounds, channel: model.channel };
    });
    for (const [index, placements] of plates.entries()) {
      onProgress({ completed: names.length, total: names.length, name: `Placa ${index + 1}/${plates.length}` });
      await yieldUI(); interrupted(signal);
      const parts = [], assemblies = [];
      for (const placement of placements) {
        const model = models[placement.index], start = parts.length;
        parts.push(...model.parts);
        assemblies.push({ name: model.name, parts: [start, start + 1], shift: placement.shift });
      }
      files.push({ name: `Placa_${String(index + 1).padStart(2, '0')}_Bambu_A1.3mf`,
        data: threeMF(parts, 'Lapiceros Matemasie - morado y blanco', { assemblies, bambu: profile }) });
    }
    files.push({ name: 'Nombres.txt', data: names.join('\r\n') },
      { name: 'lote.json', data: JSON.stringify({ models: report, plates }, null, 2) });
    interrupted(signal);
    return { files, models: report.map((m, i) => ({ ...m, project: models[i].project })), plates: plates.length,
      plateFiles: files.filter(f => f.name.startsWith('Placa_')).map(f => f.name) };
  } finally { models.forEach(m => m.parts.forEach(p => p.geometry.dispose())); }
}
