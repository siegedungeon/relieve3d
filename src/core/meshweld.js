// Brush-painted 3MF triangles (Bambu / Orca / Prusa TriangleSelector) are read as loose sub-triangles with vertices of
// their own: every sub-triangle is a separate shell and the neighbours of a subdivided triangle have T-junctions where
// the sub-triangle corners lie on their edges, so the part is no longer a closed surface (no boolean works on it).
// weldPainted() attaches the sub-triangles again: their vertices are merged with the vertices at the same position
// (the original ones keep their own topology) and every triangle with vertices lying on one of its open edges is split
// there (fan around its centroid), so the part is watertight. `tags` (one per triangle: the colour) follow the pieces.

const nxt = (e) => e - (e % 3) + ((e % 3) + 1) % 3;

// V: positions (xyz), T: triangles, tags: one value per triangle, firstExtra: index of the first vertex of the
// sub-triangles (vertices before it are the original mesh and are never merged with each other)
export function weldPainted(V, T, tags, firstExtra = 0) {
  const nV0 = V.length / 3;
  const ids = new Map(), remap = new Uint32Array(nV0), P = [];
  for (let i = 0; i < nV0; i++) {
    const k = `${V[i * 3]},${V[i * 3 + 1]},${V[i * 3 + 2]}`;
    let j = ids.get(k);
    if (j === undefined || i < firstExtra) {
      j = P.length / 3;
      P.push(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]);
      if (!ids.has(k)) ids.set(k, j);
    }
    remap[i] = j;
  }
  let TT = [], tg = [];
  for (let t = 0; t < T.length / 3; t++) {
    const a = remap[T[t * 3]], b = remap[T[t * 3 + 1]], c = remap[T[t * 3 + 2]];
    if (a === b || b === c || a === c) continue;
    TT.push(a, b, c);
    tg.push(tags[t]);
  }
  let split = 0;
  for (let pass = 0; pass < 4; pass++) {
    const nV = P.length / 3, nE = TT.length;
    const he = new Set();
    for (let e = 0; e < nE; e++) he.add(TT[e] * nV + TT[nxt(e)]);
    const open = [];
    for (let e = 0; e < nE; e++) if (!he.has(TT[nxt(e)] * nV + TT[e])) open.push(e);
    if (!open.length) break;
    // vertices of open edges, hashed on a grid of the mean open-edge length
    const ov = new Set();
    let len = 0;
    for (const e of open) {
      const a = TT[e], b = TT[nxt(e)];
      ov.add(a);
      ov.add(b);
      len += Math.hypot(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
    }
    const h = Math.max(1e-3, len / open.length), grid = new Map();
    const key = (x, y, z) => `${x},${y},${z}`;
    for (const v of ov) {
      const k = key(Math.floor(P[v * 3] / h), Math.floor(P[v * 3 + 1] / h), Math.floor(P[v * 3 + 2] / h));
      let g = grid.get(k);
      if (!g) grid.set(k, (g = []));
      g.push(v);
    }
    const splits = new Map();
    for (const e of open) {
      const a = TT[e], b = TT[nxt(e)];
      const dx = P[b * 3] - P[a * 3], dy = P[b * 3 + 1] - P[a * 3 + 1], dz = P[b * 3 + 2] - P[a * 3 + 2], dd = dx * dx + dy * dy + dz * dz;
      if (!(dd > 0)) continue;
      const lo = [0, 1, 2].map((k) => Math.floor(Math.min(P[a * 3 + k], P[b * 3 + k]) / h));
      const hi = [0, 1, 2].map((k) => Math.floor(Math.max(P[a * 3 + k], P[b * 3 + k]) / h));
      if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 4096) continue;
      const found = [];
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
        for (const v of grid.get(key(x, y, z)) || []) {
          if (v === a || v === b) continue;
          const qx = P[v * 3] - P[a * 3], qy = P[v * 3 + 1] - P[a * 3 + 1], qz = P[v * 3 + 2] - P[a * 3 + 2];
          const s = (qx * dx + qy * dy + qz * dz) / dd;
          if (s <= 1e-7 || s >= 1 - 1e-7) continue;
          const r = (qx - s * dx) ** 2 + (qy - s * dy) ** 2 + (qz - s * dz) ** 2;
          if (r < 1e-10 * dd + 1e-14) found.push([s, v]);
        }
      }
      if (found.length) {
        found.sort((p, q) => p[0] - q[0]);
        splits.set(e, found.map((f) => f[1]).filter((v, i, arr) => i === 0 || v !== arr[i - 1]));
      }
    }
    if (!splits.size) break;
    const T2 = [], g2 = [];
    for (let t = 0; t < TT.length / 3; t++) {
      const es = [t * 3, t * 3 + 1, t * 3 + 2];
      if (!es.some((e) => splits.has(e))) {
        T2.push(TT[t * 3], TT[t * 3 + 1], TT[t * 3 + 2]);
        g2.push(tg[t]);
        continue;
      }
      const poly = [];
      for (const e of es) poly.push(TT[e], ...(splits.get(e) || []));
      const c = P.length / 3;
      for (let k = 0; k < 3; k++) P.push((P[TT[t * 3] * 3 + k] + P[TT[t * 3 + 1] * 3 + k] + P[TT[t * 3 + 2] * 3 + k]) / 3);
      for (let i = 0; i < poly.length; i++) {
        T2.push(poly[i], poly[(i + 1) % poly.length], c);
        g2.push(tg[t]);
      }
      split++;
    }
    TT = T2;
    tg = g2;
  }
  return { V: Float64Array.from(P), T: Uint32Array.from(TT), tags: tg, split };
}
