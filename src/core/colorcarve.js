// Colour split by CARVING (experimental 'carve' mode).
// The model keeps its exact outer surface. A band `carveDepth` mm deep under the surface is shared out between the
// colours: every point of the band goes to the colour painted nearest to it, so two colours meet on the bisector of
// their painted areas (straight walls perpendicular to the surface, with a small draft so each piece slides in: no
// wedges or spikes at the junctions). The rest of the solid (the core) stays base colour and is fused to the base
// colour's own band. Where the model is too thin for a core, the colours share the whole thickness.
// Every piece is cut from ONE partition field, so pieces never overlap and always keep the clearance between them;
// the core is a morphological opening (no base wall thinner than 2·r); a hidden core wrapped in a single colour
// becomes that colour (a solid bow prints as one piece of its colour).

import { triDist2 } from './colorskin.js';
import { farView, solidPieces } from './solidparts.js';

// closest point of triangle abc to p (Ericson) → out[0..2]
function closest(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v; return; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const v = d2 / (d2 - d6); out[0] = ax + acx * v; out[1] = ay + acy * v; out[2] = az + acz * v; return; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const v = (d4 - d3) / (d4 - d3 + (d5 - d6)); out[0] = bx + (cx - bx) * v; out[1] = by + (cy - by) * v; out[2] = bz + (cz - bz) * v; return; }
  const dn = 1 / (va + vb + vc), v = vb * dn, ww = vc * dn;
  out[0] = ax + abx * v + acx * ww; out[1] = ay + aby * v + acy * ww; out[2] = az + abz * v + acz * ww;
}

// edge adjacency of M's triangles (CSR): neighbour triangle, length and the two vertices of the shared edge
function triAdjacency(P, np, T, merged) {
  const nT = T.length / 3;
  const eMap = new Map(), deg = new Int32Array(nT), pairs = [];
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const a = merged[T[t * 3 + k]], b = merged[T[t * 3 + (k + 1) % 3]];
    const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    const o = eMap.get(key);
    if (o === undefined) eMap.set(key, t);
    else { eMap.delete(key); pairs.push(o, t, a, b); deg[o]++; deg[t]++; }
  }
  const off = new Int32Array(nT + 1);
  for (let t = 0; t < nT; t++) off[t + 1] = off[t] + deg[t];
  const nb = new Int32Array(off[nT]), nl = new Float32Array(off[nT]), ev = new Int32Array(off[nT] * 2), fill = off.slice(0, nT);
  for (let i = 0; i < pairs.length; i += 4) {
    const s = pairs[i], t = pairs[i + 1], a = pairs[i + 2], b = pairs[i + 3];
    const l = Math.hypot(P[a * np] - P[b * np], P[a * np + 1] - P[b * np + 1], P[a * np + 2] - P[b * np + 2]);
    let q = fill[s]++;
    nb[q] = t; nl[q] = l; ev[q * 2] = a; ev[q * 2 + 1] = b;
    q = fill[t]++;
    nb[q] = s; nl[q] = l; ev[q * 2] = a; ev[q * 2 + 1] = b;
  }
  return { off, nb, nl, ev };
}

// adj without the edges between triangles of different keys (surface pieces)
export function cutAdjacency(adj, key) {
  const { off, nb, nl, ev } = adj, nT = off.length - 1, off2 = new Int32Array(nT + 1);
  for (let t = 0; t < nT; t++) {
    let n = 0;
    for (let q = off[t]; q < off[t + 1]; q++) if (key[nb[q]] === key[t]) n++;
    off2[t + 1] = off2[t] + n;
  }
  const nb2 = new Int32Array(off2[nT]), nl2 = new Float32Array(off2[nT]), ev2 = new Int32Array(off2[nT] * 2);
  for (let t = 0, p = 0; t < nT; t++) for (let q = off[t]; q < off[t + 1]; q++) {
    if (key[nb[q]] !== key[t]) continue;
    nb2[p] = nb[q]; nl2[p] = nl[q]; ev2[p * 2] = ev[q * 2]; ev2[p * 2 + 1] = ev[q * 2 + 1]; p++;
  }
  return { off: off2, nb: nb2, nl: nl2, ev: ev2 };
}

// multi-source Dijkstra over the triangle graph (steps between triangle centres C), in place on dist; the front only
// crosses from t to u where pass(t, u); lab (optional) carries the label of the source each triangle is reached from
function triDijkstra(off, nb, C, dist, pass, lab = null) {
  let hk = new Float64Array(4096), hv = new Int32Array(4096), hn = 0;
  const push = (d, v) => {
    if (hn === hk.length) {
      const k2 = new Float64Array(hn * 2), v2 = new Int32Array(hn * 2);
      k2.set(hk); v2.set(hv); hk = k2; hv = v2;
    }
    let i = hn++;
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= d) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
    hk[i] = d; hv[i] = v;
  };
  for (let t = 0; t < dist.length; t++) if (dist[t] < Infinity) push(dist[t], t);
  while (hn) {
    const d0 = hk[0], t = hv[0];
    if (--hn) {
      const d = hk[hn], v = hv[hn];
      let i = 0;
      for (;;) { let l = 2 * i + 1; if (l >= hn) break; if (l + 1 < hn && hk[l + 1] < hk[l]) l++; if (hk[l] >= d) break; hk[i] = hk[l]; hv[i] = hv[l]; i = l; }
      hk[i] = d; hv[i] = v;
    }
    if (d0 > dist[t]) continue;
    for (let q = off[t]; q < off[t + 1]; q++) {
      const u = nb[q];
      if (!pass(t, u)) continue;
      const nd = d0 + Math.hypot(C[t * 3] - C[u * 3], C[t * 3 + 1] - C[u * 3 + 1], C[t * 3 + 2] - C[u * 3 + 2]);
      if (nd < dist[u]) { dist[u] = nd; if (lab) lab[u] = lab[t]; push(nd, u); }
    }
  }
  return dist;
}

// Colour areas narrower than 2·rho (a stray brush stroke, the thin tail of an area) take the colour around them: a
// morphological opening along the surface. A colour strip thinner than that cannot become a printable piece: carved,
// it leaves a hair-thin sliver or, inside a solid of another colour, a dovetail that cannot slide out.
// key (optional): surface piece of each triangle; the seams between pieces count as colour borders and are not crossed
export function openPaint(col, P, np, T, merged, rho, adj = triAdjacency(P, np, T, merged), key = null) {
  const nT = T.length / 3, { off, nb, nl, ev } = adj;
  const same = key ? (t, u) => col[t] === col[u] && key[t] === key[u] : (t, u) => col[t] === col[u];
  const C = new Float64Array(nT * 3);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const v = T[t * 3 + k] * np;
    C[t * 3] += P[v] / 3; C[t * 3 + 1] += P[v + 1] / 3; C[t * 3 + 2] += P[v + 2] / 3;
  }
  // distance from each triangle centre to the border of its colour area
  const dB = new Float64Array(nT).fill(Infinity);
  for (let t = 0; t < nT; t++) for (let q = off[t]; q < off[t + 1]; q++) {
    if (same(t, nb[q])) continue;
    const a = ev[q * 2] * np, b = ev[q * 2 + 1] * np;
    const ex = P[b] - P[a], ey = P[b + 1] - P[a + 1], ez = P[b + 2] - P[a + 2], e2 = ex * ex + ey * ey + ez * ez;
    const px = C[t * 3] - P[a], py = C[t * 3 + 1] - P[a + 1], pz = C[t * 3 + 2] - P[a + 2];
    const s = e2 > 0 ? Math.min(1, Math.max(0, (px * ex + py * ey + pz * ez) / e2)) : 0;
    const d = Math.hypot(px - s * ex, py - s * ey, pz - s * ez);
    if (d < dB[t]) dB[t] = d;
  }
  triDijkstra(off, nb, C, dB, same);
  // distance to the eroded area {dB ≥ rho}: what lies farther than rho from it is thinner than 2·rho (centre-to-centre
  // paths run a bit longer than the true distance: 1.5·rho)
  const dK = new Float64Array(nT).fill(Infinity);
  for (let t = 0; t < nT; t++) if (dB[t] >= rho) dK[t] = 0;
  triDijkstra(off, nb, C, dK, same);
  const drop = new Uint8Array(nT);
  let n = 0;
  for (let t = 0; t < nT; t++) if (dK[t] > 1.5 * rho) { drop[t] = 1; n++; }
  if (!n) return 0;
  // painted areas (connected, one colour, one key)
  const comp = new Int32Array(nT).fill(-1), compCol = [], queue = new Int32Array(nT);
  for (let s = 0; s < nT; s++) {
    if (comp[s] >= 0) continue;
    const id = compCol.length;
    compCol.push(col[s]);
    let h = 0, e = 0;
    queue[e++] = s; comp[s] = id;
    while (h < e) {
      const t = queue[h++];
      for (let q = off[t]; q < off[t + 1]; q++) { const u = nb[q]; if (comp[u] < 0 && same(t, u)) { comp[u] = id; queue[e++] = u; } }
    }
  }
  // dropped triangles go to the nearest eroded area of ANY colour, their own included: a thin stroke or tail goes to
  // the colours around it (split along their bisector), a tooth of a zig-zag border to the side it sticks into, the
  // corners of areas meeting at a point (a checkerboard) mostly stay as they are. src = painted area each one joins.
  const dL = new Float64Array(nT).fill(Infinity), src = new Int32Array(nT).fill(-1);
  for (let t = 0; t < nT; t++) if (dB[t] >= rho) { dL[t] = 0; src[t] = comp[t]; }
  triDijkstra(off, nb, C, dL, key ? (t, u) => key[t] === key[u] : () => true, src);
  for (let t = 0; t < nT; t++) if (!drop[t] || src[t] < 0) src[t] = comp[t];
  // the cleanup never joins two separately painted areas of a colour through a neck: where a dropped corner would link
  // them along less than 4·rho (diagonal cells of a checkerboard, linked corner to corner into rings that cannot be
  // assembled) the dropped triangles keep their paint; a removed stroke that parted them over a longer stretch does
  // join them
  const nc = compCol.length;
  for (let pass = 0; pass < 64; pass++) {
    const contact = new Map(), edges = [];
    for (let t = 0; t < nT; t++) for (let q = off[t]; q < off[t + 1]; q++) {
      const u = nb[q], a = src[t], b = src[u];
      if (u < t || a === b || compCol[a] !== compCol[b] || (key && key[t] !== key[u])) continue;
      const k = Math.min(a, b) * nc + Math.max(a, b);
      contact.set(k, (contact.get(k) || 0) + nl[q]);
      edges.push(t, u, k);
    }
    let reverted = 0;
    for (let i = 0; i < edges.length; i += 3) {
      if (contact.get(edges[i + 2]) >= 4 * rho) continue;
      for (const t of [edges[i], edges[i + 1]]) if (src[t] !== comp[t]) { src[t] = comp[t]; reverted++; }
    }
    if (!reverted) break;
  }
  let changed = 0;
  for (let t = 0; t < nT; t++) if (compCol[src[t]] !== col[t]) { col[t] = compCol[src[t]]; changed++; }
  return changed;
}

// A painted patch that is only a thin wall cannot be a separate piece. A tapered edge attached to a substantial
// thicker part of the same patch can, however, stay on that piece: recolouring individual triangles along the taper
// made long, jagged bites in otherwise printable colour pieces. The base colour wins for unsupported thin patches;
// between two other colours the one painted over the larger area wins.
// Every triangle casts a ray from its centre through the wall (against its normal) to the face it
// leaves the solid through; the wall thickness is the distance to that face's plane, so curved or tapered walls whose
// faces are not parallel (the ray crosses them slantwise) still count, while at a convex corner the ray runs deep into
// the body. key (optional): surface piece of each triangle; faces of other pieces are not compared.
// Returns how many triangles were recoloured.
export function thinWalls(col, P, np, T, base, Wt, key = null, adj = null) {
  const nT = T.length / 3, N = new Float64Array(nT * 3), C = new Float64Array(nT * 3), area = new Map();
  const areas = new Float64Array(nT), thick = new Uint8Array(nT);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < nT; t++) {
    const a = T[t * 3] * np, b = T[t * 3 + 1] * np, c = T[t * 3 + 2] * np;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (l > 0) { N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l; }
    areas[t] = l / 2;
    area.set(col[t], (area.get(col[t]) || 0) + areas[t]);
    for (let k = 0; k < 3; k++) {
      C[t * 3 + k] = (P[a + k] + P[b + k] + P[c + k]) / 3;
      lo[k] = Math.min(lo[k], P[a + k], P[b + k], P[c + k]);
      hi[k] = Math.max(hi[k], P[a + k], P[b + k], P[c + k]);
    }
  }
  // rays reach 2·Wt: a wall crossed up to 60° slantwise. Triangles bucketed (CSR) in cells at least Wt wide
  const Lr = 2 * Wt, h = Math.max(Wt, Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 128);
  const n = [0, 1, 2].map((k) => Math.floor((hi[k] - lo[k]) / h) + 1), NC = n[0] * n[1] * n[2];
  const cell = (x, k) => Math.min(n[k] - 1, Math.max(0, Math.floor((x - lo[k]) / h)));
  const rg = new Int32Array(6);
  const range = (t) => {
    for (let k = 0; k < 3; k++) {
      const x0 = P[T[t * 3] * np + k], x1 = P[T[t * 3 + 1] * np + k], x2 = P[T[t * 3 + 2] * np + k];
      rg[k] = cell(Math.min(x0, x1, x2), k); rg[k + 3] = cell(Math.max(x0, x1, x2), k);
    }
  };
  const off = new Int32Array(NC + 1);
  for (let t = 0; t < nT; t++) {
    range(t);
    for (let k = rg[2]; k <= rg[5]; k++) for (let j = rg[1]; j <= rg[4]; j++) for (let i = rg[0]; i <= rg[3]; i++) off[i + n[0] * (j + n[1] * k) + 1]++;
  }
  for (let q = 0; q < NC; q++) off[q + 1] += off[q];
  const items = new Int32Array(off[NC]), fill = off.slice(0, NC);
  for (let t = 0; t < nT; t++) {
    range(t);
    for (let k = rg[2]; k <= rg[5]; k++) for (let j = rg[1]; j <= rg[4]; j++) for (let i = rg[0]; i <= rg[3]; i++) items[fill[i + n[0] * (j + n[1] * k)]++] = t;
  }
  const stamp = new Int32Array(nT).fill(-1), next = col.slice();
  let changed = 0;
  for (let t = 0; t < nT; t++) {
    // the base colour always wins: its faces never change
    if (col[t] === base) continue;
    const dx = -N[t * 3], dy = -N[t * 3 + 1], dz = -N[t * 3 + 2];
    if (!dx && !dy && !dz) continue;
    const ox = C[t * 3], oy = C[t * 3 + 1], oz = C[t * 3 + 2];
    const i0 = cell(Math.min(ox, ox + dx * Lr), 0), i1 = cell(Math.max(ox, ox + dx * Lr), 0);
    const j0 = cell(Math.min(oy, oy + dy * Lr), 1), j1 = cell(Math.max(oy, oy + dy * Lr), 1);
    const k0 = cell(Math.min(oz, oz + dz * Lr), 2), k1 = cell(Math.max(oz, oz + dz * Lr), 2);
    let best = Lr, hit = -1;
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const ci = i + n[0] * (j + n[1] * k);
      for (let q = off[ci]; q < off[ci + 1]; q++) {
        const u = items[q];
        if (u === t || stamp[u] === t) continue;
        stamp[u] = t;
        // the ray leaves the solid through a face turned along it
        if (N[u * 3] * dx + N[u * 3 + 1] * dy + N[u * 3 + 2] * dz < 0.2) continue;
        const a = T[u * 3] * np, b = T[u * 3 + 1] * np, c = T[u * 3 + 2] * np;
        const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det, tx = ox - P[a], ty = oy - P[a + 1], tz = oz - P[a + 2];
        const bu = (tx * px + ty * py + tz * pz) * inv;
        if (bu < -1e-7 || bu > 1 + 1e-7) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const bv = (dx * qx + dy * qy + dz * qz) * inv;
        if (bv < -1e-7 || bu + bv > 1 + 1e-7) continue;
        const s = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (s > 1e-6 && s < best) { best = s; hit = u; }
      }
    }
    if (hit < 0) { thick[t] = 1; continue; }
    // thickness = distance to the exit face's plane; exits more than 60° slantwise are not a wall
    const ch = N[hit * 3] * dx + N[hit * 3 + 1] * dy + N[hit * 3 + 2] * dz;
    if (ch < 0.5 || best * ch >= Wt) { thick[t] = 1; continue; }
    if (col[hit] === col[t] || (key && key[hit] !== key[t])) continue;
    const a = col[t], b = col[hit], A = area.get(a), Bv = area.get(b);
    const win = a === base || b === base ? base : Bv > A || (Bv === A && b < a) ? b : a;
    if (win !== a) { next[t] = win; changed++; }
  }
  if (changed) {
    adj ||= triAdjacency(P, np, T, Uint32Array.from({ length: P.length / np }, (_, i) => i));
    const { off: ao, nb } = adj, seen = new Uint8Array(nT), queue = new Int32Array(nT);
    for (let s = 0; s < nT; s++) {
      if (seen[s] || col[s] === base) continue;
      let h = 0, e = 1, support = 0;
      queue[0] = s; seen[s] = 1;
      while (h < e) {
        const t = queue[h++];
        if (thick[t]) support += areas[t];
        for (let q = ao[t]; q < ao[t + 1]; q++) {
          const u = nb[q];
          if (seen[u] || col[u] !== col[s] || (key && key[u] !== key[s])) continue;
          seen[u] = 1; queue[e++] = u;
        }
      }
      // Require an area equivalent to a 2*Wt square, not one surviving triangle; this is independent of tessellation.
      if (support >= 4 * Wt * Wt) for (let q = 0; q < e; q++) {
        const t = queue[q];
        if (next[t] !== col[t]) { next[t] = col[t]; changed--; }
      }
    }
    col.set(next);
  }
  return changed;
}

// painted islands smaller than minArea (mm²) take the colour of the neighbour sharing the longest border with them
export function cleanIslands(col, P, np, T, merged, minArea, adj = triAdjacency(P, np, T, merged)) {
  const nT = T.length / 3, area = new Float64Array(nT);
  const vp = (i, q) => P[i * np + q];
  for (let t = 0; t < nT; t++) {
    const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
    const ux = vp(b, 0) - vp(a, 0), uy = vp(b, 1) - vp(a, 1), uz = vp(b, 2) - vp(a, 2), wx = vp(c, 0) - vp(a, 0), wy = vp(c, 1) - vp(a, 1), wz = vp(c, 2) - vp(a, 2);
    area[t] = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
  }
  const { off, nb, nl } = adj;
  let changed = 0;
  for (let pass = 0; pass < 8; pass++) {
    const comp = new Int32Array(nT).fill(-1), queue = new Int32Array(nT);
    const fix = [];
    let nc = 0;
    for (let s = 0; s < nT; s++) {
      if (comp[s] >= 0) continue;
      let h = 0, e = 0, ar = 0;
      queue[e++] = s; comp[s] = nc;
      while (h < e) {
        const t = queue[h++];
        ar += area[t];
        for (let q = off[t]; q < off[t + 1]; q++) { const u = nb[q]; if (comp[u] < 0 && col[u] === col[s]) { comp[u] = nc; queue[e++] = u; } }
      }
      if (ar < minArea) {
        const bl = new Map();
        for (let n = 0; n < e; n++) { const t = queue[n]; for (let q = off[t]; q < off[t + 1]; q++) { const u = nb[q]; if (comp[u] !== nc) bl.set(col[u], (bl.get(col[u]) || 0) + nl[q]); } }
        let best = -1, bv = 0;
        for (const [c, l] of bl) if (l > bv) { bv = l; best = c; }
        if (best >= 0) fix.push(queue.slice(0, e), best, ar);
      }
      nc++;
    }
    if (!fix.length) break;
    // smallest first; an island whose neighbour was also recoloured is handled in the next pass
    const items = [];
    for (let i = 0; i < fix.length; i += 3) items.push([fix[i], fix[i + 1], fix[i + 2]]);
    items.sort((a, b) => a[2] - b[2]);
    const touched = new Uint8Array(nT);
    let any = false;
    for (const [tris, c] of items) {
      let skip = false;
      for (const t of tris) { for (let q = off[t]; q < off[t + 1]; q++) if (touched[nb[q]]) { skip = true; break; } if (skip) break; }
      if (skip) continue;
      for (const t of tris) { col[t] = c; touched[t] = 1; }
      changed += tris.length;
      any = true;
    }
    if (!any) break;
  }
  return changed;
}

// connected components (6-neighbourhood) of the nodes where mask[g] is set; returns { comp (Int32, -1 = none), sizes }
// base-coloured islands on the triangles of one run (a solid shell): islands smaller than minArea take the solid's
// colour; returns how many bigger ones are left
function baseIslands(col, P, np, T, adj, runOf, id, base, color, minArea) {
  const { off, nb } = adj, nT = T.length / 3, seen = new Uint8Array(nT), queue = [];
  let big = 0;
  for (let t0 = 0; t0 < nT; t0++) {
    if (seen[t0] || runOf[t0] !== id || col[t0] !== base) continue;
    queue.length = 0;
    queue.push(t0);
    seen[t0] = 1;
    let ar = 0;
    for (let h = 0; h < queue.length; h++) {
      const t = queue[h], a = T[t * 3] * np, b = T[t * 3 + 1] * np, c = T[t * 3 + 2] * np;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      ar += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      for (let e = off[t]; e < off[t + 1]; e++) {
        const u = nb[e];
        if (!seen[u] && runOf[u] === id && col[u] === base) { seen[u] = 1; queue.push(u); }
      }
    }
    if (ar < minArea) for (const t of queue) col[t] = color;
    else big++;
  }
  return big;
}

function components(n, mask) {
  const [nx, ny, nz] = n, N = nx * ny * nz, sz = nx * ny;
  const comp = new Int32Array(N).fill(-1), queue = new Int32Array(N), sizes = [];
  for (let s = 0; s < N; s++) {
    if (!mask[s] || comp[s] >= 0) continue;
    const id = sizes.length;
    let h = 0, e = 0;
    queue[e++] = s; comp[s] = id;
    while (h < e) {
      const g = queue[h++], i = g % nx, j = Math.floor(g / nx) % ny, k = Math.floor(g / sz);
      if (i > 0 && mask[g - 1] && comp[g - 1] < 0) { comp[g - 1] = id; queue[e++] = g - 1; }
      if (i < nx - 1 && mask[g + 1] && comp[g + 1] < 0) { comp[g + 1] = id; queue[e++] = g + 1; }
      if (j > 0 && mask[g - nx] && comp[g - nx] < 0) { comp[g - nx] = id; queue[e++] = g - nx; }
      if (j < ny - 1 && mask[g + nx] && comp[g + nx] < 0) { comp[g + nx] = id; queue[e++] = g + nx; }
      if (k > 0 && mask[g - sz] && comp[g - sz] < 0) { comp[g - sz] = id; queue[e++] = g - sz; }
      if (k < nz - 1 && mask[g + sz] && comp[g + sz] < 0) { comp[g + sz] = id; queue[e++] = g + sz; }
    }
    sizes.push(e);
  }
  return { comp, sizes };
}

// M: the whole solid (Manifold, faces of M keep their original IDs `mIDs`), mg = M.getMesh(), col: colour per M triangle.
// Returns [{ kind: 'body'|'cover', color, man, up }].
// solids: [{ color, mesh, id }] single-colour solid shells of the model (id = their run in mg), rest: mesh of the union
// of the other shells (or null)
export function buildCarve({ w, o, M, mg, col, mIDs, merged, base, keep, warnings, progress, cutAxis, voxelize, edt, solids = [], rest = null, keepBase = [] }) {
  const { Manifold } = w;
  const P = mg.vertProperties, T = mg.triVerts, np = mg.numProp, nT = T.length / 3;
  const D = o.carveDepth, cl = o.clearance, gF = cl / 2, r = Math.max(0.2, o.minWall / 2);
  const tq = Math.tan((Math.max(0, o.carveDraft) * Math.PI) / 180);

  progress('Tallado: limpiando colores', 0.14);
  const adj = triAdjacency(P, np, T, merged);
  // a solid's paint and the rest's are cleaned apart: paint of the solid's colour spilt onto the rest along their seam
  // is a thin strip of the rest (carved there, it would leave a groove with no piece in it), not part of the solid
  let runOf = null, key = null;
  if (solids.length) {
    runOf = new Float64Array(nT);
    for (let q = 0; q < mg.runOriginalID.length; q++) runOf.fill(mg.runOriginalID[q], mg.runIndex[q] / 3, mg.runIndex[q + 1] / 3);
    const byId = new Map(solids.map((s, n) => [s.id, n]));
    key = new Int16Array(nT);
    for (let t = 0; t < nT; t++) key[t] = byId.get(runOf[t]) ?? -1;
  }
  const walled = thinWalls(col, P, np, T, base, o.minWall + cl, key, adj);
  const thinned = openPaint(col, P, np, T, merged, (o.carveMinWidth ?? 0.6) / 2, adj, key);
  const fixed = cleanIslands(col, P, np, T, merged, o.minArea, key ? cutAdjacency(adj, key) : adj);
  // base paint on a solid: specks (smaller than minArea within the solid, e.g. at its joint with the base) take the
  // solid's colour; a solid that still shows base paint keeps a base core: filled with its colour, a base patch on it
  // would end up as a loose base piece inside it (it widens with depth, so it could not be put in)
  let unfilled = [];
  if (solids.length) {
    unfilled = solids.filter((s) => s.id !== undefined && baseIslands(col, P, np, T, adj, runOf, s.id, base, s.color, o.minArea) > 0);
  }
  if (unfilled.length) {
    solids = solids.filter((s) => !unfilled.includes(s));
    if (solids.length) rest = keep(Manifold.union([...(rest ? [rest] : []), ...unfilled.map((s) => s.mesh)].map((g) => keep(new Manifold(g))))).getMesh();
    warnings.push(`Tallado: ${unfilled.length} pieza(s) maciza(s) tienen pintura del color base: van con núcleo del color base`);
  }
  const used = [...new Set(col)];
  if (!used.includes(base)) used.push(base);

  // ---- grid (nodes), as fine as carveGrid, coarser on big models (≈ 40 bytes per node at the peak)
  const bb = M.boundingBox(), ext = [0, 1, 2].map((q) => bb.max[q] - bb.min[q]);
  const maxVox = o.carveMaxVox || 14e6;
  let H = o.carveGrid;
  const nodes = (h) => ext.reduce((a, e) => a * (Math.ceil((e + 6 * h + 0.01) / h) + 1), 1);
  while (nodes(H) > maxVox) H *= 1.08;
  const m0 = 3 * H + 0.005, o0 = bb.min.map((x) => x - m0);
  const NX = Math.ceil((ext[0] + 2 * m0) / H) + 1, NY = Math.ceil((ext[1] + 2 * m0) / H) + 1, NZ = Math.ceil((ext[2] + 2 * m0) / H) + 1;
  const NG = NX * NY * NZ, SZ = NX * NY;
  const G = { n: [NX, NY, NZ], o: o0, h: H, N: NG };
  const R = D + r + 2 * H, R2 = R * R;

  // ---- unit normals of M's triangles
  const TN = new Float32Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    const a = T[t * 3] * np, b = T[t * 3 + 1] * np, c = T[t * 3 + 2] * np;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (l > 0) { TN[t * 3] = nx / l; TN[t * 3 + 1] = ny / l; TN[t * 3 + 2] = nz / l; }
  }

  // ---- splat: nearest triangle (t1), nearest triangle of another colour (t2), nearest base triangle (tb)
  const d1 = new Float32Array(NG).fill(R2), d2 = new Float32Array(NG).fill(R2), db = new Float32Array(NG).fill(R2);
  const t1 = new Int32Array(NG).fill(-1), t2 = new Int32Array(NG).fill(-1), tb = new Int32Array(NG).fill(-1);
  const H2 = 2 * H;
  for (let t = 0; t < nT; t++) {
    if ((t & 2047) === 0) progress('Tallado: distancias', 0.15 + (0.3 * t) / nT);
    const nx = TN[t * 3], ny = TN[t * 3 + 1], nz = TN[t * 3 + 2];
    if (nx === 0 && ny === 0 && nz === 0) continue;
    const c = col[t], isB = c === base;
    const a = T[t * 3] * np, b = T[t * 3 + 1] * np, e = T[t * 3 + 2] * np;
    const ax = P[a], ay = P[a + 1], az = P[a + 2], bx = P[b], by = P[b + 1], bz = P[b + 2], cx = P[e], cy = P[e + 1], cz = P[e + 2];
    const gx = (ax + bx + cx) / 3, gy = (ay + by + cy) / 3, gz = (az + bz + cz) / 3;
    const rho = Math.sqrt(Math.max((ax - gx) ** 2 + (ay - gy) ** 2 + (az - gz) ** 2, (bx - gx) ** 2 + (by - gy) ** 2 + (bz - gz) ** 2, (cx - gx) ** 2 + (cy - gy) ** 2 + (cz - gz) ** 2));
    const Rs = rho + R, Rs2 = Rs * Rs, pd0 = nx * ax + ny * ay + nz * az;
    const k0 = Math.max(0, Math.ceil((gz - Rs - o0[2]) / H)), k1 = Math.min(NZ - 1, Math.floor((gz + Rs - o0[2]) / H));
    const j0 = Math.max(0, Math.ceil((gy - Rs - o0[1]) / H)), j1 = Math.min(NY - 1, Math.floor((gy + Rs - o0[1]) / H));
    for (let k = k0; k <= k1; k++) {
      const z = o0[2] + k * H, dz = z - gz;
      for (let j = j0; j <= j1; j++) {
        const y = o0[1] + j * H, dy = y - gy, rem = Rs2 - dy * dy - dz * dz;
        if (rem < 0) continue;
        const sq = Math.sqrt(rem);
        let i0 = Math.ceil((gx - sq - o0[0]) / H), i1 = Math.floor((gx + sq - o0[0]) / H);
        // only nodes behind the plane (inside) or at most 2H in front of it
        const pb = ny * y + nz * z - pd0 + nx * o0[0];
        if (Math.abs(nx) > 1e-9) {
          let lo = (-R - pb) / (nx * H), hi = (H2 - pb) / (nx * H);
          if (nx < 0) { const s = lo; lo = hi; hi = s; }
          i0 = Math.max(i0, Math.ceil(lo)); i1 = Math.min(i1, Math.floor(hi));
        } else if (pb < -R || pb > H2) continue;
        if (i0 < 0) i0 = 0;
        if (i1 > NX - 1) i1 = NX - 1;
        let gg = i0 + j * NX + k * SZ;
        for (let i = i0; i <= i1; i++, gg++) {
          const q = triDist2(o0[0] + i * H, y, z, ax, ay, az, bx, by, bz, cx, cy, cz);
          if (q >= R2) continue;
          if (isB && q < db[gg]) { db[gg] = q; tb[gg] = t; }
          const o1 = t1[gg];
          if (q < d1[gg]) {
            if (o1 >= 0 && col[o1] !== c) { d2[gg] = d1[gg]; t2[gg] = o1; }
            d1[gg] = q; t1[gg] = t;
          } else if (q < d2[gg] && col[o1] !== c) { d2[gg] = q; t2[gg] = t; }
        }
      }
    }
  }

  progress('Tallado: interior', 0.46);
  const ins = voxelize(G, mg);

  // ---- fields: S = signed depth (+ inside), L1 = nearest colour, PHI = distance to the border of L1's area,
  //      PHIB = signed distance to the base colour's area (> 0 inside it)
  const S = new Float32Array(NG), PHI = new Float32Array(NG), PHIB = new Float32Array(NG), L1 = new Uint8Array(NG).fill(base);
  const q1 = [0, 0, 0], q2 = [0, 0, 0];
  const BIG = R;
  const tri = (t, px, py, pz, out) => {
    const a = T[t * 3] * np, b = T[t * 3 + 1] * np, e = T[t * 3 + 2] * np;
    closest(px, py, pz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[e], P[e + 1], P[e + 2], out);
  };
  // distance from p to the border between the areas of the nearest points q1 (sq. dist e1, triangle u) and q2 (e2, v):
  // the bisector of q1 and q2 where the two areas meet at a crease, half the |q1 q2| more where they lie on one smooth
  // surface (there q2 is the border point itself)
  const sep = (e1, e2, u, v) => {
    const l = Math.hypot(q2[0] - q1[0], q2[1] - q1[1], q2[2] - q1[2]);
    if (l < 1e-7) return 0;
    const cosn = TN[u * 3] * TN[v * 3] + TN[u * 3 + 1] * TN[v * 3 + 1] + TN[u * 3 + 2] * TN[v * 3 + 2];
    const lam = Math.min(1, Math.max(0, (cosn - 0.5) / 0.5));
    return (e2 - e1) / (2 * l) + (lam * l) / 2;
  };
  for (let k = 0, gg = 0; k < NZ; k++) {
    if ((k & 15) === 0) progress('Tallado: campos', 0.47 + (0.08 * k) / NZ);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++, gg++) {
      const u = t1[gg];
      if (u < 0) { S[gg] = ins[gg] ? BIG : -BIG; PHI[gg] = PHIB[gg] = BIG; continue; }
      const px = o0[0] + i * H, py = o0[1] + j * H, pz = o0[2] + k * H, e1 = d1[gg], dd = Math.sqrt(e1);
      S[gg] = ins[gg] ? dd : -dd;
      const c = col[u];
      L1[gg] = c;
      tri(u, px, py, pz, q1);
      let phi = BIG;
      const v = t2[gg];
      if (v >= 0) { tri(v, px, py, pz, q2); phi = Math.min(BIG, sep(e1, d2[gg], u, v)); }
      PHI[gg] = phi;
      if (c === base) PHIB[gg] = phi;
      else {
        let pbs = BIG;
        const vb = tb[gg];
        if (vb >= 0) { tri(vb, px, py, pz, q2); pbs = Math.min(BIG, sep(e1, db[gg], u, vb)); }
        PHIB[gg] = -Math.max(phi, pbs);
      }
    }
  }

  // ---- core: points deeper than D + r, opened by r (no thin base walls), at least D under the surface
  progress('Tallado: núcleo', 0.56);
  const E = new Uint8Array(NG);
  for (let gg = 0; gg < NG; gg++) E[gg] = ins[gg] && S[gg] >= D + r ? 1 : 0;
  {
    const { comp, sizes } = components(G.n, E);
    for (let gg = 0; gg < NG; gg++) if (E[gg] && sizes[comp[gg]] < 8) E[gg] = 0;
  }
  const notE = new Uint8Array(NG);
  for (let gg = 0; gg < NG; gg++) notE[gg] = E[gg] ? 0 : 1;
  const B = edt(G, notE); // distance to the deep zone
  for (let gg = 0; gg < NG; gg++) B[gg] = Math.max(D - S[gg], B[gg] - r - 0.25 * H);

  // hidden cores: a core wrapped in one single colour (no base colour around it) becomes that colour
  const PHIF = Math.max(2 * H, cl + tq * D + H);
  const NOF = 255, FC = new Uint8Array(NG).fill(NOF); // colour a core node is filled with
  {
    const core = new Uint8Array(NG);
    for (let gg = 0; gg < NG; gg++) core[gg] = ins[gg] && B[gg] <= 0 ? 1 : 0;
    const { comp, sizes } = components(G.n, core);
    const tally = sizes.map(() => new Map());
    const look = (gg, id) => { if (ins[gg] && B[gg] > 0) { const m = tally[id]; m.set(L1[gg], (m.get(L1[gg]) || 0) + 1); } };
    for (let gg = 0; gg < NG; gg++) {
      const id = comp[gg];
      if (id < 0) continue;
      const i = gg % NX, j = Math.floor(gg / NX) % NY, k = Math.floor(gg / SZ);
      if (i > 0) look(gg - 1, id);
      if (i < NX - 1) look(gg + 1, id);
      if (j > 0) look(gg - NX, id);
      if (j < NY - 1) look(gg + NX, id);
      if (k > 0) look(gg - SZ, id);
      if (k < NZ - 1) look(gg + SZ, id);
    }
    const fillTo = tally.map((m) => {
      let tot = 0, best = -1, bv = 0;
      for (const [c, n] of m) { tot += n; if (n > bv) { bv = n; best = c; } }
      return tot && !m.get(base) && bv >= 0.95 * tot ? best : -1;
    });
    // the core of a part locked into the model (a print-in-place joint) stays base: filled, the part would be a loose
    // piece of colour that cannot be put in place
    for (const g of keepBase) {
      const m = voxelize(G, g);
      for (let gg = 0; gg < NG; gg++) if (m[gg] && comp[gg] >= 0) fillTo[comp[gg]] = -1;
    }
    for (let gg = 0; gg < NG; gg++) if (comp[gg] >= 0 && fillTo[comp[gg]] >= 0) FC[gg] = fillTo[comp[gg]];
    const nh = fillTo.filter((c) => c >= 0).length;
    if (nh) warnings.push(`Tallado: ${nh} núcleo(s) oculto(s) quedan del color que los envuelve`);
  }
  // filled nodes leave the base core; B is measured again from what is left of it, so the colour band and the filled
  // core join smoothly (setting B high only on the filled nodes leaves a perforated gap film around them)
  {
    let nf = 0;
    for (let gg = 0; gg < NG; gg++) if (FC[gg] !== NOF) { notE[gg] = 1; nf++; }
    if (nf) {
      const B2 = edt(G, notE);
      for (let gg = 0; gg < NG; gg++) {
        B[gg] = Math.max(D - S[gg], B2[gg] - r - 0.25 * H);
        if (FC[gg] !== NOF) { L1[gg] = FC[gg]; PHI[gg] = PHIF; PHIB[gg] = -PHIF; }
      }
    }
  }
  // single-colour solid shells of the model (a bow stuck on a head) print as one solid piece of their colour instead of
  // a thin skin over the base. Their joint with the rest of the model is a colour border at the rest's surface, measured
  // exactly (e = signed distance outside the rest, no voxel steps and no paint zigzag). The solid's side (region A) only
  // takes paint on its own surface (covers carved into it); the rest's side only its own paint, the joint counting as
  // base: rest covers end square at the crease, and no paint bisector runs diagonally under the solid.
  if (solids.length) {
    const inRest = rest ? voxelize(G, rest) : null;
    const Rr = gF + 3 * H, Rr2 = Rr * Rr, FR = new Float32Array(NG).fill(Rr2);
    const sol = new Int16Array(NG).fill(-1);
    solids.forEach(({ mesh }, n) => {
      const m = voxelize(G, mesh);
      for (let gg = 0; gg < NG; gg++) if (m[gg] && ins[gg] && sol[gg] < 0) sol[gg] = n;
    });
    // SB = box of the solids' nodes and the reach of their paint around them
    const lo = [NX, NY, NZ], hi = [-1, -1, -1];
    for (let k = 0, gg = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++, gg++) {
      if (sol[gg] < 0) continue;
      if (i < lo[0]) lo[0] = i; if (i > hi[0]) hi[0] = i;
      if (j < lo[1]) lo[1] = j; if (j > hi[1]) hi[1] = j;
      if (k < lo[2]) lo[2] = k; if (k > hi[2]) hi[2] = k;
    }
    if (hi[0] >= 0) {
      const mgn = Math.ceil(R / H) + 1, top = [NX - 1, NY - 1, NZ - 1];
      for (let q = 0; q < 3; q++) { lo[q] = Math.max(0, lo[q] - mgn); hi[q] = Math.min(top[q], hi[q] + mgn); }
      const sx = hi[0] - lo[0] + 1, sxy = sx * (hi[1] - lo[1] + 1), NSB = sxy * (hi[2] - lo[2] + 1);
      const bmin = lo.map((x, q) => o0[q] + x * H - R), bmax = hi.map((x, q) => o0[q] + x * H + R);
      if (rest) {
        const RP = rest.vertProperties, RT = rest.triVerts, rnp = rest.numProp;
        for (let t = 0; t < RT.length; t += 3) {
          const a = RT[t] * rnp, b = RT[t + 1] * rnp, c = RT[t + 2] * rnp;
          const ax = RP[a], ay = RP[a + 1], az = RP[a + 2], bx = RP[b], by = RP[b + 1], bz = RP[b + 2], cx = RP[c], cy = RP[c + 1], cz = RP[c + 2];
          const i0 = Math.max(lo[0], Math.ceil((Math.min(ax, bx, cx) - Rr - o0[0]) / H)), i1 = Math.min(hi[0], Math.floor((Math.max(ax, bx, cx) + Rr - o0[0]) / H));
          const j0 = Math.max(lo[1], Math.ceil((Math.min(ay, by, cy) - Rr - o0[1]) / H)), j1 = Math.min(hi[1], Math.floor((Math.max(ay, by, cy) + Rr - o0[1]) / H));
          const k0 = Math.max(lo[2], Math.ceil((Math.min(az, bz, cz) - Rr - o0[2]) / H)), k1 = Math.min(hi[2], Math.floor((Math.max(az, bz, cz) + Rr - o0[2]) / H));
          for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0, gg = i0 + j * NX + k * SZ; i <= i1; i++, gg++) {
            const q = triDist2(o0[0] + i * H, o0[1] + j * H, o0[2] + k * H, ax, ay, az, bx, by, bz, cx, cy, cz);
            if (q < FR[gg]) FR[gg] = q;
          }
        }
      }
      // own[t] = the solid whose surface triangle t is (-1: the rest)
      const own = new Int16Array(nT).fill(-1), byId = new Map(solids.map((s, n) => [s.id, n]));
      for (let q = 0; q < mg.runOriginalID.length; q++) {
        const n = byId.get(mg.runOriginalID[q]);
        if (n !== undefined) own.fill(n, mg.runIndex[q] / 3, mg.runIndex[q + 1] / 3);
      }
      // the rest opened by r: thin bits of it inside a solid (a rod through a bow) go to the solid
      const notD = new Uint8Array(NG).fill(1), r2 = r * r;
      if (inRest) for (let gg = 0; gg < NG; gg++) if (inRest[gg] && FR[gg] >= r2) notD[gg] = 0;
      const BO = edt(G, notD);
      // region A: solid nodes outside the rest, and nodes outside the model whose nearest surface is a solid's.
      // PHI = e - gF + cl/2 + draft, PHIB = cl/2 - draft - e: the solid's colour where e > gF, nothing between; the
      // base ends exactly at e = 0 (U' = e: a solid has no base paint, and paint-based values would make it zigzag)
      const eS = new Float32Array(NSB), isA = new Uint8Array(NSB);
      for (let k = lo[2], li = 0; k <= hi[2]; k++) for (let j = lo[1]; j <= hi[1]; j++) for (let i = lo[0], gg = i + j * NX + k * SZ; i <= hi[0]; i++, gg++, li++) {
        const n = sol[gg], u = t1[gg], ou = u >= 0 ? own[u] : -1;
        let e = inRest && inRest[gg] ? -Math.sqrt(FR[gg]) : Math.sqrt(FR[gg]);
        if (n >= 0) e = Math.max(e, BO[gg] - r - 0.25 * H);
        eS[li] = e;
        const m = ins[gg] ? (e > 0 ? n : -1) : ou;
        if (m < 0) continue;
        isA[li] = 1;
        const v = t2[gg], ov = v >= 0 ? own[v] : -1;
        const z = tq * (S[gg] < 0 ? 0 : S[gg] > D ? D : S[gg]), pj = e - gF + cl / 2 + z;
        if (ou === m) PHI[gg] = ov === m ? Math.min(PHI[gg], pj) : pj;
        else { L1[gg] = solids[m].color; PHI[gg] = pj; }
        PHIB[gg] = cl / 2 - z - e;
        if (ins[gg] && e > B[gg]) B[gg] = e;
      }
      // the joint J = faces of the rest inside the solids (normals out of the rest)
      const J = [];
      if (rest) {
        const RM = keep(keep(new Manifold(rest)).asOriginal()), rid = RM.originalID();
        for (const s of solids) {
          const xm = keep(RM.intersect(keep(new Manifold(s.mesh)))).getMesh(), XP = xm.vertProperties, XT = xm.triVerts, xnp = xm.numProp;
          for (let q = 0; q < xm.runOriginalID.length; q++) {
            if (xm.runOriginalID[q] !== rid) continue;
            for (let t = xm.runIndex[q]; t < xm.runIndex[q + 1]; t++) { const a = XT[t] * xnp; J.push(XP[a], XP[a + 1], XP[a + 2]); }
          }
        }
      }
      const nJ = J.length / 9, JN = new Float32Array(nJ * 3);
      for (let q = 0; q < nJ; q++) {
        const b = q * 9, ux = J[b + 3] - J[b], uy = J[b + 4] - J[b + 1], uz = J[b + 5] - J[b + 2], vx = J[b + 6] - J[b], vy = J[b + 7] - J[b + 1], vz = J[b + 8] - J[b + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
        if (l > 0) { JN[q * 3] = nx / l; JN[q * 3 + 1] = ny / l; JN[q * 3 + 2] = nz / l; }
      }
      // the rest's side: nearest / nearest of another colour / nearest base triangle among the rest's surface and J
      // (index nT + q), in the splat's arrays (no longer needed)
      const rd1 = d1.subarray(0, NSB).fill(R2), rd2 = d2.subarray(0, NSB).fill(R2), rdb = db.subarray(0, NSB).fill(R2);
      const rt1 = t1.subarray(0, NSB).fill(-1), rt2 = t2.subarray(0, NSB).fill(-1), rtb = tb.subarray(0, NSB).fill(-1);
      const colR = (t) => (t < nT ? col[t] : base);
      const splatR = (tt, ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz) => {
        if (nx === 0 && ny === 0 && nz === 0) return;
        const c = colR(tt), isB = c === base;
        const gx = (ax + bx + cx) / 3, gy = (ay + by + cy) / 3, gz = (az + bz + cz) / 3;
        const rho = Math.sqrt(Math.max((ax - gx) ** 2 + (ay - gy) ** 2 + (az - gz) ** 2, (bx - gx) ** 2 + (by - gy) ** 2 + (bz - gz) ** 2, (cx - gx) ** 2 + (cy - gy) ** 2 + (cz - gz) ** 2));
        const Rs = rho + R, Rs2 = Rs * Rs, pd0 = nx * ax + ny * ay + nz * az;
        const k0 = Math.max(lo[2], Math.ceil((gz - Rs - o0[2]) / H)), k1 = Math.min(hi[2], Math.floor((gz + Rs - o0[2]) / H));
        const j0 = Math.max(lo[1], Math.ceil((gy - Rs - o0[1]) / H)), j1 = Math.min(hi[1], Math.floor((gy + Rs - o0[1]) / H));
        for (let k = k0; k <= k1; k++) {
          const z = o0[2] + k * H, dz = z - gz;
          for (let j = j0; j <= j1; j++) {
            const y = o0[1] + j * H, dy = y - gy, rem = Rs2 - dy * dy - dz * dz;
            if (rem < 0) continue;
            const sq = Math.sqrt(rem);
            let i0 = Math.ceil((gx - sq - o0[0]) / H), i1 = Math.floor((gx + sq - o0[0]) / H);
            const pb = ny * y + nz * z - pd0 + nx * o0[0];
            if (Math.abs(nx) > 1e-9) {
              let l0 = (-R - pb) / (nx * H), l1 = (H2 - pb) / (nx * H);
              if (nx < 0) { const w0 = l0; l0 = l1; l1 = w0; }
              i0 = Math.max(i0, Math.ceil(l0)); i1 = Math.min(i1, Math.floor(l1));
            } else if (pb < -R || pb > H2) continue;
            if (i0 < lo[0]) i0 = lo[0];
            if (i1 > hi[0]) i1 = hi[0];
            for (let i = i0, gg = i0 + j * NX + k * SZ, li = i0 - lo[0] + (j - lo[1]) * sx + (k - lo[2]) * sxy; i <= i1; i++, gg++, li++) {
              if (isA[li] || FC[gg] !== NOF) continue;
              const q = triDist2(o0[0] + i * H, y, z, ax, ay, az, bx, by, bz, cx, cy, cz);
              if (q >= R2) continue;
              if (isB && q < rdb[li]) { rdb[li] = q; rtb[li] = tt; }
              const o1 = rt1[li];
              if (q < rd1[li]) {
                if (o1 >= 0 && colR(o1) !== c) { rd2[li] = rd1[li]; rt2[li] = o1; }
                rd1[li] = q; rt1[li] = tt;
              } else if (q < rd2[li] && colR(o1) !== c) { rd2[li] = q; rt2[li] = tt; }
            }
          }
        }
      };
      for (let t = 0; t < nT; t++) {
        if (own[t] >= 0) continue;
        const a = T[t * 3] * np, b = T[t * 3 + 1] * np, c = T[t * 3 + 2] * np;
        if (Math.max(P[a], P[b], P[c]) < bmin[0] || Math.min(P[a], P[b], P[c]) > bmax[0]) continue;
        if (Math.max(P[a + 1], P[b + 1], P[c + 1]) < bmin[1] || Math.min(P[a + 1], P[b + 1], P[c + 1]) > bmax[1]) continue;
        if (Math.max(P[a + 2], P[b + 2], P[c + 2]) < bmin[2] || Math.min(P[a + 2], P[b + 2], P[c + 2]) > bmax[2]) continue;
        splatR(t, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2], TN[t * 3], TN[t * 3 + 1], TN[t * 3 + 2]);
      }
      for (let q = 0; q < nJ; q++) {
        const b = q * 9;
        splatR(nT + q, J[b], J[b + 1], J[b + 2], J[b + 3], J[b + 4], J[b + 5], J[b + 6], J[b + 7], J[b + 8], JN[q * 3], JN[q * 3 + 1], JN[q * 3 + 2]);
      }
      const triR = (t, px, py, pz, out) => {
        if (t < nT) return tri(t, px, py, pz, out);
        const b = (t - nT) * 9;
        closest(px, py, pz, J[b], J[b + 1], J[b + 2], J[b + 3], J[b + 4], J[b + 5], J[b + 6], J[b + 7], J[b + 8], out);
      };
      const NR = (t, c) => (t < nT ? TN[t * 3 + c] : JN[(t - nT) * 3 + c]);
      const sepR = (e1, e2, u, v) => {
        const l = Math.hypot(q2[0] - q1[0], q2[1] - q1[1], q2[2] - q1[2]);
        if (l < 1e-7) return 0;
        const cosn = NR(u, 0) * NR(v, 0) + NR(u, 1) * NR(v, 1) + NR(u, 2) * NR(v, 2);
        const lam = Math.min(1, Math.max(0, (cosn - 0.5) / 0.5));
        return (e2 - e1) / (2 * l) + (lam * l) / 2;
      };
      // the rest's fields; inside, its base also ends at the joint (U = {e > 0} there)
      for (let k = lo[2], li = 0; k <= hi[2]; k++) for (let j = lo[1]; j <= hi[1]; j++) for (let i = lo[0], gg = i + j * NX + k * SZ; i <= hi[0]; i++, gg++, li++) {
        if (isA[li] || FC[gg] !== NOF) continue;
        const u = rt1[li];
        let c = base, phi = BIG, phib = BIG;
        if (u >= 0) {
          const px = o0[0] + i * H, py = o0[1] + j * H, pz = o0[2] + k * H, e1 = rd1[li];
          c = colR(u);
          triR(u, px, py, pz, q1);
          const v = rt2[li];
          if (v >= 0) { triR(v, px, py, pz, q2); phi = Math.min(BIG, sepR(e1, rd2[li], u, v)); }
          if (c === base) phib = phi;
          else {
            let pbs = BIG;
            const vb = rtb[li];
            if (vb >= 0) { triR(vb, px, py, pz, q2); pbs = Math.min(BIG, sepR(e1, rdb[li], u, vb)); }
            phib = -Math.max(phi, pbs);
          }
        }
        // outside, next to a solid's node (the air under a solid's tip hovering over the rest): the solid's values, or
        // the rest's base would pull the solid's surface in there (U = {e > 0} on both sides of that air)
        if (!ins[gg] && c === base) {
          let mA = -1;
          for (let dk = -1; dk <= 1 && mA < 0; dk++) for (let dj = -1; dj <= 1 && mA < 0; dj++) for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj, kk = k + dk;
            if (ii < lo[0] || ii > hi[0] || jj < lo[1] || jj > hi[1] || kk < lo[2] || kk > hi[2]) continue;
            const g2 = gg + di + dj * NX + dk * SZ;
            if (ins[g2] && isA[li + di + dj * sx + dk * sxy]) { mA = sol[g2]; break; }
          }
          if (mA >= 0) { L1[gg] = solids[mA].color; PHI[gg] = eS[li] - gF + cl / 2; PHIB[gg] = cl / 2 - eS[li]; continue; }
        }
        L1[gg] = c;
        if (ins[gg]) {
          const e = Math.min(eS[li], 0), z = tq * (S[gg] < 0 ? 0 : S[gg] > D ? D : S[gg]);
          if (c === base) PHI[gg] = PHIB[gg] = Math.min(phi, cl / 2 - z - e);
          else { PHI[gg] = phi; PHIB[gg] = phib; }
          if (e > B[gg]) B[gg] = e;
        } else { PHI[gg] = phi; PHIB[gg] = phib; }
      }
    }
  }

  // ---- level sets: cover of colour c = {B > gF, ψc > cl/2}; region taken from the base U = {B > 0, ψbase < cl/2}
  //      ψc = ±PHI − draft·depth (covers narrow down with depth), ψbase = PHIB + draft·depth
  const zd = (s) => (s < 0 ? 0 : s > D ? D : s);
  const field = (box, fn) => {
    const [i0, j0, k0] = box[0], [i1, j1, k1] = box[1];
    return (p) => {
      const fx = (p[0] - o0[0]) / H, fy = (p[1] - o0[1]) / H, fz = (p[2] - o0[2]) / H;
      if (fx <= i0 + 0.5 || fy <= j0 + 0.5 || fz <= k0 + 0.5 || fx >= i1 - 0.5 || fy >= j1 - 0.5 || fz >= k1 - 0.5) return -1;
      const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), u = fx - i, v = fy - j, s = fz - k;
      const g = i + j * NX + k * SZ;
      let bS = 0, sS = 0, pS = 0;
      for (let c8 = 0; c8 < 8; c8++) {
        const di = c8 & 1, dj = (c8 >> 1) & 1, dk = c8 >> 2, n = g + di + dj * NX + dk * SZ;
        const wgt = (di ? u : 1 - u) * (dj ? v : 1 - v) * (dk ? s : 1 - s);
        bS += wgt * B[n]; sS += wgt * S[n]; pS += wgt * fn(n);
      }
      const val = Math.min(bS, pS, sS + 2 * H);
      return Number.isFinite(val) ? val : -1;
    };
  };
  const boxOf = (test) => {
    const lo = [NX, NY, NZ], hi = [-1, -1, -1];
    for (let k = 0, gg = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++, gg++) {
      if (!test(gg)) continue;
      if (i < lo[0]) lo[0] = i; if (i > hi[0]) hi[0] = i;
      if (j < lo[1]) lo[1] = j; if (j > hi[1]) hi[1] = j;
      if (k < lo[2]) lo[2] = k; if (k > hi[2]) hi[2] = k;
    }
    if (hi[0] < 0) return null;
    return [[Math.max(0, lo[0] - 2), Math.max(0, lo[1] - 2), Math.max(0, lo[2] - 2)], [Math.min(NX - 1, hi[0] + 2), Math.min(NY - 1, hi[1] + 2), Math.min(NZ - 1, hi[2] + 2)]];
  };
  const bounds = (box) => ({ min: box[0].map((x, q) => o0[q] + x * H), max: box[1].map((x, q) => o0[q] + x * H) });

  const parts = [], smalls = [];
  const covCols = used.filter((c) => c !== base);
  progress('Tallado: base', 0.6);
  const boxU = boxOf((gg) => PHIB[gg] + tq * zd(S[gg]) < cl / 2);
  let body = M, U = null;
  if (boxU) {
    const fU = field(boxU, (q) => cl / 2 - PHIB[q] - tq * zd(S[q]));
    U = keep(Manifold.levelSet(fU, bounds(boxU), H, 0));
    if (U.isEmpty()) U = null;
    else body = keep(M.subtract(U));
  }
  // the base beyond a piece along its slide direction (deeper than a pocket's own walls) blocks it; other colour
  // pieces there do not (a ribbon behind a bow's knot goes in first, the knot after it)
  const far = farView(body.getMesh(), D + 2 * H);
  covCols.forEach((c, n) => {
    progress('Tallado: piezas de color', 0.62 + (0.18 * n) / covCols.length);
    const box = boxOf((gg) => L1[gg] === c);
    if (!box) return;
    // B − gF and ψc − cl/2 share one min(): fold the offsets into the node values
    const fn = (q) => (L1[q] === c ? PHI[q] : -PHI[q]) - tq * zd(S[q]) - cl / 2 + gF;
    const f0 = field(box, fn);
    const L = keep(Manifold.levelSet((p) => f0(p) - gF, bounds(box), H, 0));
    if (L.isEmpty()) return;
    const cov = keep(M.intersect(L));
    for (const q of unpinched(w, cov, keep).decompose()) {
      keep(q);
      const vol = q.volume();
      if (vol < 0.05) continue;
      if (vol < o.carveMinPiece) { smalls.push(q); continue; }
      const hs = insertable(w, q, mIDs, cutAxis, keep, 1.6 * D, 2, far);
      // cut where it wraps round, a piece only in halves too small to handle is a speck as well
      if (hs.every((h) => h.man.volume() < o.carveMinPiece)) { smalls.push(q); continue; }
      for (const h of hs) parts.push({ kind: 'cover', color: c, man: h.man, up: h.up, catch: h.catch, blocked: h.blocked, share: h.share, ring: h.ring });
    }
  });

  progress('Tallado: piezas de la base', 0.8);
  // a recess with no piece to fill it (only specks of colour, or nothing) is not carved: the base keeps that spot whole.
  // Put back in it, a speck would be a loose crumb of base inside a groove of clearance
  let back = smalls;
  if (U) {
    const comps = solidPieces(w, U, keep, 1e-3, false).map((p) => p.man); // a hollow recess keeps its void (a base core)
    const cb = comps.map((m) => m.boundingBox());
    const inside = (p, q) => [0, 1, 2].every((e) => p.min[e] >= q.min[e] - 1e-4 && p.max[e] <= q.max[e] + 1e-4);
    // the recess a piece lies in (-1: none found)
    const home = (m) => {
      const b = m.boundingBox(), cand = [];
      for (let i = 0; i < comps.length; i++) if (inside(b, cb[i])) cand.push(i);
      if (cand.length < 2) return cand.length ? cand[0] : -1;
      const i = cand.find((k) => keep(comps[k].intersect(m)).volume() > 1e-3);
      return i === undefined ? -1 : i;
    };
    const own = new Set(parts.map((p) => home(p.man)));
    // (slivers of the level set under 0.05 mm³ are not worth carving the base again)
    const drop = comps.map((c, i) => !own.has(i) && c.volume() > 0.05);
    if (!own.has(-1) && drop.some(Boolean)) {
      const taken = comps.filter((_, i) => !drop[i]);
      body = taken.length ? keep(M.subtract(taken.length > 1 ? keep(Manifold.union(taken)) : taken[0])) : M;
      back = smalls.filter((s) => { const h = home(s); return h < 0 || !drop[h]; });
    }
  }
  if (back.length) body = keep(Manifold.union([body, ...back]));
  // each piece keeps its voids (the gap of a print-in-place joint); pieces locked together print together, as modelled
  const bodies = solidPieces(w, unpinched(w, body, keep), keep, 0.5).sort((a, b) => b.man.volume() - a.man.volume());
  if (bodies.length > 1) warnings.push(`La base quedó en ${bodies.length} piezas`);
  const joined = bodies.filter((q) => q.n > 1).length;
  if (joined) warnings.push(`Tallado: ${joined} grupo(s) de la base van trabados (articulaciones): se imprimen juntos, tal como están en el modelo`);
  for (const q of bodies.reverse()) parts.unshift({ kind: 'body', color: base, man: q.man, up: q.up });
  if (smalls.length) warnings.push(`${smalls.length} trocito(s) de color < ${o.carveMinPiece} mm³ quedan del color base`);
  // blocked at an edge only (an arm over a little of a mitten's half), a piece goes in with some pressure; blocked
  // further, or a ring round some of the base, it cannot go in as it is
  const shut = (p) => p.blocked && (p.ring || p.share > 0.05);
  const stuck = parts.filter((p) => p.catch > 0.05 && !shut(p)).length;
  if (stuck) warnings.push(`Tallado: ${stuck} pieza(s) de color pueden necesitar presión al encajar`);
  const nShut = parts.filter(shut).length;
  if (nShut) warnings.push(`Tallado: ${nShut} pieza(s) de color tienen parte de la base delante en todas las direcciones: revisa cómo entran antes de imprimir`);
  if (walled) warnings.push(`Tallado: ${walled} triángulos de paredes de menos de ${+(o.minWall + cl).toFixed(2)} mm con un color en cada cara quedaron de un solo color`);
  if (thinned) warnings.push(`Tallado: ${thinned} triángulos de trazos de color de menos de ${o.carveMinWidth ?? 0.6} mm de ancho pasaron al color vecino`);
  if (fixed) warnings.push(`Tallado: ${fixed} triángulos de islas de color < ${o.minArea} mm² pasaron al color vecino`);
  warnings.push(`Tallado: capa de color de ${D} mm hacia dentro (rejilla ${H.toFixed(2)} mm, holgura ${cl} mm)`);
  return parts;
}

// Boolean results can hold specks and voids that touch the rest at a single vertex, so decompose() keeps them in the
// piece; rebuilding the manifold from its mesh splits those pinched vertices and they come out as separate components
function unpinched(w, m, keep) {
  return keep(new w.Manifold(m.getMesh()));
}

// outer (visible) faces of a piece = faces that come from the original surface; the piece slides in along the mean
// normal of that face. A piece that wraps around the core (faces both front and back, catches when slid in) is cut
// on the plane where its visible face turns sideways, so each half slides in from its own side.
function pieceInfo(m, mIDs, axis, far = null) {
  const g = m.getMesh(), Pm = g.vertProperties, Tm = g.triVerts, npm = g.numProp, nTm = Tm.length / 3;
  const outer = new Uint8Array(nTm);
  for (let r = 0; r < g.runOriginalID.length; r++) if (mIDs.has(g.runOriginalID[r])) for (let t = g.runIndex[r] / 3; t < g.runIndex[r + 1] / 3; t++) outer[t] = 1;
  const up = [0, 0, 0], hn = [0, 0, 0], NA = new Float64Array(nTm * 4);
  let ap = 0, an = 0, sw = 0, sx = 0;
  for (let t = 0; t < nTm; t++) {
    const a = Tm[t * 3] * npm, b = Tm[t * 3 + 1] * npm, c = Tm[t * 3 + 2] * npm;
    const u = [Pm[b] - Pm[a], Pm[b + 1] - Pm[a + 1], Pm[b + 2] - Pm[a + 2]], v = [Pm[c] - Pm[a], Pm[c + 1] - Pm[a + 1], Pm[c + 2] - Pm[a + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]);
    NA[t * 4] = l ? n[0] / l : 0; NA[t * 4 + 1] = l ? n[1] / l : 0; NA[t * 4 + 2] = l ? n[2] / l : 0; NA[t * 4 + 3] = l / 2;
    if (!outer[t]) { for (let k = 0; k < 3; k++) hn[k] += n[k] / 2; continue; }
    for (let k = 0; k < 3; k++) up[k] += n[k] / 2;
    if (axis && l) {
      const na = (n[0] * axis[0] + n[1] * axis[1] + n[2] * axis[2]) / l;
      if (na > 0) ap += (l / 2) * na; else an -= (l / 2) * na;
      const wt = (l / 2) * Math.max(0, 1 - Math.abs(na) / 0.35);
      const ctr = [(Pm[a] + Pm[b] + Pm[c]) / 3, (Pm[a + 1] + Pm[b + 1] + Pm[c + 1]) / 3, (Pm[a + 2] + Pm[b + 2] + Pm[c + 2]) / 3];
      sw += wt; sx += wt * (ctr[0] * axis[0] + ctr[1] * axis[1] + ctr[2] * axis[2]);
    }
  }
  // share of the hidden faces that would push into the base when the piece slides out along d
  const catchOf = (d) => {
    let bad = 0, tot = 0;
    for (let t = 0; t < nTm; t++) {
      if (outer[t]) continue;
      const ar = NA[t * 4 + 3], nd = NA[t * 4] * d[0] + NA[t * 4 + 1] * d[1] + NA[t * 4 + 2] * d[2];
      tot += ar;
      if (nd > 0.2) bad += ar;
    }
    return tot ? bad / tot : 0;
  };
  // slide direction: the mean visible normal (a skin), else away from the mean hidden face (a solid piece seen from
  // every side, glued on one face), else the best main axis
  const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return l > 1e-9 ? v.map((x) => x / l) : null; };
  const cands = [unit(up), unit(hn.map((x) => -x)), [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]].filter(Boolean);
  let d = cands[0] || [0, 0, 1], best = catchOf(d);
  for (const c of cands.slice(1)) {
    if (best <= 0.005) break;
    const k = catchOf(c);
    if (k < best - 0.005) { best = k; d = c; }
  }
  // the base further along d (a scarf round a straight neck slides into the head): another direction that catches no
  // more and is free, else the least blocked one and the piece counts as caught (it is cut). Checked at any catch, so
  // that cuts compare fairly; blocked pieces rank by their blocked share (a ring round an arm loses to halves that
  // the cut opens at the arm)
  let blocked = false, share = 0, ring = false;
  if (far && (share = far(g, d)) > 0.02) {
    blocked = true;
    const lim = Math.max(best, 0.03);
    const alt = cands.filter((c) => c !== d).map((c) => ({ c, k: catchOf(c) })).filter((x) => x.k <= lim).sort((a, b) => a.k - b.k);
    let bd = d;
    for (const { c, k } of alt) {
      const s = far(g, c);
      if (s <= 0.02) { d = c; best = k; blocked = false; share = s; break; }
      if (s < share - 0.005) { share = s; bd = c; }
    }
    // no free direction: the least blocked one. A ring round some of the base cannot come off it at all
    if (blocked) { d = bd; ring = m.genus() > 0; best = 1 + share + (ring ? 1 : 0); }
  }
  // centre of the faces that catch along d (a cut through them frees the piece)
  const at = [0, 0, 0];
  let ab = 0;
  for (let t = 0; t < nTm; t++) {
    if (outer[t] || NA[t * 4] * d[0] + NA[t * 4 + 1] * d[1] + NA[t * 4 + 2] * d[2] <= 0.2) continue;
    const ar = NA[t * 4 + 3], a = Tm[t * 3] * npm, b = Tm[t * 3 + 1] * npm, c = Tm[t * 3 + 2] * npm;
    for (let k = 0; k < 3; k++) at[k] += (ar * (Pm[a + k] + Pm[b + k] + Pm[c + k])) / 3;
    ab += ar;
  }
  return { up: d, ap, an, mid: sw > 0 ? sx / sw : null, catch: best, at: ab > 0 ? at.map((x) => x / ab) : null, blocked, share, ring };
}

const fit = (man, i) => ({ man, up: i.up, catch: i.catch, blocked: i.blocked, share: i.share, ring: i.ring });

// A piece that catches is cut in two. A skin (thinner than solidT) wrapping the core is cut on the plane where its
// visible face turns sideways. A solid piece (a bow with a rod through it) tries that plane and x/y/z planes through
// the faces that catch or through its middle: the cut with the lowest worst catch wins, slabs much thinner than the
// piece are penalised, and halves that still catch are cut once more.
function insertable(w, q, mIDs, axis, keep, solidT = Infinity, depth = 2, far = null) {
  const i0 = pieceInfo(q, mIDs, axis, far);
  const whole = [fit(q, i0)];
  if (i0.catch <= 0.03 || depth <= 0) return whole;
  const vol = q.volume(), area = q.surfaceArea(), t0 = area > 0 ? (2 * vol) / area : 0;
  const planes = [];
  if (axis && i0.mid !== null && Math.min(i0.ap, i0.an) >= 0.1 * (i0.ap + i0.an)) planes.push([axis, i0.mid]);
  if (t0 < solidT) {
    // when a half still catches or is blocked (the inner half of a leg would slide into the other leg), the planes
    // where the visible face turns sideways along the other main axes are tried too: one of them wins if it is better
    let best = null;
    const axes = [axis, [1, 0, 0], [0, 1, 0], [0, 0, 1]].filter((a, i, l) => a && l.findIndex((b) => b && Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) > 0.9) === i);
    for (const ax of axes) {
      const ii = ax === axis ? i0 : pieceInfo(q, mIDs, ax);
      if (ii.mid === null || Math.min(ii.ap, ii.an) < 0.1 * (ii.ap + ii.an)) continue;
      const out = [];
      for (const h of q.splitByPlane(ax, ii.mid)) {
        keep(h);
        for (const p of unpinched(w, h, keep).decompose()) {
          keep(p);
          if (p.volume() < 0.05) continue;
          out.push(fit(p, pieceInfo(p, mIDs, axis, far)));
        }
      }
      if (!out.length) continue;
      const score = Math.max(...out.map((o) => o.catch));
      if (ax === axis || score < (best ? best.score : i0.catch) - 1e-3) best = { score, out };
      if (best && best.score <= 0.03) break;
    }
    return best ? best.out : whole;
  }
  const bb = q.boundingBox();
  for (let k = 0; k < 3; k++) {
    const n = [0, 0, 0];
    n[k] = 1;
    if (i0.at) planes.push([n, i0.at[k]]);
    planes.push([n, (bb.min[k] + bb.max[k]) / 2]);
  }
  let best = null;
  for (const [n, off] of planes) {
    const out = [];
    for (const h of q.splitByPlane(n, off)) {
      keep(h);
      for (const p of unpinched(w, h, keep).decompose()) {
        keep(p);
        const pv = p.volume(), pa = p.surfaceArea();
        if (pv < 0.05) continue;
        out.push({ ...fit(p, pieceInfo(p, mIDs, axis, far)), vol: pv, t: pa > 0 ? (2 * pv) / pa : 0 });
      }
    }
    if (out.length < 2) continue;
    let score = Math.max(...out.map((o) => o.catch));
    for (const o of out) if (t0 > 0 && o.t < 0.6 * t0) score += ((0.6 * t0 - o.t) / t0) * (o.vol / vol) * 2;
    if (!best || score < best.score - 1e-3) best = { score, out };
  }
  if (!best || best.score >= i0.catch) return whole;
  return best.out.flatMap((o) => (o.catch > 0.03 ? insertable(w, o.man, mIDs, axis, keep, solidT, depth - 1, far) : [fit(o.man, o)]));
}
