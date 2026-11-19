export const SETTING_ICONS = {
  width: '↔', height: '↕', thickness: '≋', depth: '⇣', diameter: '⌀', radius: '◜', wall: '▣', edge: '▧',
  spacing: '⇔', margin: '⊡', fit: '⊣', move: '✥', angle: '↻', scale: '⤢', quantity: '#',
  layer: '▱', finish: '◒', shape: '◇', color: '◉', image: '▧', toggle: '◐', option: '≡', text: 'Aa',
  time: '◷', money: '$', weight: '⚖', percent: '%', calendar: '▦', chart: '▥',
};

export function drawing(canvas) {
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(canvas);
  const ink = css.getPropertyValue('--text').trim();
  const blue = css.getPropertyValue('--guide-accent').trim();
  const fill = css.getPropertyValue('--guide-fill').trim();
  const warm = css.getPropertyValue('--guide-warm').trim();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(2, 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const line = (points, color = ink, width = 1.4, dash = []) => {
    ctx.beginPath();
    ctx.setLineDash(dash);
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const polygon = (points, paint = fill, color = ink) => {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.closePath();
    ctx.fillStyle = paint;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  };
  const rect = (x, y, w, h, color = fill, stroke = ink, radius = 4) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  };
  const circle = (x, y, r, color = fill, stroke = ink) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  };
  const arrow = (x0, y0, x1, y1, color = blue, both = true) => {
    const angle = Math.atan2(y1 - y0, x1 - x0);
    line([[x0, y0], [x1, y1]], color, 1.5);
    const tip = (x, y, a) => line([[x - 4 * Math.cos(a - 0.55), y - 4 * Math.sin(a - 0.55)], [x, y],
      [x - 4 * Math.cos(a + 0.55), y - 4 * Math.sin(a + 0.55)]], color, 1.5);
    tip(x1, y1, angle);
    if (both) tip(x0, y0, angle + Math.PI);
  };
  const text = (value, x, y, size = 10, color = ink, align = 'center') => {
    ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  };
  return { ctx, ink, blue, fill, warm, line, polygon, rect, circle, arrow, text };
}

export function drawShape(d, shape, x, y, r) {
  if (shape === 'star') {
    d.polygon(Array.from({ length: 10 }, (_, i) => {
      const a = (i / 5 - 0.5) * Math.PI, size = i % 2 ? r * 0.49 : r;
      return [x + Math.cos(a) * size, y + Math.sin(a) * size];
    }));
  } else if (shape === 'heart') {
    const { ctx, ink, fill } = d;
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.85);
    ctx.bezierCurveTo(x - r * 1.7, y - r * 0.1, x - r * 0.8, y - r * 1.55, x, y - r * 0.57);
    ctx.bezierCurveTo(x + r * 0.8, y - r * 1.55, x + r * 1.7, y - r * 0.1, x, y + r * 0.85);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  } else if (shape === 'circle') d.circle(x, y, r * 0.82);
  else if (shape === 'hexagon' || shape === 'octagon') {
    const sides = shape === 'hexagon' ? 6 : 8;
    d.polygon(Array.from({ length: sides }, (_, i) => {
      const angle = (i * 2 - 0.5) * Math.PI / sides;
      return [x + r * Math.cos(angle), y + r * Math.sin(angle)];
    }));
  } else if (shape === 'shield' || shape === 'badge') {
    const tip = shape === 'shield' ? 1 : 0.65;
    d.polygon([[x - r, y - r * 0.7], [x + r, y - r * 0.7], [x + r * 0.92, y + r * 0.3],
      [x, y + r * tip], [x - r * 0.92, y + r * 0.3]]);
  } else if (shape === 'cloud' || shape === 'contour') {
    d.rect(x - r, y - r * 0.2, r * 2, r, d.fill, d.ink, r * 0.43);
    d.circle(x - r * 0.28, y - r * 0.15, r * 0.54, d.fill, d.fill);
    d.circle(x + r * 0.38, y - r * 0.2, r * 0.46, d.fill, d.fill);
    if (shape === 'contour') d.text('Aa', x, y + r * 0.31, r * 0.62);
  } else if (shape === 'speech') {
    d.rect(x - r, y - r * 0.77, r * 2, r * 1.48);
    d.polygon([[x - r * 0.57, y + r * 0.65], [x - r * 0.2, y + r * 0.66], [x - r * 0.64, y + r]], d.fill);
  }
  else if (shape === 'custom') {
    d.rect(x - r, y - r * 0.8, r * 2, r * 1.6);
    d.polygon([[x - r * 0.65, y + r * 0.42], [x - r * 0.2, y - r * 0.2], [x + r * 0.12, y + r * 0.12],
      [x + r * 0.4, y - r * 0.14], [x + r * 0.65, y + r * 0.42]], d.blue);
  } else if (shape === 'tree') d.polygon([[x, y - r], [x + r, y + r], [x - r, y + r]]);
  else d.rect(x - r, y - r * 0.78, r * 2, r * 1.56, d.fill, d.ink, shape === 'square' ? 2 : 5);
}

export function drawSettingDiagram(canvas, type, value = '') {
  const d = drawing(canvas);
  const { ctx, ink, blue, fill, warm, line, polygon, rect, circle, arrow, text } = d;
  const surface = getComputedStyle(canvas).getPropertyValue('--panel').trim();
  const plate = () => rect(22, 19, 68, 36);
  switch (type) {
    case 'width':
    case 'height':
      plate();
      if (type === 'width') {
        line([[22, 57], [22, 66]], blue); line([[90, 57], [90, 66]], blue); arrow(22, 63, 90, 63);
      } else {
        line([[92, 19], [103, 19]], blue); line([[92, 55], [103, 55]], blue); arrow(100, 19, 100, 55);
      }
      break;
    case 'thickness':
    case 'depth':
    case 'layer':
    case 'finish': {
      const y = type === 'depth' || value === 'engrave' ? 41 : value === 'flat' || value === 'flush' ? 32 : 23;
      polygon([[21, 32], [45, 32], [45, y], [67, y], [67, 32], [91, 32], [91, 55], [21, 55]]);
      if (type === 'layer') for (const level of [40, 47]) line([[24, level], [88, level]], blue, 1, [3, 2]);
      if (type === 'finish') line([[45, y], [67, y]], warm, 3);
      else if (type === 'depth') arrow(56, 29, 56, 45);
      else arrow(99, 32, 99, 55);
      break;
    }
    case 'diameter':
    case 'radius':
    case 'wall':
      circle(56, 36, 26);
      circle(56, 36, 16, surface);
      if (type === 'diameter') arrow(40, 36, 72, 36);
      else if (type === 'radius') arrow(56, 36, 70, 27, blue, false);
      else arrow(72, 36, 82, 36);
      break;
    case 'spacing':
    case 'margin':
    case 'fit':
      if (type === 'margin') {
        rect(15, 12, 82, 48, 'transparent'); rect(30, 23, 52, 26); arrow(15, 35, 30, 35);
      } else {
        rect(15, 20, 28, 32); rect(69, 20, 28, 32); arrow(44, 36, 68, 36);
        if (type === 'fit') { rect(28, 30, 16, 12, warm); rect(69, 28, 16, 16, surface); }
      }
      break;
    case 'edge':
      polygon([[17, 49], [17, 28], [24, 20], [87, 20], [95, 28], [95, 49]]);
      line([[17, 28], [24, 20], [37, 20]], warm, 3);
      line([[75, 20], [87, 20], [95, 28]], warm, 3);
      break;
    case 'scale':
      rect(22, 15, 67, 45, 'transparent', blue); rect(35, 23, 41, 29);
      arrow(37, 25, 23, 16, blue, false); arrow(75, 52, 88, 59, blue, false);
      break;
    case 'move': {
      rect(27, 11, 58, 50, 'transparent', blue);
      const x = value === 'left' ? 37 : value === 'right' ? 75 : 56;
      const y = value === 'top' ? 19 : value === 'bottom' ? 53 : 36;
      circle(x, y, 5, warm);
      arrow(15, 36, 97, 36); arrow(56, 10, 56, 62);
      break;
    }
    case 'side': {
      rect(30, 17, 52, 38);
      const [x, y] = { top: [56, 12], bottom: [56, 60], left: [25, 36], right: [87, 36] }[value] || [56, 36];
      circle(x, y, 6, warm); circle(x, y, 2.5, surface);
      break;
    }
    case 'ring':
      if (value === 'slot') { rect(20, 20, 72, 32, fill, ink, 15); rect(29, 29, 54, 14, surface, ink, 7); }
      else { circle(56, 36, 24); circle(56, 36, 13, surface); }
      break;
    case 'background':
      rect(20, 13, 72, 46, value === 'no' ? fill : surface, blue);
      for (let i = 0; i < 7 && value !== 'no'; i++) {
        for (let j = i % 2; j < 4; j += 2) rect(25 + i * 9, 18 + j * 9, 9, 9, fill, fill, 0);
      }
      circle(56, 36, 13, warm);
      if (value === 'auto') text('A', 56, 36, 13);
      break;
    case 'coloring':
      rect(19, 12, 74, 48, surface);
      circle(72, 25, 7, value === 'regions' ? warm : surface);
      polygon([[25, 54], [44, 31], [56, 45], [68, 37], [86, 54]], value === 'regions' ? fill : surface);
      if (value === 'regions') line([[44, 31], [51, 53]], blue);
      break;
    case 'layout':
      rect(19, 13, 74, 46, surface);
      for (let i = 0; i < (value === 'fill' ? 8 : 3); i++) rect(25 + i % 4 * 16, 20 + Math.floor(i / 4) * 17, 12, 12, i % 2 ? fill : warm);
      break;
    case 'source':
      if (value === 'mockup') drawShape(d, 'custom', 56, 36, 26);
      else { rect(28, 17, 55, 40); arrow(27, 64, 83, 64); arrow(91, 17, 91, 57); }
      break;
    case 'split':
      rect(25, 31, 62, 26);
      if (value === 'carve') {
        rect(37, 31, 26, 10, warm, ink, 2); line([[35, 44], [68, 44]], blue, 1, [3, 2]);
      } else if (value === 'covers' || value === 'inlays') {
        rect(39, 13, 24, 10, warm, ink, 2);
        if (value === 'inlays') rect(38, 31, 26, 10, surface, ink, 2);
        arrow(52, 24, 52, 34, blue, false);
      } else {
        rect(19, 24, 74, 40, 'transparent', warm, value === 'skin' ? 5 : 15);
      }
      break;
    case 'angle':
      line([[23, 55], [83, 55]], blue, 1.2, [4, 3]);
      polygon([[23, 55], [73, 22], [81, 34], [31, 66]]);
      ctx.beginPath(); ctx.arc(23, 55, 26, -0.57, 0); ctx.strokeStyle = warm; ctx.lineWidth = 2; ctx.stroke();
      break;
    case 'shape':
    case 'image':
      drawShape(d, type === 'image' ? 'custom' : value || 'star', 56, 36, 23);
      break;
    case 'color':
      [/^#[0-9a-f]{6}$/i.test(value) ? value : '#249986', '#4089c4', '#f1a45d']
        .forEach((color, i) => circle(35 + i * 21, 36, 15, color));
      break;
    case 'quantity':
    case 'chart':
      for (let i = 0; i < 3; i++) {
        const h = type === 'quantity' ? 17 : 15 + i * 10;
        rect(23 + i * 25, 53 - h, 18, h, i === 2 ? warm : fill);
      }
      line([[18, 57], [96, 57]], blue);
      break;
    case 'toggle':
      rect(24, 24, 64, 25, value === 'on' ? fill : 'transparent', blue, 12);
      circle(value === 'on' ? 75 : 37, 36.5, 9, warm);
      break;
    case 'calendar':
      rect(26, 15, 60, 45); line([[26, 26], [86, 26]], blue);
      for (const x of [41, 56, 71]) for (const y of [36, 48]) circle(x, y, 2, blue, blue);
      break;
    case 'time':
      circle(56, 36, 24);
      for (const [x, y] of [[56, 17], [75, 36], [56, 55], [37, 36]]) circle(x, y, 1.2, blue, blue);
      line([[56, 23], [56, 36], [66, 43]], ink, 2);
      circle(56, 36, 2.5, warm, ink);
      break;
    case 'weight':
      rect(24, 52, 64, 9, warm);
      line([[56, 51], [56, 16], [29, 23], [83, 23]], ink, 2);
      for (const x of [32, 80]) polygon([[x, 23], [x - 11, 43], [x + 11, 43]]);
      break;
    case 'percent': {
      rect(19, 32, 74, 16, surface);
      const fraction = Math.max(0, Math.min(100, Number(String(value).replace(',', '.')) || 0));
      if (fraction) rect(20, 33, 72 * fraction / 100, 14, fill, fill, 2);
      text('%', 56, 21, 14, blue);
      break;
    }
    case 'money':
      rect(21, 23, 70, 32);
      rect(25, 18, 62, 31, fill, blue);
      circle(56, 33, 11, warm);
      text('$', 56, 33, 13);
      break;
    case 'option':
      for (const [i, y] of [19, 36, 53].entries()) {
        circle(28, y, 4, i === 1 ? warm : surface); line([[39, y], [84, y]], i === 1 ? blue : ink, 2);
      }
      break;
    default:
      rect(27, 16, 58, 40);
      text(SETTING_ICONS[type] || '≡', 56, 34, type === 'text' ? 24 : 27, blue);
      break;
  }
}
