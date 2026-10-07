// Tests for style-preserving thickening (src/core/thicken.js).
import { thickenLabels, strokeWidth, glyphLayout } from '../src/core/thicken.js';
import { components } from '../src/core/raster.js';

let fail = 0;
const ok = (c, msg) => { console.log((c ? '  ok  ' : '  FAIL') + ' ' + msg); if (!c) fail++; };
const make = (W, H, fn) => { const L = new Int16Array(W * H).fill(-1); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = fn(x, y); if (v >= 0) L[y * W + x] = v; } return { L, W, H }; };
const fgOf = (L) => Uint8Array.from(L, (v) => (v >= 0 ? 1 : 0));
const holes = (L, W, H) => { const bg = Uint8Array.from(L, (v) => (v < 0 ? 1 : 0)); return components(bg, W, H, false).comps.filter((c) => c.minX > 0 && c.minY > 0 && c.maxX < W - 1 && c.maxY < H - 1); };
const gapsX = (L, W, H) => { const cs = components(fgOf(L), W, H).comps.sort((a, b) => a.minX - b.minX); return cs.slice(1).map((c, i) => c.minX - cs[i].maxX - 1); };

// "I I I O i": 4 px strokes, 6 px gaps, a ring with a hole and an i with its dot
const word = make(120, 60, (x, y) => {
  for (const x0 of [10, 20, 30]) if (x >= x0 && x < x0 + 4 && y >= 15 && y < 45) return 0;
  const dx = x - 55, dy = y - 30, d = Math.hypot(dx / 1.0, dy / 1.6);
  if (x >= 41 && x <= 69 && d <= 13 && d >= 9) return 1;
  if (x >= 76 && x < 80 && y >= 24 && y < 45) return 0;
  if (x >= 76 && x < 80 && y >= 15 && y < 19) return 0;
  return -1;
});
const lay = glyphLayout(fgOf(word.L), word.W, word.H);
ok(lay.lines.length === 1 && lay.lines[0].glyphs.length === 5, `layout: 1 line, 5 glyphs (got ${lay.lines.length}, ${lay.lines[0]?.glyphs.length})`);
ok(lay.textLike, 'row of letters detected as text');
ok(Math.abs(strokeWidth(word.L, word.W, word.H) - 4) <= 1.2, `stroke ≈ 4 px (got ${strokeWidth(word.L, word.W, word.H).toFixed(2)})`);

const r = 2.5;
const sp = thickenLabels(word.L, word.W, word.H, r, { mode: 'letters' });
const g0 = gapsX(word.L, word.W, word.H), g1 = gapsX(sp.L, sp.W, sp.H);
ok(components(fgOf(sp.L), sp.W, sp.H).comps.length === 6, `letters stay separate (6 parts incl. dot) → ${components(fgOf(sp.L), sp.W, sp.H).comps.length}`);
ok(holes(sp.L, sp.W, sp.H).length === 1, 'the O keeps its hole');
ok(Math.abs(strokeWidth(sp.L, sp.W, sp.H) - (4 + 2 * r)) <= 1.5, `stroke grows by 2r → ${strokeWidth(sp.L, sp.W, sp.H).toFixed(2)}`);
const hg = g1.filter((g) => g > 0);
ok(hg.length >= 4 && hg.every((g) => g >= 4), `horizontal gaps kept (before ${g0.join(',')} after ${g1.join(',')})`);
// centre preserved: centroid of the original maps onto the centroid of the result
const cen = (L, W) => { let sx = 0, n = 0; for (let i = 0; i < L.length; i++) if (L[i] >= 0) { sx += i % W; n++; } return sx / n; };
ok(Math.abs(cen(word.L, word.W) + sp.ox - cen(sp.L, sp.W)) < 2.5, 'stays centred');
// colours preserved
ok([...new Set(sp.L)].sort().join() === '-1,0,1', 'colours preserved');

const inPlace = thickenLabels(word.L, word.W, word.H, 3.5, { mode: 'none' });
ok(components(fgOf(inPlace.L), inPlace.W, inPlace.H).comps.length < 6, 'grow in place: letters may merge (no spreading)');
const noHoles = thickenLabels(word.L, word.W, word.H, 10, { mode: 'letters', keepHoles: false });
const keep = thickenLabels(word.L, word.W, word.H, 10, { mode: 'letters', keepHoles: true });
ok(holes(keep.L, keep.W, keep.H).length === 1, 'big growth: hole protected');
ok(holes(noHoles.L, noHoles.W, noHoles.H).length === 0, 'big growth without protection closes the hole');

// two lines: line gap kept
const two = make(80, 70, (x, y) => ((y >= 10 && y < 28) || (y >= 36 && y < 54)) && [10, 25, 40].some((x0) => x >= x0 && x < x0 + 5) ? 0 : -1);
const t2 = thickenLabels(two.L, two.W, two.H, 3, { mode: 'letters' });
ok(components(fgOf(t2.L), t2.W, t2.H).comps.length === 6, 'two lines: 6 letters stay separate');

// icon (single blob) in auto mode: grows in place, never spread
const icon = make(60, 60, (x, y) => (Math.hypot(x - 30, y - 30) < 18 ? 0 : -1));
const ti = thickenLabels(icon.L, icon.W, icon.H, 3, { mode: 'auto' });
ok(!ti.spread, 'icon is not spread in auto mode');

if (fail) { console.log(`thicken: ${fail} FAILED`); process.exit(1); }
console.log('thicken OK');
