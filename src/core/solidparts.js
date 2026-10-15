// Closed surfaces of a boolean result. Manifold's decompose() returns each closed surface on its own, and an enclosed
// void (a hollow, the gap of a print-in-place joint) as a component of negative volume: keeping components by volume
// and uniting them again fills it, and the joint prints fused. These helpers keep such voids, and keep together what is
// locked together (a link through a ring, a print-in-place joint).

// loose specks (0 < volume ≤ minVol), tiny voids (slivers trapped between overlapping shells) and the flat zero-volume
// leftovers of booleans are left out (a void left out is filled); bigger voids stay. The kept components are joined
// without a boolean: a boolean with a flat operand leaves it in place and adds more of them
export function dropSpecks(w, M, keep, minVol = 0.5) {
  const comps = M.decompose().map(keep);
  if (comps.length < 2) return M;
  const big = comps.filter((c) => Math.abs(c.volume()) > minVol);
  if (big.length === comps.length || !big.some((c) => c.volume() > 0)) return M;
  return big.length === 1 ? big[0] : keep(concat(w, big));
}

// triangles nobody sees: the walls of enclosed voids (mesh components of negative volume) and whatever lies in a void
// (a ball caught in its socket). Their paint does not count. merged = vertex → vertex it is welded to (or null)
export function hiddenFaces(mesh, merged = null) {
  const P = mesh.vertProperties, np = mesh.numProp, T = mesh.triVerts, nT = T.length / 3, nV = P.length / np;
  if (!nT) return null;
  const par = new Int32Array(nV).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
  const vx = merged ? (i) => merged[i] : (i) => i;
  for (let t = 0; t < nT * 3; t += 3) {
    const a = find(vx(T[t])), b = find(vx(T[t + 1]));
    if (a !== b) par[a] = b;
    const c = find(vx(T[t + 2])), r = find(b);
    if (c !== r) par[c] = r;
  }
  const comp = new Int32Array(nT), id = new Map(), vol = [], lo = [], hi = [];
  const ox = P[T[0] * np], oy = P[T[0] * np + 1], oz = P[T[0] * np + 2];
  for (let t = 0; t < nT; t++) {
    const r = find(vx(T[t * 3]));
    let k = id.get(r);
    if (k === undefined) { k = vol.length; id.set(r, k); vol.push(0); lo.push([Infinity, Infinity, Infinity]); hi.push([-Infinity, -Infinity, -Infinity]); }
    comp[t] = k;
    const a = T[t * 3] * np, b = T[t * 3 + 1] * np, c = T[t * 3 + 2] * np;
    const ax = P[a] - ox, ay = P[a + 1] - oy, az = P[a + 2] - oz, bx = P[b] - ox, by = P[b + 1] - oy, bz = P[b + 2] - oz;
    const cx = P[c] - ox, cy = P[c + 1] - oy, cz = P[c + 2] - oz;
    vol[k] += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    for (const q of [a, b, c]) for (let e = 0; e < 3; e++) {
      if (P[q + e] < lo[k][e]) lo[k][e] = P[q + e];
      if (P[q + e] > hi[k][e]) hi[k][e] = P[q + e];
    }
  }
  if (!vol.some((v) => v < 0)) return null;
  const inside = (k, j) => [0, 1, 2].every((e) => lo[k][e] >= lo[j][e] - 1e-4 && hi[k][e] <= hi[j][e] + 1e-4);
  const hid = new Uint8Array(vol.length);
  for (let j = 0; j < vol.length; j++) {
    if (vol[j] >= 0) continue;
    hid[j] = 1;
    for (let k = 0; k < vol.length; k++) if (vol[k] > 0 && inside(k, j)) hid[k] = 1;
  }
  const out = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) out[t] = hid[comp[t]];
  return out;
}

// lowest and highest point of a mesh on every line along axis a through the grid g of the other two axes
function spans(g, m, a) {
  const P = m.vertProperties, np = m.numProp, T = m.triVerts, { u, v, u0, v0, s, nu, nv } = g;
  const mn = new Float32Array(nu * nv).fill(Infinity), mx = new Float32Array(nu * nv).fill(-Infinity);
  const ju = 1.3e-4, jv = 0.7e-4; // keeps the lines off mesh edges
  for (let t = 0; t < T.length; t += 3) {
    const A = T[t] * np, B = T[t + 1] * np, C = T[t + 2] * np;
    const au = P[A + u], av = P[A + v], bu = P[B + u], bv = P[B + v], cu = P[C + u], cv = P[C + v];
    const i0 = Math.max(0, Math.ceil((Math.min(au, bu, cu) - u0 - ju) / s)), i1 = Math.min(nu - 1, Math.floor((Math.max(au, bu, cu) - u0 - ju) / s));
    if (i0 > i1) continue;
    const j0 = Math.max(0, Math.ceil((Math.min(av, bv, cv) - v0 - jv) / s)), j1 = Math.min(nv - 1, Math.floor((Math.max(av, bv, cv) - v0 - jv) / s));
    if (j0 > j1) continue;
    const d = (bu - au) * (cv - av) - (cu - au) * (bv - av);
    if (Math.abs(d) < 1e-12) continue;
    for (let j = j0; j <= j1; j++) {
      const y = v0 + j * s + jv;
      for (let i = i0; i <= i1; i++) {
        const x = u0 + i * s + ju;
        const wa = ((bu - x) * (cv - y) - (cu - x) * (bv - y)) / d, wb = ((cu - x) * (av - y) - (au - x) * (cv - y)) / d, wc = 1 - wa - wb;
        if (wa < 0 || wb < 0 || wc < 0) continue;
        const z = wa * P[A + a] + wb * P[B + a] + wc * P[C + a], k = i + j * nu;
        if (z < mn[k]) mn[k] = z;
        if (z > mx[k]) mx[k] = z;
      }
    }
  }
  return { mn, mx };
}

// true when no straight slide along ±X, ±Y or ±Z takes two solids apart (a link through a ring, a print-in-place
// joint). A, B = { mesh, bb } of solids that do not overlap; h = line spacing (mm)
export function locked(A, B, h = 0.25) {
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3, v = (a + 2) % 3;
    const u0 = Math.max(A.bb.min[u], B.bb.min[u]), u1 = Math.min(A.bb.max[u], B.bb.max[u]);
    const v0 = Math.max(A.bb.min[v], B.bb.min[v]), v1 = Math.min(A.bb.max[v], B.bb.max[v]);
    if (!(u0 < u1 && v0 < v1)) return false;
    let s = h;
    while (((u1 - u0) / s + 1) * ((v1 - v0) / s + 1) > 2e6) s *= 1.5;
    const g = { u, v, u0, v0, s, nu: Math.floor((u1 - u0) / s) + 1, nv: Math.floor((v1 - v0) / s) + 1 };
    const sa = spans(g, A.mesh, a), sb = spans(g, B.mesh, a);
    let fwd = false, back = false;
    for (let k = 0; k < sa.mn.length && !(fwd && back); k++) {
      if (sa.mn[k] > sa.mx[k] || sb.mn[k] > sb.mx[k]) continue;
      if (sb.mx[k] > sa.mn[k] + 1e-3) fwd = true; // B lies ahead of A along +a on this line: A cannot slide that way
      if (sb.mn[k] < sa.mx[k] - 1e-3) back = true;
    }
    if (!fwd || !back) return false;
  }
  return true;
}

const overlaps = (p, q) => [0, 1, 2].every((e) => p.min[e] < q.max[e] && q.min[e] < p.max[e]);

// for each solid: is it locked into R (a print-in-place joint, a link through a ring)? Printed apart it could not be put
// in place. A solid may overlap R (a bow stuck on a head): only its part outside R counts. A solid touching R is glued
// on (a scarf round a neck): its pieces are cut so they slide on, so only a part with clearance all round counts.
export function lockedParts(w, solids, R, keep) {
  const rb = R.boundingBox();
  let rm = null;
  return solids.map((S) => {
    if (!S || !overlaps(S.boundingBox(), rb)) return false;
    const out = keep(S.subtract(R));
    if (out.isEmpty() || out.volume() < 1e-3) return false;
    if (!locked({ mesh: out.getMesh(), bb: out.boundingBox() }, { mesh: (rm = rm || R.getMesh()), bb: rb })) return false;
    return S.minGap(R, 0.1) > 0.02;
  });
}

// the triangles of several parts as one mesh-like soup ({ mesh, bb }, no boolean) for the slide tests
export function meshSoup(mans) {
  const gs = mans.map((m) => m.getMesh());
  let nv = 0, nt = 0;
  for (const g of gs) { nv += g.vertProperties.length / g.numProp; nt += g.triVerts.length; }
  const V = new Float32Array(nv * 3), T = new Uint32Array(nt), bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let ov = 0, ot = 0;
  for (const g of gs) {
    const np = g.numProp, P = g.vertProperties, n = P.length / np;
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
      const x = P[i * np + k];
      V[(ov + i) * 3 + k] = x;
      if (x < bb.min[k]) bb.min[k] = x;
      if (x > bb.max[k]) bb.max[k] = x;
    }
    for (let i = 0; i < g.triVerts.length; i++) T[ot + i] = g.triVerts[i] + ov;
    ov += n; ot += g.triVerts.length;
  }
  return { mesh: { vertProperties: V, triVerts: T, numProp: 3 }, bb };
}

// pieces of the solid S that slide off the rest R ({ mesh, bb }, assembled) along some axis: [S] when S does, else S
// cut through its middle across the first axis (in the order of `axes`) that frees every piece; a cut piece may be cut
// again (depth). null when no cut does. A scarf round a neck between a head and a body wider than it is locked as a
// whole: cut across a horizontal axis it comes in two halves that slide on from either side
export function slideOn(w, S, R, keep, axes = [0, 1, 2], depth = 2) {
  const bb = S.boundingBox();
  if (!R || !overlaps(bb, R.bb) || !locked({ mesh: S.getMesh(), bb }, R)) return [S];
  if (!depth) return null;
  next: for (const k of axes) {
    const n = [0, 0, 0];
    n[k] = 1;
    const halves = S.splitByPlane(n, (bb.min[k] + bb.max[k]) / 2).map(keep);
    if (halves.some((h) => h.isEmpty() || h.volume() < 0.3)) continue;
    const out = [];
    for (const h of halves) for (const p of solidPieces(w, h, keep)) {
      const q = slideOn(w, p.man, R, keep, axes, depth - 1);
      if (!q) continue next;
      out.push(...q);
    }
    return out;
  }
  return null;
}

// The model (mesh mg) seen along a slide direction d: farView(mg, tol)(pieceMesh, d) = share of the piece's footprint
// where some of the model lies more than tol beyond the piece's far face. A piece sliding out along d is blocked there
// even when nothing catches right at its seat (a scarf round a straight neck slides along the neck into the head).
export function farView(mg, tol) {
  const P = mg.vertProperties, T = mg.triVerts, np = mg.numProp, nT = T.length / 3;
  const C = new Float32Array(nT * 4); // centroid + radius of each triangle
  for (let t = 0; t < nT; t++) {
    const a = T[t * 3] * np, b = T[t * 3 + 1] * np, c = T[t * 3 + 2] * np;
    const gx = (P[a] + P[b] + P[c]) / 3, gy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, gz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    let r2 = 0;
    for (const v of [a, b, c]) r2 = Math.max(r2, (P[v] - gx) ** 2 + (P[v + 1] - gy) ** 2 + (P[v + 2] - gz) ** 2);
    C[t * 4] = gx; C[t * 4 + 1] = gy; C[t * 4 + 2] = gz; C[t * 4 + 3] = Math.sqrt(r2);
  }
  return (g, d) => {
    const s = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let e1 = [d[1] * s[2] - d[2] * s[1], d[2] * s[0] - d[0] * s[2], d[0] * s[1] - d[1] * s[0]];
    const l = Math.hypot(...e1);
    e1 = e1.map((x) => x / l);
    const e2 = [d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]];
    const GP = g.vertProperties, GT = g.triVerts, gnp = g.numProp, nV = GP.length / gnp, U = new Float64Array(nV * 3);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, t0 = Infinity;
    for (let v = 0; v < nV; v++) {
      const x = GP[v * gnp], y = GP[v * gnp + 1], z = GP[v * gnp + 2];
      const u = x * e1[0] + y * e1[1] + z * e1[2], w = x * e2[0] + y * e2[1] + z * e2[2], t = x * d[0] + y * d[1] + z * d[2];
      U[v * 3] = u; U[v * 3 + 1] = w; U[v * 3 + 2] = t;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (w < v0) v0 = w; if (w > v1) v1 = w; if (t < t0) t0 = t;
    }
    if (!(u1 > u0 && v1 > v0)) return 0;
    let h = 0.25;
    while (((u1 - u0) / h + 1) * ((v1 - v0) / h + 1) > 2.5e5) h *= 1.5;
    const nu = Math.floor((u1 - u0) / h) + 1, nv = Math.floor((v1 - v0) / h) + 1;
    const topP = new Float64Array(nu * nv).fill(-Infinity), topM = new Float64Array(nu * nv).fill(-Infinity);
    // far face per line: the largest depth at which a triangle crosses it
    const raster = (ax, ay, at, bx, by, bt, cx, cy, ct, top) => {
      const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (Math.abs(det) < 1e-12) return;
      const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - u0) / h)), i1 = Math.min(nu - 1, Math.floor((Math.max(ax, bx, cx) - u0) / h));
      const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - v0) / h)), j1 = Math.min(nv - 1, Math.floor((Math.max(ay, by, cy) - v0) / h));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = u0 + i * h, py = v0 + j * h;
        const la = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / det, lb = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / det;
        if (la < -1e-9 || lb < -1e-9 || la + lb > 1 + 1e-9) continue;
        const t = la * at + lb * bt + (1 - la - lb) * ct, k = i + j * nu;
        if (t > top[k]) top[k] = t;
      }
    };
    for (let t = 0; t < GT.length; t += 3) {
      const a = GT[t] * 3, b = GT[t + 1] * 3, c = GT[t + 2] * 3;
      raster(U[a], U[a + 1], U[a + 2], U[b], U[b + 1], U[b + 2], U[c], U[c + 1], U[c + 2], topP);
    }
    for (let t = 0; t < nT; t++) {
      const gx = C[t * 4], gy = C[t * 4 + 1], gz = C[t * 4 + 2], r = C[t * 4 + 3];
      const cu = gx * e1[0] + gy * e1[1] + gz * e1[2], cv = gx * e2[0] + gy * e2[1] + gz * e2[2];
      if (cu + r < u0 || cu - r > u1 || cv + r < v0 || cv - r > v1 || gx * d[0] + gy * d[1] + gz * d[2] + r < t0) continue;
      const q = [T[t * 3] * np, T[t * 3 + 1] * np, T[t * 3 + 2] * np].map((o) => [P[o] * e1[0] + P[o + 1] * e1[1] + P[o + 2] * e1[2], P[o] * e2[0] + P[o + 1] * e2[1] + P[o + 2] * e2[2], P[o] * d[0] + P[o + 1] * d[1] + P[o + 2] * d[2]]);
      raster(q[0][0], q[0][1], q[0][2], q[1][0], q[1][1], q[1][2], q[2][0], q[2][1], q[2][2], topM);
    }
    let n = 0, nb = 0;
    for (let k = 0; k < topP.length; k++) if (topP[k] > -Infinity) { n++; if (topM[k] > topP[k] + tol) nb++; }
    return n ? nb / n : 0;
  };
}

// one Manifold from the meshes of several components (no boolean: voids stay voids). The triangles keep their origin
// (runs, original IDs, face IDs: the paint of the shells they came from)
export function concat(w, ms) {
  const gs = ms.map((m) => m.getMesh()), np = gs[0].numProp;
  let nv = 0, nt = 0, nm = 0, nr = 0, tol = 0;
  for (const g of gs) {
    nv += g.vertProperties.length; nt += g.triVerts.length; nm += g.mergeFromVert ? g.mergeFromVert.length : 0;
    nr += g.runOriginalID ? g.runOriginalID.length : 0; tol = Math.max(tol, g.tolerance || 0);
  }
  const VP = new Float32Array(nv), TV = new Uint32Array(nt), MF = new Uint32Array(nm), MT = new Uint32Array(nm);
  const prov = gs.every((g) => g.runOriginalID && g.runOriginalID.length && g.runIndex && g.faceID && g.faceID.length * 3 === g.triVerts.length);
  const RI = new Uint32Array(nr + 1), RO = new Uint32Array(nr), RT = new Float32Array(nr * 12), FI = new Uint32Array(nt / 3);
  let ov = 0, ot = 0, om = 0, or = 0;
  for (const g of gs) {
    const b = ov / np;
    VP.set(g.vertProperties, ov);
    for (let i = 0; i < g.triVerts.length; i++) TV[ot + i] = g.triVerts[i] + b;
    const k = g.mergeFromVert ? g.mergeFromVert.length : 0;
    for (let i = 0; i < k; i++) { MF[om + i] = g.mergeFromVert[i] + b; MT[om + i] = g.mergeToVert[i] + b; }
    if (prov) {
      const r = g.runOriginalID.length;
      for (let i = 0; i < r; i++) RI[or + i] = g.runIndex[i] + ot;
      RO.set(g.runOriginalID, or);
      if (g.runTransform && g.runTransform.length === r * 12) RT.set(g.runTransform, or * 12);
      else for (let i = 0; i < r; i++) for (const j of [0, 4, 8]) RT[(or + i) * 12 + j] = 1;
      FI.set(g.faceID, ot / 3);
      or += r;
    }
    ov += g.vertProperties.length; ot += g.triVerts.length; om += k;
  }
  RI[nr] = nt;
  const opt = { numProp: np, vertProperties: VP, triVerts: TV, mergeFromVert: MF, mergeToVert: MT };
  if (prov) Object.assign(opt, { runIndex: RI, runOriginalID: RO, runTransform: RT, faceID: FI });
  if (tol > 0) opt.tolerance = tol;
  return new w.Manifold(new w.Mesh(opt));
}

// printable pieces of a solid: each closed solid with the voids inside it (and whatever lies in them). Solids locked
// together stay one piece, printed as modelled (up = +Z, n = number of solids in it). Specks and voids of |volume| ≤
// minVol are left out (a void left out is filled).
export function solidPieces(w, m, keep, minVol = 0.5, lock = true) {
  const it = [];
  for (const c of m.decompose().map(keep)) {
    const v = c.volume();
    if (Math.abs(v) > minVol) it.push({ c, v, bb: c.boundingBox() });
  }
  if (it.length === 1 && it[0].v > 0) return [{ man: it[0].c, up: null, n: 1 }];
  const n = it.length, par = it.map((_, i) => i), use = new Uint8Array(n).fill(1);
  const find = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
  const join = (a, b) => { par[find(a)] = find(b); };
  const inside = (p, q) => [0, 1, 2].every((e) => p.min[e] >= q.min[e] - 1e-4 && p.max[e] <= q.max[e] + 1e-4);
  const size = (b) => (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
  // a void goes with the smallest solid around it, and whatever lies in the void with them
  for (let i = 0; i < n; i++) {
    if (it[i].v > 0) continue;
    let best = -1;
    for (let j = 0; j < n; j++) if (it[j].v > 0 && inside(it[i].bb, it[j].bb) && (best < 0 || size(it[j].bb) < size(it[best].bb))) best = j;
    if (best < 0) { use[i] = 0; continue; }
    join(i, best);
    for (let j = 0; j < n; j++) if (j !== best && it[j].v > 0 && inside(it[j].bb, it[i].bb)) join(j, i);
  }
  const meshes = new Map(), meshOf = (i) => meshes.get(i) || meshes.set(i, it[i].c.getMesh()).get(i);
  if (lock) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (it[i].v < 0 || it[j].v < 0 || find(i) === find(j) || !overlaps(it[i].bb, it[j].bb)) continue;
    if (locked({ mesh: meshOf(i), bb: it[i].bb }, { mesh: meshOf(j), bb: it[j].bb })) join(i, j);
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) if (use[i]) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  const out = [];
  for (const g of groups.values()) {
    const nPos = g.filter((i) => it[i].v > 0).length;
    if (!nPos) continue;
    out.push({ man: g.length === 1 ? it[g[0]].c : keep(concat(w, g.map((i) => it[i].c))), up: nPos > 1 ? [0, 0, 1] : null, n: nPos });
  }
  return out;
}
