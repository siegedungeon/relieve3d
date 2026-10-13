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
