// Synthetic multicolor 3MF: white sphere with a pink stripe around it (|z| < 6) and a pink bottom cap,
// plus a green block sunk 6 mm into its top. Used by the color separation unit test and E2E.
import { zipSync, strToU8 } from 'fflate';

function icosphere(r, sub) {
  const t = (1 + Math.sqrt(5)) / 2;
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const nrm = (p) => { const l = Math.hypot(...p); return p.map((x) => x / l); };
  V = V.map(nrm);
  for (let s = 0; s < sub; s++) {
    const mid = new Map(), F2 = [];
    const m = (a, b) => { const k = a < b ? a + ',' + b : b + ',' + a; if (!mid.has(k)) { V.push(nrm(V[a].map((x, i) => (x + V[b][i]) / 2))); mid.set(k, V.length - 1); } return mid.get(k); };
    for (const [a, b, c] of F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); F2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    F = F2;
  }
  return { V: V.map((p) => p.map((x) => x * r)), F };
}
function box(c, s) {
  const V = [];
  for (let i = 0; i < 8; i++) V.push([c[0] + (i & 1 ? s[0] : -s[0]) / 2, c[1] + (i & 2 ? s[1] : -s[1]) / 2, c[2] + (i & 4 ? s[2] : -s[2]) / 2]);
  const F = [[0, 2, 3], [0, 3, 1], [4, 5, 7], [4, 7, 6], [0, 1, 5], [0, 5, 4], [2, 6, 7], [2, 7, 3], [0, 4, 6], [0, 6, 2], [1, 3, 7], [1, 7, 5]];
  return { V, F };
}

export function paintedSphere3MF() {
  const sph = icosphere(20, 4);
  const blk = box([0, 0, 24], [14, 10, 12]); // green block sinking 6 mm into the top of the sphere
  const paint = (f) => { const z = f.reduce((a, i) => a + sph.V[i][2], 0) / 3; return Math.abs(z) < 6 || z < -16 ? 1 : 0; };
  const meshXML = (m, attrs) => `<mesh><vertices>${m.V.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices><triangles>${m.F.map((f, i) => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"${attrs(f, i)}/>`).join('')}</triangles></mesh>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>
<basematerials id="1"><base name="Blanco" displaycolor="#F4F4F4"/><base name="Rosa" displaycolor="#E8AFCF"/><base name="Verde" displaycolor="#8ADFBD"/></basematerials>
<object id="2" type="model" pid="1" pindex="0">${meshXML(sph, (f) => ` pid="1" p1="${paint(f)}"`)}</object>
<object id="3" type="model" pid="1" pindex="2">${meshXML(blk, () => '')}</object>
</resources>
<build><item objectid="2"/><item objectid="3"/></build>
</model>`;
  return zipSync({ '3D/3dmodel.model': strToU8(xml), '[Content_Types].xml': strToU8('<Types/>') });
}

// White 40×30×20 box (2 mm grid) whose whole top face is pink: the colour border runs exactly along a sharp edge.
export function paintedBox3MF() {
  const V = [], F = [], P = [], idx = new Map();
  const S = [40, 30, 20], g = 2;
  const vid = (p) => { const k = p.map((x) => x.toFixed(3)).join(','); if (!idx.has(k)) { idx.set(k, V.length); V.push(p); } return idx.get(k); };
  for (let ax = 0; ax < 3; ax++) for (const side of [0, 1]) {
    const u = (ax + 1) % 3, v = (ax + 2) % 3, nu = S[u] / g, nv = S[v] / g;
    const pt = (i, j) => { const p = [0, 0, 0]; p[ax] = side * S[ax]; p[u] = i * g; p[v] = j * g; return vid(p); };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      if (side) F.push([a, b, c], [a, c, d]); else F.push([a, c, b], [a, d, c]);
      P.push(ax === 2 && side ? 1 : 0, ax === 2 && side ? 1 : 0);
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>
<basematerials id="1"><base name="Blanco" displaycolor="#F4F4F4"/><base name="Rosa" displaycolor="#E8AFCF"/></basematerials>
<object id="2" type="model" pid="1" pindex="0"><mesh><vertices>${V.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices><triangles>${F.map((f, i) => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}" pid="1" p1="${P[i]}"/>`).join('')}</triangles></mesh></object>
</resources>
<build><item objectid="2"/></build>
</model>`;
  return zipSync({ '3D/3dmodel.model': strToU8(xml), '[Content_Types].xml': strToU8('<Types/>') });
}

// White 45 deg wedge (prism 20x20 in xz, 30 long in y, 0.25 x 1 mm grid) whose sloped face is pink: the paint runs out to a
// knife edge at x = 0 (the far face there is the white bottom, at 45 deg - not a parallel thin wall).
export function paintedWedge3MF() {
  const V = [], F = [], P = [], idx = new Map(), L = 30, n = 80, g = 0.25;
  const vid = (p) => { const k = p.map((x) => x.toFixed(3)).join(','); if (!idx.has(k)) { idx.set(k, V.length); V.push(p); } return idx.get(k); };
  const tri = (a, b, c, out, pink) => {
    const [A, B, C] = [V[a], V[b], V[c]];
    const u = B.map((x, i) => x - A[i]), v = C.map((x, i) => x - A[i]);
    const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    F.push(nn[0] * out[0] + nn[1] * out[1] + nn[2] * out[2] > 0 ? [a, b, c] : [a, c, b]); P.push(pink);
  };
  const rect = (pt, nu, nv, out, pink) => { for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1); tri(a, b, c, out, pink); tri(a, c, d, out, pink); } };
  rect((i, j) => vid([i * g, j, 0]), n, L, [0, 0, -1], 0);
  rect((i, j) => vid([n * g, j, i * g]), n, L, [1, 0, 0], 0);
  rect((i, j) => vid([i * g, j, i * g]), n, L, [-1, 0, 1], 1);
  for (const y of [0, L]) for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    const out = [0, y ? 1 : -1, 0];
    tri(vid([i * g, y, j * g]), vid([(i + 1) * g, y, j * g]), vid([(i + 1) * g, y, (j + 1) * g]), out, 0);
    if (j < i) tri(vid([i * g, y, j * g]), vid([(i + 1) * g, y, (j + 1) * g]), vid([i * g, y, (j + 1) * g]), out, 0);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>
<basematerials id="1"><base name="Blanco" displaycolor="#F4F4F4"/><base name="Rosa" displaycolor="#E8AFCF"/></basematerials>
<object id="2" type="model" pid="1" pindex="0"><mesh><vertices>${V.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices><triangles>${F.map((f, i) => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}" pid="1" p1="${P[i]}"/>`).join('')}</triangles></mesh></object>
</resources>
<build><item objectid="2"/></build>
</model>`;
  return zipSync({ '3D/3dmodel.model': strToU8(xml), '[Content_Types].xml': strToU8('<Types/>') });
}

// White 40x30x10 base with a green ball (r 8) barely touching it (sunk 0.5 mm, like a bow's knot over the head): the base holds
// the ball's core, and the ball's single cover has to lift off its round core.
export function paintedFloatingBall3MF() {
  const base = box([0, 0, 5], [40, 30, 10]), ball = icosphere(8, 3);
  ball.V = ball.V.map(([x, y, z]) => [x, y, z + 17.5]);
  const meshXML = (m) => `<mesh><vertices>${m.V.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices><triangles>${m.F.map((f) => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"/>`).join('')}</triangles></mesh>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>
<basematerials id="1"><base name="Blanco" displaycolor="#F4F4F4"/><base name="Verde" displaycolor="#8ADFBD"/></basematerials>
<object id="2" type="model" pid="1" pindex="0">${meshXML(base)}</object>
<object id="3" type="model" pid="1" pindex="1">${meshXML(ball)}</object>
</resources>
<build><item objectid="2"/><item objectid="3"/></build>
</model>`;
  return zipSync({ '3D/3dmodel.model': strToU8(xml), '[Content_Types].xml': strToU8('<Types/>') });
}

// Hollow white sphere (outer r 20, wall ~2.2 mm) with an irregular mesh (vertices jittered along the surface: slivers, noisy
// normals and wall thickness, like a real exported model) and a pink band |z| < 6: the cover floors must stay smooth.
export function paintedRoughShell3MF() {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = icosphere(20, 4), inn = icosphere(17.8, 3);
  out.V = out.V.map((p) => { const q = p.map((x) => x + (rnd() - 0.5) * 2.4); const l = Math.hypot(...q); return q.map((x) => (x / l) * 20); });
  inn.V = inn.V.map((p) => { const k = (17.8 + (rnd() - 0.5)) / Math.hypot(...p); return p.map((x) => x * k); });
  const V = [...out.V, ...inn.V], F = [...out.F, ...inn.F.map(([a, b, c]) => [a + out.V.length, c + out.V.length, b + out.V.length])];
  const paint = (f, i) => { const z = f.reduce((a, j) => a + V[j][2], 0) / 3; return i < out.F.length && Math.abs(z) < 6 ? 1 : 0; };
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>
<basematerials id="1"><base name="Blanco" displaycolor="#F4F4F4"/><base name="Rosa" displaycolor="#E8AFCF"/></basematerials>
<object id="2" type="model" pid="1" pindex="0"><mesh><vertices>${V.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices><triangles>${F.map((f, i) => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}" pid="1" p1="${paint(f, i)}"/>`).join('')}</triangles></mesh></object>
</resources>
<build><item objectid="2"/></build>
</model>`;
  return zipSync({ '3D/3dmodel.model': strToU8(xml), '[Content_Types].xml': strToU8('<Types/>') });
}

// White 40x30x10 base with a thin green wing (ellipsoid 28 x 6.4 x 20, turned 29 deg) standing on it, like a bow's loop:
// its base-colour core is a thin plate whose outline must not follow the voxel grid (staircase).
export function paintedWing3MF() {
  const base = box([0, 0, 5], [40, 30, 10]), wing = icosphere(1, 4), ca = Math.cos(0.5), sa = Math.sin(0.5);
  wing.V = wing.V.map(([x, y, z]) => [x * 14 * ca - y * 3.2 * sa, x * 14 * sa + y * 3.2 * ca, z * 10 + 19.5]);
  const meshXML = (m) => `<mesh><vertices>${m.V.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices><triangles>${m.F.map((f) => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"/>`).join('')}</triangles></mesh>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>
<basematerials id="1"><base name="Blanco" displaycolor="#F4F4F4"/><base name="Verde" displaycolor="#8ADFBD"/></basematerials>
<object id="2" type="model" pid="1" pindex="0">${meshXML(base)}</object>
<object id="3" type="model" pid="1" pindex="1">${meshXML(wing)}</object>
</resources>
<build><item objectid="2"/><item objectid="3"/></build>
</model>`;
  return zipSync({ '3D/3dmodel.model': strToU8(xml), '[Content_Types].xml': strToU8('<Types/>') });
}
