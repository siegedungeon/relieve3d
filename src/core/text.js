// Renders text to a flat-colour image that feeds the normal vectorization pipeline (3D modules with names/text).
export const BUNDLED_FONTS = [
  { family: 'Lilita One', file: 'LilitaOne-Regular.ttf', cat: 'Gruesas (recomendadas para 3D)' },
  { family: 'Titan One', file: 'TitanOne-Regular.ttf', cat: 'Gruesas (recomendadas para 3D)' },
  { family: 'Luckiest Guy', file: 'LuckiestGuy-Regular.ttf', cat: 'Gruesas (recomendadas para 3D)' },
  { family: 'Fredoka', file: 'Fredoka.ttf', cat: 'Gruesas (recomendadas para 3D)', variable: true },
  { family: 'Baloo 2', file: 'Baloo2.ttf', cat: 'Gruesas (recomendadas para 3D)', variable: true },
  { family: 'Poppins Black', file: 'Poppins-Black.ttf', cat: 'Gruesas (recomendadas para 3D)' },
  { family: 'Rubik Bubbles', file: 'RubikBubbles-Regular.ttf', cat: 'Gruesas (recomendadas para 3D)' },
  { family: 'Modak', file: 'Modak-Regular.ttf', cat: 'Gruesas (recomendadas para 3D)' },
  { family: 'Sniglet', file: 'Sniglet-ExtraBold.ttf', cat: 'Gruesas (recomendadas para 3D)' },
  { family: 'Chewy', file: 'Chewy-Regular.ttf', cat: 'Divertidas' },
  { family: 'Bangers', file: 'Bangers-Regular.ttf', cat: 'Divertidas' },
  { family: 'Concert One', file: 'ConcertOne-Regular.ttf', cat: 'Divertidas' },
  { family: 'Carter One', file: 'CarterOne.ttf', cat: 'Divertidas' },
  { family: 'Bebas Neue', file: 'BebasNeue-Regular.ttf', cat: 'Divertidas' },
  { family: 'Pacifico', file: 'Pacifico-Regular.ttf', cat: 'Cursivas (letras unidas)' },
  { family: 'Lobster', file: 'Lobster-Regular.ttf', cat: 'Cursivas (letras unidas)' },
  { family: 'Dancing Script', file: 'DancingScript.ttf', cat: 'Cursivas (letras unidas)', variable: true },
  { family: 'Grand Hotel', file: 'GrandHotel-Regular.ttf', cat: 'Cursivas (letras unidas)' },
  { family: 'Kaushan Script', file: 'KaushanScript-Regular.ttf', cat: 'Cursivas (letras unidas)' },
  { family: 'Permanent Marker', file: 'PermanentMarker-Regular.ttf', cat: 'Cursivas (letras unidas)' },
  { family: 'Great Vibes', file: 'GreatVibes-Regular.ttf', cat: 'Cursivas (letras unidas)' },
  { family: 'Alex Brush', file: 'AlexBrush-Regular.ttf', cat: 'Cursivas (letras unidas)' },
];

export const DEFAULT_TEXT = () => ({
  text: 'Sofía',
  font: 'Pacifico',
  weight: 700,
  italic: false,
  spacing: 0,          // letter spacing, % of font size
  lineHeight: 1.05,
  align: 'center',
  fill: '#e11d48',
  thicken: 0,          // mm added around each letter (same colour)
  outline: true,
  outlineColor: '#ffffff',
  outlineMM: 1.6,      // mm coloured border around the letters
  baseColor: '#1f2937',
});

const loaded = new Map();
export async function ensureFont(family, weight = 400) {
  const b = BUNDLED_FONTS.find((f) => f.family === family);
  if (b && !loaded.has(family)) {
    const ff = new FontFace(family, `url(fonts/${b.file})`, b.variable ? { weight: '100 900' } : {});
    loaded.set(family, ff.load().then((f) => { document.fonts.add(f); }).catch((e) => console.warn('font', family, e)));
  }
  if (loaded.has(family)) await loaded.get(family);
  try { await document.fonts.load(`${weight} 80px "${family}"`); } catch { /* system font */ }
}

const FONT_PX = 220;
const hexRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// widthMM: final design width; used to convert mm borders into pixels. Returns { dataURL, colors, width, height }.
export function renderTextImage(t, widthMM) {
  const lines = String(t.text || ' ').split(/\r?\n/);
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const font = `${t.italic ? 'italic ' : ''}${t.weight || 400} ${FONT_PX}px "${t.font}", sans-serif`;
  const setup = () => {
    ctx.font = font;
    ctx.letterSpacing = `${((t.spacing || 0) / 100) * FONT_PX}px`;
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  };
  setup();
  const ms = lines.map((l) => ctx.measureText(l || ' '));
  const asc = Math.max(...ms.map((m) => m.actualBoundingBoxAscent), FONT_PX * 0.5);
  const desc = Math.max(...ms.map((m) => m.actualBoundingBoxDescent), 0);
  const lw = ms.map((m) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
  const textW = Math.max(...lw, 10);
  const lineStep = FONT_PX * (t.lineHeight || 1.05);
  // mm → px: total width (text + borders) maps to widthMM
  const thMM = Math.max(0, t.thicken || 0), olMM = t.outline ? Math.max(0, t.outlineMM || 0) : 0;
  const borderMM = thMM + olMM;
  const pxPerMM = textW / Math.max(1, widthMM - 2 * borderMM);
  const th = thMM * pxPerMM, ol = olMM * pxPerMM;
  const pad = Math.ceil(th + ol + 16);
  c.width = Math.ceil(textW + pad * 2);
  c.height = Math.ceil(asc + desc + lineStep * (lines.length - 1) + pad * 2);
  setup();
  const xFor = (i) => {
    const m = ms[i];
    if (t.align === 'left') return pad + m.actualBoundingBoxLeft;
    if (t.align === 'right') return pad + textW - m.actualBoundingBoxRight;
    return pad + (textW - lw[i]) / 2 + m.actualBoundingBoxLeft;
  };
  const pass = (color, grow) => {
    ctx.fillStyle = color; ctx.strokeStyle = color;
    lines.forEach((l, i) => {
      const x = xFor(i), y = pad + asc + i * lineStep;
      if (grow > 0) { ctx.lineWidth = grow * 2; ctx.strokeText(l, x, y); }
      ctx.fillText(l, x, y);
    });
  };
  const colors = [];
  if (ol > 0) { pass(t.outlineColor, th + ol); colors.push(t.outlineColor); }
  pass(t.fill, th);
  colors.push(t.fill);
  // snap to flat colours with hard alpha so the vectorizer gets exact regions
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
  const pal = [...new Set(colors)].map(hexRGB);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 110) { d[i + 3] = 0; continue; }
    let best = 0, bd = Infinity;
    for (let k = 0; k < pal.length; k++) {
      const dr = d[i] - pal[k][0], dg = d[i + 1] - pal[k][1], db = d[i + 2] - pal[k][2];
      const dd = dr * dr + dg * dg + db * db;
      if (dd < bd) { bd = dd; best = k; }
    }
    d[i] = pal[best][0]; d[i + 1] = pal[best][1]; d[i + 2] = pal[best][2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { dataURL: c.toDataURL('image/png'), colors: pal.length, width: c.width, height: c.height };
}
