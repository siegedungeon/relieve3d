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
  decoration: 'none',
  decorationColor: '#f28bb4',
  decorationSize: 14,
  decorationGap: 2,
});

export const DECORATIONS = {
  ribbon: { width: 72, height: 94, path: 'M36 0 C12 0 8 19 20 40 L0 82 L20 94 L36 64 L52 94 L72 82 L52 40 C64 19 60 0 36 0 Z M36 39 C24 21 23 15 36 15 C49 15 48 21 36 39 Z' },
  heart: { width: 100, height: 90, path: 'M50 90 C38 78 0 52 0 27 C0 -3 36 -9 50 16 C64 -9 100 -3 100 27 C100 52 62 78 50 90 Z' },
  star: { width: 100, height: 96, path: 'M50 0 L62 34 L100 36 L70 59 L80 96 L50 75 L20 96 L30 59 L0 36 L38 34 Z' },
};
export const decorationWidthMM = t => DECORATIONS[t.decoration] ? t.decorationSize * DECORATIONS[t.decoration].width / DECORATIONS[t.decoration].height : 0;

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
  const deco = DECORATIONS[t.decoration], decoWMM = decorationWidthMM(t);
  const gapMM = deco ? t.decorationGap : 0;
  if (deco && (!Number.isFinite(t.decorationSize) || t.decorationSize < 6 || !Number.isFinite(gapMM) || gapMM < 0.8)) {
    throw new Error('El adorno necesita al menos 6 mm de alto y 0.8 mm de separación.');
  }
  if (deco && widthMM - 2 * borderMM - decoWMM - gapMM < 10) throw new Error('Aumenta el ancho del diseño o reduce el adorno: no queda espacio para el nombre.');
  const pxPerMM = textW / Math.max(1, widthMM - 2 * borderMM - decoWMM - gapMM);
  const th = thMM * pxPerMM, ol = olMM * pxPerMM;
  const pad = Math.ceil(th + ol + 16);
  const textH = asc + desc + lineStep * (lines.length - 1), decoH = deco ? t.decorationSize * pxPerMM : 0;
  const artworkH = Math.max(textH, decoH);
  c.width = Math.ceil(textW + (decoWMM + gapMM) * pxPerMM + pad * 2);
  c.height = Math.ceil(artworkH + pad * 2);
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
      const x = xFor(i), y = pad + (artworkH - textH) / 2 + asc + i * lineStep;
      if (grow > 0) { ctx.lineWidth = grow * 2; ctx.strokeText(l, x, y); }
      ctx.fillText(l, x, y);
    });
  };
  const colors = [];
  if (ol > 0) { pass(t.outlineColor, th + ol); colors.push(t.outlineColor); }
  pass(t.fill, th);
  colors.push(t.fill);
  if (deco) {
    ctx.save();
    ctx.translate(pad + textW + th + ol + gapMM * pxPerMM, pad + (artworkH - decoH) / 2);
    ctx.scale(decoH / deco.height, decoH / deco.height);
    ctx.fillStyle = t.decorationColor;
    ctx.fill(new Path2D(deco.path), 'evenodd');
    ctx.restore();
    colors.push(t.decorationColor);
  }
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
