import { drawing, drawShape } from './setting_diagrams.js';

const fmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });

export function paintTreeDimensions(canvas, config, result, activeKey) {
  const d = drawing(canvas);
  const { ink, blue, warm, fill, text, arrow, line, polygon, rect } = d;
  const measure = (key, x0, y0, x1, y1) => arrow(x0, y0, x1, y1, key === activeKey ? warm : blue);
  const front = 76, side = 174, floor = 111, top = 25;
  text('Frente', front, 11, 10);
  text('Perfil', side, 11, 10);
  line([[137, 13], [137, 143]], blue, 0.8, [2, 3]);

  const hLimit = Math.max(1, config.maxHeight || 1), wLimit = Math.max(1, config.maxWidth || 1);
  const schematicScale = Math.min(96 / Math.max(wLimit, result?.width || 0), (floor - top) / Math.max(hLimit, result?.height || 0));
  const boundaryW = wLimit * schematicScale, boundaryH = hLimit * schematicScale;
  const left = front - boundaryW / 2, right = front + boundaryW / 2, high = floor - boundaryH;
  line([[left, floor], [left, high], [right, high], [right, floor], [left, floor]], blue, 1, [2, 3]);
  if (result) {
    const pieces = [
      { width: result.trunk.width, height: result.trunk.height, bottom: 0 },
      ...result.levels, result.top,
    ];
    pieces.forEach((piece, index) => {
      const w = piece.width * schematicScale, h = Math.max(2, piece.height * schematicScale);
      const y = floor - piece.bottom * schematicScale - h;
      if (index === pieces.length - 1) drawShape(d, result.top.shape, front, y + h / 2, Math.min(w, h) * 0.51);
      else rect(front - w / 2, y, w, Math.max(1, h - 1), fill, ink, 1);
    });
  } else {
    for (let i = 0; i < 3; i++) {
      const w = boundaryW * (0.78 - i * 0.18);
      rect(front - w / 2, floor - 18 - i * 9, w, 7, fill, ink, 1);
    }
    rect(front - 9, floor - 9, 18, 8, fill, ink, 1);
    drawShape(d, config.shape, front, floor - 42, 10);
  }
  measure('maxHeight', left - 6, high, left - 6, floor);
  measure('maxWidth', left, 120, right, 120);
  text(`${fmt.format(wLimit)} mm máx.`, front, 135, 9, blue);
  text(`${fmt.format(hLimit)} mm máx.`, front, Math.max(17, high - 6), 8.5, blue);

  const bottom = Math.max(0.1, config.bottomDepth || 1), tip = Math.max(0.1, config.topDepth || 1);
  const profileScale = Math.min(40 / Math.max(bottom, tip), 4);
  const a = Math.max(2, tip * profileScale / 2), b = Math.max(2, bottom * profileScale / 2);
  polygon([[side - a, top + 9], [side + a, top + 9], [side + b, floor], [side - b, floor]]);
  line([[side, top + 9], [side, floor]], blue, 1, [3, 3]);
  measure('topDepth', side - a, top + 3, side + a, top + 3);
  measure('bottomDepth', side - b, 120, side + b, 120);
  text(`${fmt.format(tip)} mm`, side, top - 4, 8.5, blue);
  text(`${fmt.format(bottom)} mm`, side, 135, 9, blue);
}

export function paintTreeChoice(key, canvas, value) {
  const d = drawing(canvas);
  const { fill, blue, warm, rect, text, arrow, line } = d;
  if (key === 'shape') drawShape(d, value, 56, 36, 24);
  else if (key === 'trunk') {
    rect(21, 19, 70, 11);
    rect(37, 30, 38, 24);
    if (value === 'text') text('2026', 56, 41, 10);
    line([[36, 56], [76, 56]], blue, 1.6);
  } else if (key === 'order') {
    const widths = value === 'auto' ? [25, 42, 57] : [34, 53, 39];
    widths.forEach((w, i) => {
      rect(56 - w / 2, 16 + i * 15, w, 9, i === 2 ? warm : fill);
      if (value === 'manual') text(String(3 - i), 22, 20 + i * 15, 9);
    });
    arrow(92, 55, 92, 17, blue, false);
  } else {
    rect(26, 25, 60, 22);
    line([[20, 52], [92, 52]], blue, 2);
    line([[31, 46], [81, 46]], warm, 2.5);
    text('Aa', 56, value === 'front' ? 38 : 17, 12, value === 'front' ? warm : blue);
  }
}
