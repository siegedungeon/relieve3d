// Mic body: every preset must be watertight (each edge shared by exactly 2 triangles, opposite directions) and fit its cavity.
import { BODY_PRESETS, buildParametricBody, parseSTL, autoOrient, placeCustomBody } from '../src/core/micbody.js';
import { readFileSync, existsSync } from 'node:fs';

function check(pos) {
  const key = new Map(), id = (i) => { const k = `${pos[i].toFixed(4)},${pos[i + 1].toFixed(4)},${pos[i + 2].toFixed(4)}`; if (!key.has(k)) key.set(k, key.size); return key.get(k); };
  const E = new Map();
  let degenerate = 0, vol = 0;
  for (let t = 0; t < pos.length; t += 9) {
    const v = [id(t), id(t + 3), id(t + 6)];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) { degenerate++; continue; }
    for (let k = 0; k < 3; k++) { const a = v[k], b = v[(k + 1) % 3]; const e = a < b ? `${a}_${b}` : `${b}_${a}`; E.set(e, (E.get(e) || 0) + (a < b ? 1 : 100)); }
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = pos.slice(t, t + 9);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  let bad = 0;
  for (const n of E.values()) if (n !== 101) bad++;
  return { bad, degenerate, vol };
}

let fail = 0;
for (const [k, p] of Object.entries(BODY_PRESETS)) {
  for (const variant of [{}, { gap: 0 }, { clipT: 0 }, { side: { enabled: true, outer: 16, inner: 12, height: 2 } }]) {
    const b = { ...p, ...variant, points: p.points ?? 5, inner: p.inner ?? 0.62 };
    const r = buildParametricBody(b);
    const c = check(r.body);
    const rc = r.rings ? check(r.rings) : null;
    const ok = c.bad === 0 && c.vol > 0 && (!rc || (rc.bad === 0 && rc.vol > 0));
    const hasCavity = !r.warnings.some((w) => w.includes('no cabe') || w.includes('más profundo'));
    if (!ok || (!hasCavity && !variant.side)) fail++;
    console.log(k.padEnd(8), JSON.stringify(variant).padEnd(55), `bad=${c.bad} deg=${c.degenerate} vol=${(c.vol / 1000).toFixed(1)}cm3`, rc ? `rings bad=${rc.bad}` : '', r.warnings.join(' | '));
  }
}
const stl = 'C:\\Users\\pabon\\Downloads\\Microfono Cuadrado.stl';
if (existsSync(stl)) {
  const pos = parseSTL(readFileSync(stl));
  const rot = autoOrient(pos);
  const pl = placeCustomBody(pos, rot);
  console.log('custom STL', pos.length / 9, 'tris, rot', rot, 'size', pl.size.map((v) => v.toFixed(1)).join('×'));
  if (Math.abs(pl.size[2] - 40.26) > 0.5) { console.log('unexpected orientation'); fail++; }
}
if (fail) { console.log('micbody FAILED', fail); process.exit(1); }
console.log('micbody OK');
