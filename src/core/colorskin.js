// Outer colour skins. Legacy 'skin' keeps the original solid as its base.
// The preview-only 'sculpt' prototype reconstructs the core and outer envelope, smooths the paint partition,
// and fills monochrome source solids. Its assembly is not yet reliable on complex models.

import { solidPieces } from './solidparts.js';
import { blurGrid } from './gridfield.js';

// squared distance point-triangle (Ericson)
export function triDist2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; } else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; } else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v; } else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const v = d2 / (d2 - d6); qx = ax + acx * v; qy = ay + acy * v; qz = az + acz * v; } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const v = (d4 - d3) / (d4 - d3 + (d5 - d6)); qx = bx + (cx - bx) * v; qy = by + (cy - by) * v; qz = bz + (cz - bz) * v; } else {
              const dn = 1 / (va + vb + vc), v = vb * dn, ww = vc * dn;
              qx = ax + abx * v + acx * ww; qy = ay + aby * v + acy * ww; qz = az + abz * v + acz * ww;
            }
          }
        }
      }
    }
  }
  return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}

// M: the whole solid (Manifold). src: { V, T, C } original painted triangles (flat arrays, C = colour per triangle).
// Returns [{ kind: 'body'|'cover', color, man, up }].
export function buildSkin({ w, o, M, src, base, nCol, keep, warnings, progress, cutAxis, solids = [] }) {
  const owned = new Set();
  const retain = m => { owned.add(m); return m; };
  const release = m => { if (owned.delete(m)) m.delete(); };
  const checkpoint = () => new Set(owned);
  const releaseSince = (before, retained) => {
    for (const m of owned) if (!before.has(m) && !retained.has(m)) release(m);
  };
  try {
    const parts = build({ w, o, M, src, base, nCol, keep: retain, warnings, progress, cutAxis, solids, checkpoint, releaseSince });
    for (const p of parts) { owned.delete(p.man); keep(p.man); }
    return parts;
  } finally {
    for (const m of owned) m.delete();
  }
}

function build({ w, o, M, src, base, nCol, keep, warnings, progress, cutAxis, solids, checkpoint, releaseSince }) {
  const { Manifold } = w;
  const D = o.skinDepth, C2 = o.clearance / 2, smooth = o.mode === 'sculpt' ? o.skinSmooth ?? 0.6 : 0;
  if (o.mode === 'sculpt') {
    warnings.push('Vista previa experimental: el montaje del esculpido aún no es fiable; la exportación está desactivada');
  }
  const mg = M.getMesh(), MV = mg.vertProperties, MT = mg.triVerts, mnp = mg.numProp;
  const bb = M.boundingBox();
  // grid: as fine as o.skinGrid, coarser on big models (memory: one float per voxel per colour)
  const ext = [0, 1, 2].map((q) => bb.max[q] - bb.min[q] + 2 * (D + 2));
  const nUsed = new Set(src.C).size;
  const maxVox = smooth > 0 ? Math.min(14e6, 384e6 / (4 * (3 + nUsed))) : Math.min(40e6, 1.2e9 / (4 * (1 + nUsed)));
  const H = Math.max(o.skinGrid, Math.cbrt((ext[0] * ext[1] * ext[2]) / maxVox));
  const R = D + 3 * H;
  const o0 = bb.min.map((x) => x - R - H), o1 = bb.max.map((x) => x + R + H);
  const NX = Math.ceil((o1[0] - o0[0]) / H) + 1, NY = Math.ceil((o1[1] - o0[1]) / H) + 1, NZ = Math.ceil((o1[2] - o0[2]) / H) + 1, NG = NX * NY * NZ;
  const gi = (i, j, k) => (k * NY + j) * NX + i;
  const splat = (V, T, np, grid, filter, frac0, frac1, msg) => {
    const nT = T.length / 3;
    for (let t = 0; t < nT; t++) {
      if (filter && !filter(t)) continue;
      if ((t & 4095) === 0) progress(msg, frac0 + ((frac1 - frac0) * t) / nT);
      const a = T[t * 3] * np, b = T[t * 3 + 1] * np, c = T[t * 3 + 2] * np;
      const ax = V[a], ay = V[a + 1], az = V[a + 2], bx = V[b], by = V[b + 1], bz = V[b + 2], cx = V[c], cy = V[c + 1], cz = V[c + 2];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - R - o0[0]) / H)), i1 = Math.min(NX - 1, Math.ceil((Math.max(ax, bx, cx) + R - o0[0]) / H));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - R - o0[1]) / H)), j1 = Math.min(NY - 1, Math.ceil((Math.max(ay, by, cy) + R - o0[1]) / H));
      const k0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - R - o0[2]) / H)), k1 = Math.min(NZ - 1, Math.ceil((Math.max(az, bz, cz) + R - o0[2]) / H));
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) {
        let g = gi(i0, j, k);
        for (let i = i0; i <= i1; i++, g++) {
          const d = triDist2(o0[0] + i * H, o0[1] + j * H, o0[2] + k * H, ax, ay, az, bx, by, bz, cx, cy, cz);
          if (d < grid[g]) grid[g] = d;
        }
      }
    }
  };

  // signed depth field of the solid (positive inside)
  const depthField = (man, start, end, message) => {
    const mesh = man.getMesh(), F = new Float32Array(NG).fill(R * R);
    splat(mesh.vertProperties, mesh.triVerts, mesh.numProp, F, null, start, end, message);
    const L = o1[2] - o0[2] + 2;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const x = o0[0] + i * H + 1.3e-4, y = o0[1] + j * H + 0.7e-4;
      const hz = man.rayCast([x, y, o0[2] - 1], [x, y, o1[2] + 1]).map((h) => o0[2] - 1 + h.distance * L).sort((p, q) => p - q);
      const ins = new Uint8Array(NZ);
      for (let n = 0; n + 1 < hz.length; n += 2) for (let k = Math.max(0, Math.ceil((hz[n] - o0[2]) / H)); k < NZ && o0[2] + k * H < hz[n + 1]; k++) ins[k] = 1;
      for (let k = 0; k < NZ; k++) { const g = gi(i, j, k), d = Math.sqrt(F[g]); F[g] = ins[k] ? d : -d; }
    }
    return F;
  };
  const S = depthField(M, 0.15, 0.4, 'Capa exterior: distancias');
  const shapePasses = Math.max(1, Math.round(1.5 * (Math.min(smooth / 2, D / 4) / H) ** 2));

  // painted triangles that are really on the surface (buried overlapping shells carry no colour)
  progress('Capa exterior: superficie visible', 0.45);
  const { V: OV, T: OT, C: OC } = src;
  const nOT = OT.length / 3, vis = new Uint8Array(nOT);
  {
    const cell = 1, hm = new Map(), key = (a, b, c) => (a * 4096 + b) * 4096 + c;
    for (let t = 0; t < MT.length / 3; t++) {
      const lo = [0, 1, 2].map((q) => Math.floor(Math.min(MV[MT[t * 3] * mnp + q], MV[MT[t * 3 + 1] * mnp + q], MV[MT[t * 3 + 2] * mnp + q]) / cell));
      const hi = [0, 1, 2].map((q) => Math.floor(Math.max(MV[MT[t * 3] * mnp + q], MV[MT[t * 3 + 1] * mnp + q], MV[MT[t * 3 + 2] * mnp + q]) / cell));
      for (let a = lo[0]; a <= hi[0]; a++) for (let b = lo[1]; b <= hi[1]; b++) for (let c = lo[2]; c <= hi[2]; c++) {
        const k = key(a + 2048, b + 2048, c + 2048);
        let l = hm.get(k);
        if (!l) hm.set(k, (l = []));
        l.push(t);
      }
    }
    for (let t = 0; t < nOT; t++) {
      const p = [0, 1, 2].map((q) => (OV[OT[t * 3] * 3 + q] + OV[OT[t * 3 + 1] * 3 + q] + OV[OT[t * 3 + 2] * 3 + q]) / 3), c0 = p.map((x) => Math.floor(x / cell));
      let best = Infinity;
      for (let a = -1; a <= 1 && best > 1e-4; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const u of hm.get(key(c0[0] + a + 2048, c0[1] + b + 2048, c0[2] + c + 2048)) || []) {
        const A = MT[u * 3] * mnp, B = MT[u * 3 + 1] * mnp, Cc = MT[u * 3 + 2] * mnp;
        best = Math.min(best, triDist2(p[0], p[1], p[2], MV[A], MV[A + 1], MV[A + 2], MV[B], MV[B + 1], MV[B + 2], MV[Cc], MV[Cc + 1], MV[Cc + 2]));
      }
      vis[t] = best < 0.03 * 0.03 ? 1 : 0;
    }
    // overlapping shells: where a base-colour face lies on a painted one (a white body face inside the bow's
    // surface) the paint wins, else the base colour pokes through as specks
    const ph = new Map();
    const tb = (t, q) => [OV[OT[t * 3] * 3 + q], OV[OT[t * 3 + 1] * 3 + q], OV[OT[t * 3 + 2] * 3 + q]];
    for (let t = 0; t < nOT; t++) if (vis[t] && OC[t] !== base) {
      const lo = [0, 1, 2].map((q) => Math.floor(Math.min(...tb(t, q)) / cell)), hi = [0, 1, 2].map((q) => Math.floor(Math.max(...tb(t, q)) / cell));
      for (let a = lo[0]; a <= hi[0]; a++) for (let b = lo[1]; b <= hi[1]; b++) for (let c = lo[2]; c <= hi[2]; c++) {
        const k = key(a + 2048, b + 2048, c + 2048);
        let l = ph.get(k);
        if (!l) ph.set(k, (l = []));
        l.push(t);
      }
    }
    for (let t = 0; t < nOT; t++) if (vis[t] && OC[t] === base) {
      const p = [0, 1, 2].map((q) => tb(t, q).reduce((x, y) => x + y) / 3);
      for (const u of ph.get(key(Math.floor(p[0] / cell) + 2048, Math.floor(p[1] / cell) + 2048, Math.floor(p[2] / cell) + 2048)) || []) {
        const A = OT[u * 3] * 3, B = OT[u * 3 + 1] * 3, Cc = OT[u * 3 + 2] * 3;
        if (triDist2(p[0], p[1], p[2], OV[A], OV[A + 1], OV[A + 2], OV[B], OV[B + 1], OV[B + 2], OV[Cc], OV[Cc + 1], OV[Cc + 2]) < 0.02 * 0.02) { vis[t] = 0; break; }
      }
    }
  }
  // distance to each colour's visible painted area
  const area = new Float64Array(nCol);
  for (let t = 0; t < nOT; t++) if (vis[t]) {
    const a = OT[t * 3] * 3, b = OT[t * 3 + 1] * 3, c = OT[t * 3 + 2] * 3;
    const u = [0, 1, 2].map((q) => OV[b + q] - OV[a + q]), v = [0, 1, 2].map((q) => OV[c + q] - OV[a + q]);
    area[OC[t]] += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  const cols = [];
  for (let c = 0; c < nCol; c++) if (area[c] > 0) cols.push(c);
  if (!cols.includes(base)) cols.push(base);
  const G = new Map();
  cols.forEach((c, n) => {
    const f = new Float32Array(NG).fill(4 * R * R);
    const f0 = 0.5 + (0.18 * n) / cols.length;
    splat(OV, OT, 3, f, (t) => vis[t] && OC[t] === c, f0, f0 + 0.18 / cols.length, 'Capa exterior: colores');
    for (let g = 0; g < NG; g++) f[g] = Math.sqrt(f[g]);
    G.set(c, f);
  });

  if (smooth > 0) {
    const nearest = new Float32Array(NG).fill(Infinity);
    for (const F of G.values()) for (let g = 0; g < NG; g++) nearest[g] = Math.min(nearest[g], F[g] * F[g]);
    const variance = 2 * smooth * smooth, passes = Math.max(1, Math.round(1.5 * (smooth / H) ** 2));
    cols.forEach((c, i) => {
      progress('Capa exterior: esculpiendo colores', 0.7 + 0.05 * i / cols.length);
      const F = G.get(c);
      for (let g = 0; g < NG; g++) F[g] = Math.exp(-Math.max(0, F[g] * F[g] - nearest[g]) / variance);
      blurGrid(F, [NX, NY, NZ], passes);
    });
    blurGrid(S, [NX, NY, NZ], shapePasses);
  }

  const tri = (F, p, gradient = null) => {
    const fx = Math.min(NX - 1.001, Math.max(0, (p[0] - o0[0]) / H)), fy = Math.min(NY - 1.001, Math.max(0, (p[1] - o0[1]) / H)), fz = Math.min(NZ - 1.001, Math.max(0, (p[2] - o0[2]) / H));
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), u = fx - i, v = fy - j, s = fz - k;
    const g = gi(i, j, k), dy = NX, dz = NX * NY;
    if (gradient) {
      gradient[0] = (((F[g + 1] - F[g]) * (1 - v) + (F[g + dy + 1] - F[g + dy]) * v) * (1 - s) +
        ((F[g + dz + 1] - F[g + dz]) * (1 - v) + (F[g + dz + dy + 1] - F[g + dz + dy]) * v) * s) / H;
      gradient[1] = (((F[g + dy] - F[g]) * (1 - u) + (F[g + dy + 1] - F[g + 1]) * u) * (1 - s) +
        ((F[g + dz + dy] - F[g + dz]) * (1 - u) + (F[g + dz + dy + 1] - F[g + dz + 1]) * u) * s) / H;
      gradient[2] = (((F[g + dz] - F[g]) * (1 - u) + (F[g + dz + 1] - F[g + 1]) * u) * (1 - v) +
        ((F[g + dz + dy] - F[g + dy]) * (1 - u) + (F[g + dz + dy + 1] - F[g + dy + 1]) * u) * v) / H;
    }
    return ((F[g] * (1 - u) + F[g + 1] * u) * (1 - v) + (F[g + dy] * (1 - u) + F[g + dy + 1] * u) * v) * (1 - s) +
      ((F[g + dz] * (1 - u) + F[g + dz + 1] * u) * (1 - v) + (F[g + dz + dy] * (1 - u) + F[g + dz + dy + 1] * u) * v) * s;
  };
  // half the gap between the nearest other colour and colour c: > 0 where c is the closest colour
  const gradC = [0, 0, 0], gradOther = [0, 0, 0], gradient = [0, 0, 0];
  const dom = (c, p) => {
    if (smooth > 0) {
      const value = tri(G.get(c), p, gradC);
      let other = -Infinity;
      for (const k of cols) if (k !== c) {
        const v = tri(G.get(k), p, gradient);
        if (v > other) { other = v; for (let a = 0; a < 3; a++) gradOther[a] = gradient[a]; }
      }
      if (other === -Infinity) return R;
      const delta = value - other, length = Math.hypot(gradC[0] - gradOther[0], gradC[1] - gradOther[1], gradC[2] - gradOther[2]);
      return Math.max(-R, Math.min(R, delta / Math.max(1e-12, length)));
    }
    const dc = tri(G.get(c), p);
    let m = Infinity;
    for (const k of cols) if (k !== c) m = Math.min(m, tri(G.get(k), p));
    return m === Infinity ? 1 : (m - dc) / 2;
  };
  const box = { min: o0, max: o1 };
  let envelope = null;
  if (smooth > 0) {
    const raw = Manifold.levelSet(p => D + tri(S, p), box, H, 0);
    try { envelope = keep(raw.simplify(0.01)); } finally { raw.delete(); }
  }
  const core = envelope ? keep(Manifold.levelSet(p => tri(S, p) - C2, box, H, 0)) : M;
  const inner = envelope && C2 > 0 ? keep(Manifold.levelSet(p => C2 + tri(S, p), box, H, 0)) : core;
  const outerIDs = envelope ? new Set(envelope.getMesh().runOriginalID) : null;
  const filled = [], sockets = [];
  if (envelope) for (const solid of solids) {
    const F = depthField(solid.man, 0.74, 0.75, 'Esculpido: interiores de piezas solidas');
    blurGrid(F, [NX, NY, NZ], shapePasses);
    const grow = C2 + H;
    const fill = keep(Manifold.levelSet(p => grow + tri(F, p), box, H, 0));
    filled.push({ color: solid.color, man: keep(fill.intersect(envelope)) });
    sockets.push({ color: solid.color, man: keep(Manifold.levelSet(p => grow + o.clearance + tri(F, p), box, H, 0)) });
  }
  // the sdf must be finite and negative on the box faces (the grid border lies R outside the skin)
  const skinOf = (c, shift, draft = 0) => {
    const region = keep(Manifold.levelSet((p) => {
      const depth = tri(S, p), taper = smooth > 0 ? 1 - 0.75 * Math.max(0, Math.min(1, -depth / D)) : 1;
      const bound = envelope ? Math.min(D + depth + 2 * H, 2 * H - depth,
        p[0] - o0[0] - H / 2, p[1] - o0[1] - H / 2, p[2] - o0[2] - H / 2,
        o1[0] - p[0] - H / 2, o1[1] - p[1] - H / 2, o1[2] - p[2] - H / 2) : D + depth;
      const v = Math.min(bound, dom(c, p) + shift * taper - draft * Math.max(0, D + depth));
      return Number.isFinite(v) ? v : -1;
    }, box, H, 0));
    return envelope ? keep(envelope.intersect(region)) : region;
  };

  const parts = [];
  let body = core;
  const smalls = [];
  cols.forEach((c, n) => {
    if (c === base) return;
    const before = checkpoint();
    try {
      progress('Capa exterior: piezas de color', 0.75 + (0.08 * n) / cols.length);
      if (envelope) {
        const fills = filled.filter(p => p.color === c).map(p => p.man);
        let region = skinOf(c, 0), contracted = keep(skinOf(c, -C2).subtract(inner));
        if (fills.length) {
          region = keep(Manifold.union([region, ...fills]));
          contracted = keep(Manifold.union([contracted, ...fills]));
        }
        const otherSockets = sockets.filter(p => p.color !== c).map(p => p.man);
        if (otherSockets.length) contracted = keep(contracted.subtract(keep(Manifold.union(otherSockets))));
        for (const q of keep(new Manifold(region.getMesh())).decompose()) {
          keep(q);
          if (q.volume() < o.minCover) { smalls.push(q); continue; }
          const candidates = keep(new Manifold(keep(q.intersect(contracted)).getMesh())).decompose();
          const kept = candidates.filter(p => { keep(p); return p.volume() >= o.minCover; });
          if (!kept.length) { smalls.push(q); continue; }
          for (const p of kept) for (const h of splitFrontBack(w, p, fills.length ? null : cutAxis, tri, S, D, keep, outerIDs)) {
            parts.push({ kind: 'cover', color: c, man: h.man, up: h.up });
          }
        }
        return;
      }
      const cov = keep(skinOf(c, -C2).subtract(core));
      for (const q of cov.decompose()) {
        keep(q);
        if (q.volume() < o.minCover) { smalls.push(q); continue; }
        for (const h of splitFrontBack(w, q, cutAxis, tri, S, D, keep, outerIDs)) parts.push({ kind: 'cover', color: c, man: h.man, up: h.up });
      }
    } finally {
      releaseSince(before, new Set([...parts.map(p => p.man), ...smalls]));
    }
  });
  progress('Capa exterior: base', 0.83);
  body = keep(Manifold.union([core, skinOf(base, envelope ? -C2 : C2, envelope ? Math.tan(Math.PI / 6) : 0), ...smalls]));
  if (sockets.length) body = keep(body.subtract(keep(Manifold.union(sockets.map(p => p.man)))));
  const bodies = solidPieces(w, envelope ? keep(new Manifold(body.getMesh())) : body, keep, 1).sort((a, b) => b.man.volume() - a.man.volume());
  if (bodies.length > 1) warnings.push(`La base quedó en ${bodies.length} piezas`);
  for (const q of bodies) parts.unshift({ kind: 'body', color: base, man: q.man, up: q.up });
  if (smalls.length) warnings.push(`${smalls.length} trocitos de color < ${o.minCover} mm³ quedan del color base`);
  warnings.push(`${envelope ? 'Esculpido' : 'Capa exterior'}: el modelo crece aproximadamente ${D} mm por lado (rejilla ${H.toFixed(2)} mm); los agujeros pueden estrecharse ${2 * D} mm`);
  return parts;
}

// a skin that wraps around (faces both front and back) is cut on the plane where its surface turns sideways, so
// each half prints with its visible face up
function splitFrontBack(w, q, axis, tri, S, D, keep, outerIDs = null) {
  const info = (m) => {
    const g = m.getMesh(), P = g.vertProperties, T = g.triVerts, np = g.numProp;
    const outer = new Uint8Array(T.length / 3);
    if (outerIDs) for (let r = 0; r < g.runOriginalID.length; r++) {
      if (outerIDs.has(g.runOriginalID[r])) outer.fill(1, g.runIndex[r] / 3, g.runIndex[r + 1] / 3);
    }
    const up = [0, 0, 0];
    let ap = 0, an = 0, sw = 0, sx = 0;
    for (let t = 0; t < T.length / 3; t++) {
      const a = T[t * 3] * np, b = T[t * 3 + 1] * np, c = T[t * 3 + 2] * np;
      const ctr = [0, 1, 2].map((k) => (P[a + k] + P[b + k] + P[c + k]) / 3);
      if (outerIDs ? !outer[t] : tri(S, ctr) > -D / 2) continue; // only the outer (visible) face
      const u = [0, 1, 2].map((k) => P[b + k] - P[a + k]), v = [0, 1, 2].map((k) => P[c + k] - P[a + k]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      for (let k = 0; k < 3; k++) up[k] += n[k] / 2;
      if (axis) {
        const l = Math.hypot(...n) || 1, na = (n[0] * axis[0] + n[1] * axis[1] + n[2] * axis[2]) / l;
        if (na > 0) ap += (l / 2) * na; else an -= (l / 2) * na;
        const wt = (l / 2) * Math.max(0, 1 - Math.abs(na) / 0.35);
        sw += wt; sx += wt * (ctr[0] * axis[0] + ctr[1] * axis[1] + ctr[2] * axis[2]);
      }
    }
    const l = Math.hypot(...up) || 1;
    return { up: up.map((x) => x / l), ap, an, mid: sw > 0 ? sx / sw : null };
  };
  const i0 = info(q);
  if (!axis || i0.mid === null || Math.min(i0.ap, i0.an) < 0.15 * (i0.ap + i0.an)) return [{ man: q, up: i0.up }];
  const out = [];
  for (const h of q.splitByPlane(axis, i0.mid)) {
    keep(h);
    for (const p of h.decompose()) { keep(p); if (p.volume() > 0.5) out.push({ man: p, up: info(p).up }); }
  }
  return out.length ? out : [{ man: q, up: i0.up }];
}
