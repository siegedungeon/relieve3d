// Color separation for multicolor 3D models.
// Turns a painted / multi-part model into single-color printable parts that glue back together:
//  - solid color volumes (separate shells, e.g. a bow) → own part; the base body gets a socket where they sink in
//  - painted surface areas (e.g. swirls) → a few curved inlay shells (constant thickness along their insertion
//    axis, the visible face is the original surface) + matching pockets in the body
// Geometry booleans use manifold-3d (WASM). Units: mm.

export const DEFAULT_SPLIT = {
  clearance: 0.15, // total gap between an inlay/part and its pocket (mm)
  depth: 1.6, // minimum inlay shell thickness, measured along the surface normal (mm)
  maxAngle: 75, // max surface-normal deviation from the insertion axis inside one inlay (deg)
  maxPocket: 6, // max shell thickness along the insertion axis (steep sides need more to keep `depth`) (mm)
  minWall: 0.8, // material that must remain under every pocket, along the insertion axis (mm)
  minSkin: 0.8, // thinnest colour layer kept where the wall is too thin for a full inlay (rims, creases) (mm)
  minTile: 40, // avoid creating inlay pieces smaller than this (mm²)
  smooth: 0.3, // edge smoothing radius (mm): removes steps, spikes and slivers
  minFeature: 0.8, // painted areas (and gaps between them) thinner than this are dropped (can't be printed)
  coverFeature: 0.3, // covers mode: thinner clean-up so stripe tips still meet (covers are glued, not inlaid)
  minArea: 2, // painted islands smaller than this (mm²) are dropped
  baseColor: -1, // -1 = auto (biggest volume)
  mode: 'covers', // 'covers': intact base + thin colour covers glued on top | 'inlays': deep inlays (optionally cut in halves)
  borderSmooth: 0.8, // covers: smoothing radius of the colour borders (mm): removes the zigzag of the painted triangles
  plate: 256, // printer bed size for layout (mm)
  gap: 3, // spacing between parts on the bed (mm)
  labels: true, // engrave each inlay's number (mirrored) on its hidden glued face
  minCover: 20, // covers: colour pieces smaller than this (mm³) are not printed, the base keeps that spot
  minFragment: 100, // plane mode: detached inlay fragments below this volume (mm³) are not printed
  solidCovers: true, // covers mode: a solid colour part (a bow) gets a base-colour core fused to the base + glued colour covers
  planeCut: true, // cut everything by a vertical plane into a front and a back half: every colour piece slides in
  //                 straight from the front or from the back, and the pieces split exactly at the cut
};

const ccw = (q) => { let a = 0; for (let i = 0; i < q.length; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % q.length]; a += x1 * y2 - x2 * y1; } return a > 0; };

// 7-segment digits as rectangles (box 0.6h × h, origin bottom-left)
const SEGS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
function digitRects(txt, h) {
  const w = 0.6 * h, s = Math.max(0.6, 0.18 * h), gap = Math.max(0.6, 0.3 * h), H2 = h / 2;
  const R = { a: [0, h - s, w, h], b: [w - s, H2 - s / 2, w, h], c: [w - s, 0, w, H2 + s / 2], d: [0, 0, w, s], e: [0, 0, s, H2 + s / 2], f: [0, H2 - s / 2, s, h], g: [0, H2 - s / 2, w, H2 + s / 2] };
  const out = [];
  [...txt].forEach((ch, i) => {
    const x0 = i * (w + gap);
    for (const k of SEGS[+ch]) { const [a, b, c, d] = R[k]; out.push([x0 + a, b, x0 + c, d]); }
  });
  return { rects: out, W: txt.length * w + (txt.length - 1) * gap, H: h };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

function frameFor(n) {
  const ref = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(ref, n));
  const v = cross(n, u);
  return { u, v, n };
}
// column-major 4x4: local (x,y,z) → world x*u + y*v + z*n + o
const frameMat = (f, o = [0, 0, 0]) => [f.u[0], f.u[1], f.u[2], 0, f.v[0], f.v[1], f.v[2], 0, f.n[0], f.n[1], f.n[2], 0, o[0], o[1], o[2], 1];

// ---------- mesh helpers ----------
function shellsOf(V, T) {
  const nT = T.length / 3;
  const par = new Int32Array(V.length / 3).map((_, i) => i);
  const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < nT; t++) {
    const a = f(T[t * 3]), b = f(T[t * 3 + 1]), c = f(T[t * 3 + 2]);
    par[b] = a; par[f(c)] = f(a);
  }
  const groups = new Map();
  for (let t = 0; t < nT; t++) {
    const r = f(T[t * 3]);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }
  return [...groups.values()];
}

function triStats(V, T, tris) {
  let vol = 0, area = 0;
  for (const t of tris) {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const p = [V[a], V[a + 1], V[a + 2]], q = [V[b], V[b + 1], V[b + 2]], r = [V[c], V[c + 1], V[c + 2]];
    vol += dot(p, cross(q, r)) / 6;
    area += Math.hypot(...cross(sub(q, p), sub(r, p))) / 2;
  }
  return { vol, area };
}

function subMesh(V, T, tris, flip = false) {
  const map = new Map();
  const vp = [], tv = new Uint32Array(tris.length * 3);
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const vi = T[t * 3 + k];
      let j = map.get(vi);
      if (j === undefined) { j = vp.length / 3; map.set(vi, j); vp.push(V[vi * 3], V[vi * 3 + 1], V[vi * 3 + 2]); }
      tv[i * 3 + (flip && k ? 3 - k : k)] = j;
    }
  });
  return { vertProperties: new Float32Array(vp), triVerts: tv };
}

function toManifold(w, m, id = -1) {
  // explicit run id + faceID: keeps the link from boolean results back to the source triangle (and its color)
  const n = m.triVerts.length;
  const opt = { numProp: 3, vertProperties: m.vertProperties, triVerts: m.triVerts, faceID: new Uint32Array(n / 3).map((_, i) => i) };
  if (id >= 0) { opt.runIndex = new Uint32Array([0, n]); opt.runOriginalID = new Uint32Array([id]); }
  const mesh = new w.Mesh(opt);
  mesh.merge();
  const man = new w.Manifold(mesh);
  return man;
}

export function manifoldToMesh(man) {
  const m = man.getMesh();
  const np = m.numProp;
  const nV = m.vertProperties.length / np;
  const V = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) { V[i * 3] = m.vertProperties[i * np]; V[i * 3 + 1] = m.vertProperties[i * np + 1]; V[i * 3 + 2] = m.vertProperties[i * np + 2]; }
  return { V, T: new Uint32Array(m.triVerts) };
}

// move every vertex along its (area-weighted) normal; d < 0 shrinks
function offsetVerts(mesh, d) {
  const { vertProperties: P, triVerts: T } = mesh;
  const N = new Float32Array(P.length);
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
    const n = cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
    for (const i of [a, b, c]) { N[i] += n[0]; N[i + 1] += n[1]; N[i + 2] += n[2]; }
  }
  const out = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    out[i] = P[i] + (N[i] / l) * d; out[i + 1] = P[i + 1] + (N[i + 1] / l) * d; out[i + 2] = P[i + 2] + (N[i + 2] / l) * d;
  }
  return { vertProperties: out, triVerts: T };
}

// ---------- analysis ----------
// model: { palette, names, parts: [{ V, T, tc }] }
export function analyzeModel(model) {
  const shells = [];
  const colorArea = new Array(model.palette.length).fill(0);
  const colorVol = new Array(model.palette.length).fill(0);
  for (const p of model.parts) {
    for (const tris of shellsOf(p.V, p.T)) {
      const st = triStats(p.V, p.T, tris);
      const hist = new Array(model.palette.length).fill(0);
      for (const t of tris) {
        const a = p.T[t * 3] * 3, b = p.T[t * 3 + 1] * 3, c = p.T[t * 3 + 2] * 3;
        const ar = Math.hypot(...cross([p.V[b] - p.V[a], p.V[b + 1] - p.V[a + 1], p.V[b + 2] - p.V[a + 2]], [p.V[c] - p.V[a], p.V[c + 1] - p.V[a + 1], p.V[c + 2] - p.V[a + 2]])) / 2;
        hist[p.tc[t]] += ar;
      }
      let dom = 0;
      hist.forEach((v, i) => { if (v > hist[dom]) dom = i; });
      hist.forEach((v, i) => { colorArea[i] += v; });
      colorVol[dom] += Math.abs(st.vol);
      shells.push({ part: p, tris, vol: st.vol, area: st.area, hist, dom, purity: hist[dom] / (st.area || 1), thickness: Math.abs(st.vol) / (st.area || 1) * 3 });
    }
  }
  let base = 0;
  colorVol.forEach((v, i) => { if (v > colorVol[base]) base = i; });
  return { shells, colorArea, colorVol, base };
}

// ---------- main ----------
export function splitColors(w, model, options = {}, progress = () => {}) {
  const o = { ...DEFAULT_SPLIT, ...options };
  const { Manifold, CrossSection } = w;
  const ana = analyzeModel(model);
  const base = o.baseColor >= 0 ? o.baseColor : ana.base;
  const garbage = [];
  const keep = (m) => { garbage.push(m); return m; };
  const warnings = [];

  // 1) classify shells: thick single-color shells of a non-base color become separate solid parts
  const solids = [], rest = [];
  for (const s of ana.shells) {
    if (Math.abs(s.vol) < 1e-6) continue;
    const isSolid = s.dom !== base && s.purity > 0.9 && s.thickness > 0.6 && Math.abs(s.vol) > 5;
    (isSolid ? solids : rest).push(s);
  }
  progress('Uniendo cuerpo', 0.05);
  const idToShell = new Map();
  const bigVol = Math.max(...rest.map((s) => Math.abs(s.vol)));
  const restMans = rest.map((s) => {
    const id = Manifold.reserveIDs(1);
    idToShell.set(id, s); // (asOriginal() would renumber faceIDs by coplanar groups)
    let sm = subMesh(s.part.V, s.part.T, s.tris, s.vol < 0);
    // overlays (skins, decals) are grown 0.05 mm so they fuse with the body instead of leaving hair-thin gaps
    if (Math.abs(s.vol) < bigVol) sm = offsetVerts(sm, 0.05);
    return keep(toManifold(w, sm, id));
  });
  if (!restMans.length) throw new Error('No se encontró un cuerpo base');
  let M = keep(Manifold.union(restMans));
  // drop internal voids left between overlapping shells
  const comps = M.decompose().map(keep);
  if (comps.length > 1) M = keep(Manifold.union(comps.filter((c) => c.volume() > 0.5)));
  const solidMans = solids.map((s) => keep(toManifold(w, subMesh(s.part.V, s.part.T, s.tris, s.vol < 0))));
  const solidUnion = solidMans.length ? keep(Manifold.union(solidMans)) : null;

  // 2) colored surface triangles of the base body
  progress('Detectando zonas pintadas', 0.12);
  const mm = M.getMesh();
  const P = mm.vertProperties, np = mm.numProp, TV = mm.triVerts;
  const nT = TV.length / 3;
  const triColor = new Int16Array(nT).fill(base);
  for (let r = 0; r < mm.runOriginalID.length; r++) {
    const s = idToShell.get(mm.runOriginalID[r]);
    if (!s) continue;
    for (let t = mm.runIndex[r] / 3; t < mm.runIndex[r + 1] / 3; t++) triColor[t] = s.part.tc[s.tris[mm.faceID[t]]];
  }
  const vpos = (i) => [P[i * np], P[i * np + 1], P[i * np + 2]];
  const C = new Float64Array(nT * 3), N = new Float64Array(nT * 3), A = new Float64Array(nT);
  for (let t = 0; t < nT; t++) {
    const a = vpos(TV[t * 3]), b = vpos(TV[t * 3 + 1]), c = vpos(TV[t * 3 + 2]);
    const n = cross(sub(b, a), sub(c, a));
    const l = Math.hypot(...n);
    A[t] = l / 2;
    for (let k = 0; k < 3; k++) { C[t * 3 + k] = (a[k] + b[k] + c[k]) / 3; N[t * 3 + k] = l ? n[k] / l : 0; }
  }
  // triangle adjacency through shared (merged) vertices
  const edgeMap = new Map();
  const merged = new Uint32Array(P.length / np).map((_, i) => i);
  if (mm.mergeFromVert) for (let i = 0; i < mm.mergeFromVert.length; i++) merged[mm.mergeFromVert[i]] = mm.mergeToVert[i];
  const nbr = Array.from({ length: nT }, () => []);
  for (let t = 0; t < nT; t++) {
    for (let k = 0; k < 3; k++) {
      const a = merged[TV[t * 3 + k]], b = merged[TV[t * 3 + (k + 1) % 3]];
      const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      const o2 = edgeMap.get(key);
      if (o2 === undefined) edgeMap.set(key, t);
      else { nbr[t].push(o2); nbr[o2].push(t); }
    }
  }
  // smoothed normals: ignore tiny steps (e.g. the side walls of a 0.4 mm painted skin)
  const SN = new Float64Array(N);
  for (let it = 0; it < 12; it++) {
    const nx = new Float64Array(nT * 3);
    for (let t = 0; t < nT; t++) {
      let x = SN[t * 3] * A[t], y = SN[t * 3 + 1] * A[t], z = SN[t * 3 + 2] * A[t];
      for (const q of nbr[t]) { x += SN[q * 3] * A[q]; y += SN[q * 3 + 1] * A[q]; z += SN[q * 3 + 2] * A[q]; }
      const l = Math.hypot(x, y, z) || 1;
      nx[t * 3] = x / l; nx[t * 3 + 1] = y / l; nx[t * 3 + 2] = z / l;
    }
    SN.set(nx);
  }
  const regions = [];
  const seen = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) {
    if (seen[t] || triColor[t] === base) continue;
    const col = triColor[t], list = [t];
    seen[t] = 1;
    for (let i = 0; i < list.length; i++) for (const q of nbr[list[i]]) if (!seen[q] && triColor[q] === col) { seen[q] = 1; list.push(q); }
    let area = 0;
    for (const q of list) area += A[q];
    if (area < o.minArea) continue;
    regions.push({ color: col, tris: list, area });
  }

  // wall thickness under every painted triangle (ray cast inwards) → how deep a pocket can go
  progress('Midiendo espesores', 0.15);
  const thickBody = solidUnion ? keep(M.subtract(solidUnion)) : M;
  const TH = new Float64Array(nT).fill(99);
  for (const r of regions) for (const t of r.tris) {
    const c = [C[t * 3], C[t * 3 + 1], C[t * 3 + 2]], n = [SN[t * 3], SN[t * 3 + 1], SN[t * 3 + 2]];
    const hits = thickBody.rayCast(sub(c, scl(n, 0.02)), sub(c, scl(n, 40)));
    TH[t] = hits.length ? hits[0].distance * 39.98 + 0.02 : 40; // distance is a fraction of the segment
  }

  const thList = [];
  for (const r of regions) for (const t of r.tris) thList.push(TH[t]);
  thList.sort((a, b) => a - b);
  const thPct = [0.02, 0.1, 0.5, 0.9].map((q) => +(thList[Math.floor(q * (thList.length - 1))] || 0).toFixed(2));

  if (o.mode === 'covers') {
    // front/back axis (thinnest horizontal one, towards the paint): covers that wrap around split on the silhouette
    let cutAxis = null;
    if (regions.length) {
      const bx = M.boundingBox();
      const axI = bx.max[0] - bx.min[0] <= bx.max[1] - bx.min[1] ? 0 : 1;
      let sN = 0;
      for (const r of regions) for (const t of r.tris) sN += N[t * 3 + axI] * A[t];
      cutAxis = [0, 0, 0];
      cutAxis[axI] = sN > 0 ? 1 : -1;
    }
    const parts = buildCovers({ w, o, M, mm, TV, nT, A, N, SN, triColor, merged, base, solidUnion, TH, keep, warnings, progress, cutAxis, thickBody });
    const cored = o.solidCovers && solidUnion ? coverSolids({ w, o, M, solids, solidMans, parts, cutAxis: cutAxis || [0, 1, 0], keep, progress }) : [];
    return finishParts({ w, o, model, parts, solids: solids.filter((s) => !cored.includes(s)), base, keep, garbage, warnings, progress, info: { regions: regions.length, tiles: parts.filter((p) => p.kind === 'cover').length, thickness: thPct, covers: true, cut: null } });
  }

  // front/back cut: the thinnest horizontal axis, front = the side the paint faces; the plane goes where the fewest
  // painted faces look the wrong way (through the centres of round parts → the cut follows their silhouette)
  let cut = null;
  if (o.planeCut && regions.length) {
    const bx = M.boundingBox();
    const axI = bx.max[0] - bx.min[0] <= bx.max[1] - bx.min[1] ? 0 : 1;
    let sN = 0;
    for (const r of regions) for (const t of r.tris) sN += N[t * 3 + axI] * A[t];
    const sg = sN > 0 ? 1 : -1, ax = [0, 0, 0];
    ax[axI] = sg;
    const fs = [];
    for (const r of regions) for (const t of r.tris) { const v = N[t * 3 + axI] * sg; if (Math.abs(v) > 0.05) fs.push([C[t * 3 + axI] * sg, v > 0, A[t]]); }
    const lo = Math.min(bx.min[axI] * sg, bx.max[axI] * sg), hi = Math.max(bx.min[axI] * sg, bx.max[axI] * sg);
    let bestC = Infinity, bl = lo, bh = lo;
    for (let h = lo + 2; h <= hi - 2; h += 0.25) {
      let c = 0;
      for (const [x, front, a] of fs) if ((x >= h) !== front) c += a;
      if (c < bestC - 1e-6) { bestC = c; bl = bh = h; } else if (Math.abs(c - bestC) <= 1e-6 && h - bh <= 0.26) bh = h;
    }
    const h0 = (bl + bh) / 2, L = 4 * Math.max(bx.max[0] - bx.min[0], bx.max[1] - bx.min[1], bx.max[2] - bx.min[2]) + 10;
    const halfSpace = (side, shift = 0) => {
      const c = [(bx.min[0] + bx.max[0]) / 2, (bx.min[1] + bx.max[1]) / 2, (bx.min[2] + bx.max[2]) / 2];
      c[axI] = sg * (side ? h0 + shift - L / 2 : h0 - shift + L / 2);
      return keep(Manifold.cube([L, L, L], true).translate(c));
    };
    cut = { ax, axI, h0, halfSpace, H: [halfSpace(0), halfSpace(1)] };
  }

  // 3) recursive split of each painted region into near-flat tiles
  let leaves = [], cellSeq = 0, curCell = 0;
  const cosMax = Math.cos((o.maxAngle * Math.PI) / 180);
  const stats = (tris, axis = null) => {
    let n = [0, 0, 0], c = [0, 0, 0], area = 0;
    for (const t of tris) { const a = A[t]; area += a; for (let k = 0; k < 3; k++) { n[k] += SN[t * 3 + k] * a; c[k] += C[t * 3 + k] * a; } }
    n = axis || norm(n); c = scl(c, 1 / (area || 1));
    const angs = tris.map((t) => [SN[t * 3] * n[0] + SN[t * 3 + 1] * n[1] + SN[t * 3 + 2] * n[2], A[t]]).sort((x, y) => x[0] - y[0]);
    // cos2: steepest face (2 % tail) → no undercut allowed; cos10: sizes the shell (creases may end up thinner)
    let acc = 0, cos2 = 1, cos10 = 1;
    for (const [d, a] of angs) { acc += a; if (acc <= area * 0.02) cos2 = d; if (acc <= area * 0.1) cos10 = d; else break; }
    let cos5 = cos2 >= 0.1 ? cos10 : cos2;
    let lo = Infinity, hi = -Infinity;
    for (const t of tris) for (let k = 0; k < 3; k++) { const h = dot(vpos(TV[t * 3 + k]), n); if (h < lo) lo = h; if (h > hi) hi = h; }
    // shell = surface translated by tn along -n: normal thickness is tn·cos(angle) → steep parts need a larger tn
    // (thin walls don't force cuts: the back zone keeps minWall there and the shell just gets thinner)
    const depth = o.depth, tn = Math.min(o.maxPocket, Math.max(depth, depth / Math.max(cos10, 0.05)));
    // painted faces turned away from the tile axis would print as overhangs under the tile
    let away = 0;
    for (const t of tris) if (N[t * 3] * n[0] + N[t * 3 + 1] * n[1] + N[t * 3 + 2] * n[2] < 0.1 && SN[t * 3] * n[0] + SN[t * 3 + 1] * n[1] + SN[t * 3 + 2] * n[2] < 0.5) away += A[t];
    if (away > area * 0.01) cos5 = Math.min(cos5, cosMax - 0.01);
    return { n, c, area, cos5, rise: hi - lo, fits: true, depth, tn };
  };
  const components = (tris) => {
    const inSet = new Set(tris), done = new Set(), out = [];
    for (const t of tris) {
      if (done.has(t)) continue;
      const l = [t];
      done.add(t);
      for (let i = 0; i < l.length; i++) for (const q of nbr[l[i]]) if (inSet.has(q) && !done.has(q)) { done.add(q); l.push(q); }
      out.push(l);
    }
    return out;
  };
  const areaOf = (l) => l.reduce((x, t) => x + A[t], 0);
  // the inlay slides in along n: nothing of the body may stand above its surface in that direction
  const columnOk = (tris, st) => {
    const n = st.n;
    let bad = 0, tot = 0;
    const step = Math.max(1, Math.floor(tris.length / 400));
    for (let i = 0; i < tris.length; i += step) {
      const t = tris[i];
      const c = [C[t * 3], C[t * 3 + 1], C[t * 3 + 2]];
      const hits = thickBody.rayCast(add(c, scl(n, 0.3)), add(c, scl(n, 300)));
      tot += A[t];
      if (hits.length) bad += A[t];
    }
    return bad <= tot * 0.02;
  };
  const splitRec = (tris, planes, region, level, axis = null) => {
    let st = stats(tris);
    if (axis) { const sa = stats(tris, axis); if (sa.cos5 >= st.cos5 - 0.02) st = sa; }
    if (st.area < o.minArea) return;
    // small pieces are not split further (a few hundredths of overhang or wall are better than slivers)
    let ok = (st.cos5 >= cosMax && st.fits) || st.area < o.minTile || (st.cos5 >= cosMax && st.area < 2 * o.minTile);
    if (ok && st.area >= o.minTile && level <= 16 && !columnOk(tris, st)) { ok = false; st.fits = false; }
    if (ok || level > 16 || tris.length < 8) { leaves.push({ tris, planes, region, st, cell: curCell }); return; }
    // main direction of normal variation (or of position spread if only the depth fails)
    const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const useN = st.cos5 < cosMax;
    for (const t of tris) {
      let d = useN ? [SN[t * 3], SN[t * 3 + 1], SN[t * 3 + 2]] : [C[t * 3] - st.c[0], C[t * 3 + 1] - st.c[1], C[t * 3 + 2] - st.c[2]];
      d = sub(d, scl(st.n, dot(d, st.n)));
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j] * A[t];
    }
    let u = [1, 0.3, 0.2];
    for (let it = 0; it < 40; it++) u = norm([dot(cov[0], u), dot(cov[1], u), dot(cov[2], u)]);
    u = norm(sub(u, scl(st.n, dot(u, st.n))));
    // try a few cut planes; keep the one giving the fewest / least fragmented pieces
    let best = null;
    for (const dir of [u, norm(cross(st.n, u))]) {
      const proj = tris.map((t) => [C[t * 3] * dir[0] + C[t * 3 + 1] * dir[1] + C[t * 3 + 2] * dir[2], A[t]]).sort((x, y) => x[0] - y[0]);
      for (const q of [0.5, 0.38, 0.62]) {
        let acc2 = 0, d0 = proj[0][0];
        for (const [p, a] of proj) { acc2 += a; if (acc2 >= st.area * q) { d0 = p; break; } }
        const pos = [], neg = [];
        for (const t of tris) (C[t * 3] * dir[0] + C[t * 3 + 1] * dir[1] + C[t * 3 + 2] * dir[2] >= d0 ? pos : neg).push(t);
        if (!pos.length || !neg.length) continue;
        const cp = components(pos), cn = components(neg);
        const tiny = [...cp, ...cn].filter((l) => areaOf(l) < o.minTile).length;
        const score = (cp.length + cn.length) * 10 + tiny * 40 + Math.abs(q - 0.5) * 20 + (dir === u ? 0 : 6);
        if (!best || score < best.score) best = { score, dir, d0, cp, cn };
      }
    }
    if (!best) { leaves.push({ tris, planes, region, st, cell: curCell }); return; }
    // tilt the cut so it bisects the two halves' normals: both tiles then get the same, smallest
    // overhang on the cut face (only pink|pink seams come from cuts, so moving them is invisible)
    {
      const avgN = (ls) => { const v = [0, 0, 0]; for (const l of ls) for (const t of l) for (let k = 0; k < 3; k++) v[k] += SN[t * 3 + k] * A[t]; return norm(v); };
      const m = norm(add(avgN(best.cp), avgN(best.cn)));
      const u2 = norm(sub(best.dir, scl(m, dot(best.dir, m))));
      if (Number.isFinite(u2[0]) && dot(u2, best.dir) > 0.3) {
        const p0 = add(st.c, scl(best.dir, best.d0 - dot(st.c, best.dir)));
        const d2 = dot(u2, p0);
        const pos = [], neg = [];
        for (const t of tris) (C[t * 3] * u2[0] + C[t * 3 + 1] * u2[1] + C[t * 3 + 2] * u2[2] >= d2 ? pos : neg).push(t);
        if (pos.length && neg.length) best = { ...best, dir: u2, d0: d2, cp: components(pos), cn: components(neg) };
      }
    }
    for (const comp of best.cp) splitRec(comp, [...planes, { u: best.dir, d: best.d0 }], region, level + 1);
    for (const comp of best.cn) splitRec(comp, [...planes, { u: scl(best.dir, -1), d: -best.d0 }], region, level + 1);
  };
  // few big pieces: pick the fewest insertion directions that cover the region (normal within maxAngle and a free
  // path out), then split it with planes through the fitted centre (power cells → straight seams, on a sphere
  // exactly where the normal is closest to each direction). Cells that still fail fall back to splitRec.
  const DIRS = [];
  for (let i = 0; i < 600; i++) { const z = 1 - 2 * (i + 0.5) / 600, r = Math.sqrt(1 - z * z), ph = i * 2.399963229728653; DIRS.push([r * Math.cos(ph), r * Math.sin(ph), z]); }
  const blockedAlong = (tris, d) => {
    const out = new Set();
    for (const t of tris) {
      const c = [C[t * 3], C[t * 3 + 1], C[t * 3 + 2]];
      if (thickBody.rayCast(add(c, scl(d, 0.3)), add(c, scl(d, 300))).length) out.add(t);
    }
    return out;
  };
  const coverDirs = (tris, cosC) => {
    const area = areaOf(tris), left = new Set(tris), dirs = [];
    const step = Math.max(1, Math.floor(tris.length / 300));
    while (dirs.length < 8) {
      let got = 0;
      for (const t of left) got += A[t];
      if (got <= area * 0.02) break;
      const cand = DIRS.map((d) => { let s2 = 0; for (const t of left) if (SN[t * 3] * d[0] + SN[t * 3 + 1] * d[1] + SN[t * 3 + 2] * d[2] >= cosC) s2 += A[t]; return [s2, d]; })
        .sort((x, y) => y[0] - x[0]).slice(0, 6);
      let best = null;
      for (const [, d] of cand) {
        const cov = [...left].filter((t) => SN[t * 3] * d[0] + SN[t * 3 + 1] * d[1] + SN[t * 3 + 2] * d[2] >= cosC);
        const bl = blockedAlong(cov.filter((_, i) => i % step === 0), d);
        let s2 = 0, sb = 0;
        cov.forEach((t, i) => { s2 += A[t]; if (i % step === 0 && bl.has(t)) sb += A[t] * step; });
        if (!best || s2 - sb > best.s) best = { s: s2 - sb, d, cov };
      }
      if (!best || best.s < o.minTile) break;
      // centre the direction on what it covers (less extra thickness on its steepest side)
      let m = [0, 0, 0];
      for (const t of best.cov) for (let k = 0; k < 3; k++) m[k] += SN[t * 3 + k] * A[t];
      m = norm(m);
      const d = best.cov.every((t) => SN[t * 3] * m[0] + SN[t * 3 + 1] * m[1] + SN[t * 3 + 2] * m[2] >= cosC - 0.05) ? m : best.d;
      dirs.push(d);
      for (const t of best.cov) left.delete(t);
    }
    return dirs;
  };
  const lostTips = [];
  let hiddenArea = 0;
  regions.forEach((r) => {
    for (const comp of components(r.tris)) {
      if (cut) {
        // one piece per side of the cut (per connected patch): front pieces slide in from the front, back ones from behind
        const cell = cellSeq++;
        for (const side of [0, 1]) {
          const sg = side ? -1 : 1, a = scl(cut.ax, sg);
          const own = comp.filter((t) => {
            if (sg * (C[t * 3 + cut.axI] * cut.ax[cut.axI] - cut.h0) < 0) return false;
            // hidden along the way in (a crease where two bulges meet): it stays base colour, so the piece slides in straight
            const c = [C[t * 3], C[t * 3 + 1], C[t * 3 + 2]];
            if (thickBody.rayCast(add(c, scl(a, 0.3)), add(c, scl(a, 300))).length) { hiddenArea += A[t]; return false; }
            return true;
          });
          const ownArea = areaOf(own), compArea = areaOf(comp);
          for (const cc of components(own)) {
            const ar = areaOf(cc);
            if (ar < o.minArea) continue;
            // a sliver of a stripe that pokes across the cut: not worth a separate piece, the stripe ends at the seam
            if (ar < o.minTile && ownArea < compArea / 2) { lostTips.push(ar); continue; }
            leaves.push({ tris: cc, planes: [{ u: a, d: sg * cut.h0 }], region: r, st: { ...stats(cc, a), tn: Math.min(o.maxPocket, 2 * o.depth) }, cell, side });
          }
        }
        continue;
      }
      const st = stats(comp);
      if (st.cos5 >= cosMax && (st.area < o.minTile || columnOk(comp, st))) { leaves.push({ tris: comp, planes: [], region: r, st, cell: cellSeq++ }); continue; }
      // try a few coverage angles, keep the partition with the fewest pieces (then the fewest crumbs)
      let best = null;
      for (const ang of [55, 62, 68, o.maxAngle]) {
        const cosC = Math.cos((Math.min(ang, o.maxAngle) * Math.PI) / 180), saved = leaves;
        leaves = [];
        (() => {
        const dirs = coverDirs(comp, cosC);
        if (dirs.length < 2) { curCell = cellSeq++; splitRec(comp, [], r, 0); return; }
        // each face goes to the free direction it faces best; then a few majority passes clean the borders
        // (rays on every 3rd facing face; the others take the verdict of their neighbours)
        const free = dirs.map((d) => {
          const facing = comp.filter((t) => SN[t * 3] * d[0] + SN[t * 3 + 1] * d[1] + SN[t * 3 + 2] * d[2] > 0.05);
          const bl = blockedAlong(facing.filter((_, i) => i % 3 === 0), d), probed = new Set(facing.filter((_, i) => i % 3 === 0));
          for (const t of facing) if (!probed.has(t) && nbr[t].some((q) => bl.has(q))) bl.add(t);
          return (t) => !bl.has(t);
        });
        const lab = new Map();
        for (const t of comp) {
          let bi = -1, bv = -Infinity, ai = 0, av = -Infinity;
          dirs.forEach((d, i) => {
            const v = SN[t * 3] * d[0] + SN[t * 3 + 1] * d[1] + SN[t * 3 + 2] * d[2];
            if (v > av) { av = v; ai = i; }
            if (v > bv && free[i](t)) { bv = v; bi = i; }
          });
          lab.set(t, bi >= 0 && bv > 0.05 ? bi : ai);
        }
        for (let it = 0; it < 6; it++) {
          const nl = new Map(lab);
          for (const t of comp) {
            const cnt = new Map();
            for (const q of nbr[t]) if (lab.has(q)) cnt.set(lab.get(q), (cnt.get(lab.get(q)) || 0) + 1);
            let bl = lab.get(t), bc = cnt.get(bl) || 0;
            for (const [l, k] of cnt) {
              const d = dirs[l];
              if (k > bc && free[l](t) && SN[t * 3] * d[0] + SN[t * 3 + 1] * d[1] + SN[t * 3 + 2] * d[2] > 0.1) { bl = l; bc = k; }
            }
            nl.set(t, bl);
          }
          for (const [t, l] of nl) lab.set(t, l);
        }
        // islands smaller than minTile join the neighbouring cell they share most border with
        for (let pass = 0; pass < 3; pass++) {
          const cells = dirs.map(() => []);
          for (const [t, l] of lab) cells[l].push(t);
          let moved = 0;
          cells.forEach((cl, i) => {
            for (const isl of components(cl)) {
              if (areaOf(isl) >= o.minTile) continue;
              const set = new Set(isl), cnt = new Map();
              for (const t of isl) for (const q of nbr[t]) if (!set.has(q) && lab.has(q)) cnt.set(lab.get(q), (cnt.get(lab.get(q)) || 0) + 1);
              let bl = -1, bc = 0;
              const okFor = (l) => isl.filter((t) => free[l](t)).length >= isl.length * 0.9;
            for (const [l, k] of cnt) if (l !== i && k > bc && okFor(l)) { bl = l; bc = k; }
              if (bl >= 0) { for (const t of isl) lab.set(t, bl); moved++; }
            }
          });
          if (!moved) break;
        }
        // faces still blocked in their own direction (creases under another body part) get a dedicated small
        // piece inserted along their mean normal when that path is free
        {
          const stuck = comp.filter((t) => !free[lab.get(t)](t));
          for (const sc of components(stuck)) {
            if (areaOf(sc) < 2) continue;
            // the direction that frees most of the patch without undercut (every face must face it a little)
            const sa = areaOf(sc);
            let m = [0, 0, 0];
            for (const t of sc) for (let k = 0; k < 3; k++) m[k] += SN[t * 3 + k] * A[t];
            m = norm(m);
            let bl = blockedAlong(sc, m), fa = 0;
            for (const t of sc) if (!bl.has(t)) fa += A[t];
            for (const d of DIRS) {
              if (fa >= sa * 0.98) break;
              let ok = 0, cs = 0;
              for (const t of sc) { const v = SN[t * 3] * d[0] + SN[t * 3 + 1] * d[1] + SN[t * 3 + 2] * d[2]; if (v >= 0.1) ok += A[t]; cs += v * A[t]; }
              if (ok < sa * 0.98) continue;
              const smp = sc.filter((_, i) => i % Math.ceil(sc.length / 40) === 0), sA = areaOf(smp);
              const b2 = blockedAlong(smp, d);
              let f2 = 0;
              for (const t of smp) if (!b2.has(t)) f2 += A[t];
              f2 *= sa / sA;
              if (f2 > fa + 0.5) { fa = f2; bl = blockedAlong(sc, d); m = d; }
            }
            if (fa < areaOf(sc) * 0.7) continue;
            const li = dirs.length;
            dirs.push(m);
            free.push((t) => !bl.has(t));
            for (const t of sc) lab.set(t, li);
          }
        }
        for (const t of comp) {
          if (free[lab.get(t)](t)) continue;
          let bi = -1, bv = 0;
          dirs.forEach((d, i) => { const v = SN[t * 3] * d[0] + SN[t * 3 + 1] * d[1] + SN[t * 3 + 2] * d[2]; if (v > bv && free[i](t)) { bv = v; bi = i; } });
          if (bi >= 0) lab.set(t, bi);
        }
        const cells = dirs.map(() => []);
        for (const [t, l] of lab) cells[l].push(t);
        dirs.forEach((d, i) => {
          curCell = cellSeq++;
          for (const cc of components(cells[i])) splitRec(cc, [], r, 1, d);
        });
        })();
        const big = leaves.filter((l) => l.st.area >= o.minTile).length, score = big * 10 + (leaves.length - big) * 3;
        if (!best || score < best.score) best = { score, leaves };
        leaves = saved;
      }
      leaves.push(...best.leaves);
    }
  });
  progress(`Generando ${leaves.length} incrustaciones`, 0.2);

  // 4) build tile + pocket cutters
  const c2 = o.clearance / 2;
  const SEG = 64;
  const parts = [];
  const pockets = [];
  let thinCount = 0, dropped = 0;
  const corners = (b) => { const r = []; for (let i = 0; i < 8; i++) r.push([(i & 1 ? b.max : b.min)[0], (i & 2 ? b.max : b.min)[1], (i & 4 ? b.max : b.min)[2]]); return r; };
  const margin = 1.5;
  const leafOf = new Int32Array(nT).fill(-1);
  leaves.forEach((lf, li) => { for (const t of lf.tris) leafOf[t] = li; });
  const cen = (t) => [C[t * 3], C[t * 3 + 1], C[t * 3 + 2]];
  // borders between direction cells follow triangle edges (zigzag). A smooth border: every cell's indicator is
  // diffused over the surface vertices and the border is the iso-line where two cells weigh the same
  const cellIdx = new Map();
  leaves.forEach((lf) => { if (!cellIdx.has(lf.cell)) cellIdx.set(lf.cell, cellIdx.size); });
  const K = cellIdx.size, W = new Map(), vAdj = new Map();
  for (let t = 0; t < nT; t++) {
    if (leafOf[t] < 0) continue;
    const k = cellIdx.get(leaves[leafOf[t]].cell);
    const vs = [0, 1, 2].map((j) => merged[TV[t * 3 + j]]);
    vs.forEach((v, j) => {
      if (!W.has(v)) { W.set(v, new Float32Array(K)); vAdj.set(v, new Set()); }
      W.get(v)[k] += A[t];
      vAdj.get(v).add(vs[(j + 1) % 3]); vAdj.get(v).add(vs[(j + 2) % 3]);
    });
  }
  if (K > 1) {
    for (const w of W.values()) { let sm = 0; for (const x of w) sm += x; for (let k = 0; k < K; k++) w[k] /= sm || 1; }
    // small cells (crease pieces) would melt away in the diffusion: their inner vertices stay pinned
    const cellArea = new Float64Array(K);
    for (let t = 0; t < nT; t++) if (leafOf[t] >= 0) cellArea[cellIdx.get(leaves[leafOf[t]].cell)] += A[t];
    const pinned = new Map();
    for (const [v, w] of W) { const k = w.findIndex((x) => x > 0.999); if (k >= 0 && cellArea[k] < o.minTile * 3) pinned.set(v, Float32Array.from(w)); }
    for (let it = 0; it < 10; it++) {
      const nw = new Map();
      for (const [v, w] of W) {
        const acc = new Float32Array(K);
        let n = 0;
        for (const q of vAdj.get(v)) { const wq = W.get(q); if (!wq) continue; n++; for (let k = 0; k < K; k++) acc[k] += wq[k]; }
        for (let k = 0; k < K; k++) acc[k] = 0.5 * w[k] + (n ? (0.5 * acc[k]) / n : 0.5 * w[k]);
        nw.set(v, acc);
      }
      for (const [v, w] of nw) W.set(v, pinned.get(v) || w);
    }
  }
  const gVert = (k, vi) => {
    const w = W.get(merged[vi]);
    if (!w) return -1;
    let mx = 0;
    for (let j = 0; j < K; j++) if (j !== k && w[j] > mx) mx = w[j];
    return w[k] - mx;
  };
  // surface pieces of a tile: its triangles clipped exactly by its cut planes and its smooth cell border
  const clipped = (tris, planes, off, lf = null) => {
    const out = [];
    const k = lf && K > 1 ? cellIdx.get(lf.cell) : -1;
    for (const t of tris) {
      let poly = [0, 1, 2].map((j) => ({ p: vpos(TV[t * 3 + j]), g: k >= 0 ? gVert(k, TV[t * 3 + j]) : 1 }));
      const cuts = planes.map((pl) => (q) => dot(q.p, pl.u) - pl.d + off);
      if (k >= 0 && poly.some((q) => q.g < 0)) cuts.push((q) => q.g);
      for (const f of cuts) {
        const res = [];
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          const da = f(a), db = f(b);
          if (da >= 0) res.push(a);
          if ((da >= 0) !== (db >= 0)) { const s2 = da / (da - db); res.push({ p: add(a.p, scl(sub(b.p, a.p), s2)), g: a.g + (b.g - a.g) * s2 }); }
        }
        poly = res;
        if (poly.length < 3) break;
      }
      if (poly.length >= 3) out.push({ t, poly: poly.map((q) => q.p) });
    }
    return out;
  };
  // 2D shadow of surface pieces seen along `dir` (frame fr)
  const shadow = (pieces, dir, fr, minFacing) => {
    const polys = [];
    for (const { t, poly: P } of pieces) {
      if (N[t * 3] * dir[0] + N[t * 3 + 1] * dir[1] + N[t * 3 + 2] * dir[2] <= minFacing) continue;
      const poly = P.map((p) => [dot(p, fr.u), dot(p, fr.v)]);
      let ar = 0;
      for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; ar += a[0] * b[1] - b[0] * a[1]; }
      if (Math.abs(ar) < 1e-9) continue;
      polys.push(ar > 0 ? poly : poly.reverse());
    }
    return polys.length ? keep(new CrossSection(polys, 'Positive')) : null;
  };
  const smoothCS = (cs) => keep(keep(keep(keep(cs.offset(o.smooth, 'Round', 2, SEG)).offset(-o.smooth - o.minFeature / 2, 'Round', 2, SEG)).offset(o.minFeature / 2, 'Round', 2, SEG)).simplify(0.01));
  const T0 = [];
  leaves.forEach((lf, li) => {
    const n = lf.st.n, fr = frameFor(n);
    // footprint: the leaf grown ~margin into its same-colour neighbours (seams are cut later)
    const regSet = new Set(lf.region.tris);
    const grown = new Map(lf.tris.map((t) => [t, cen(t)]));
    const q = [...lf.tris];
    for (let i = 0; i < q.length; i++) {
      const src = grown.get(q[i]);
      for (const nb of nbr[q[i]]) {
        if (grown.has(nb) || !regSet.has(nb)) continue;
        const c = cen(nb);
        if (Math.hypot(c[0] - src[0], c[1] - src[1], c[2] - src[2]) > margin) continue;
        grown.set(nb, leafOf[nb] === li ? c : src);
        q.push(nb);
      }
    }
    const nbrLeaves = new Set();
    for (const t of grown.keys()) if (leafOf[t] >= 0 && leafOf[t] !== li) nbrLeaves.add(leafOf[t]);
    let hi = -Infinity, lo = Infinity;
    for (const t of grown.keys()) for (let k = 0; k < 3; k++) hi = Math.max(hi, dot(vpos(TV[t * 3 + k]), n));
    for (const t of lf.tris) for (let k = 0; k < 3; k++) lo = Math.min(lo, dot(vpos(TV[t * 3 + k]), n));
    const exact = clipped(grown.keys(), lf.planes, 0, lf);
    const raw = shadow(clipped(grown.keys(), lf.planes, margin), n, fr, cut ? -0.05 : 0.05);
    if (!raw) return;
    const fp = smoothCS(raw);
    if (fp.area() < o.minArea) return;
    const tn = lf.st.tn;
    const floor = lo - tn - o.clearance - 0.3;
    const top = hi + 0.6;
    const prism = (cs) => keep(keep(cs.extrude(top - floor)).transform(frameMat(fr, scl(n, floor))));
    // reach of this tile under the surface (its prism can pass below non-adjacent tiles too)
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const t of grown.keys()) for (let k = 0; k < 3; k++) { const p = vpos(TV[t * 3 + k]); for (let j = 0; j < 3; j++) { bb[j] = Math.min(bb[j], p[j]); bb[j + 3] = Math.max(bb[j + 3], p[j]); } }
    const ext = top - floor;
    for (let j = 0; j < 3; j++) { bb[j] -= ext; bb[j + 3] += ext; }
    T0[li] = { li, lf, n, floor, top, tn, fp, nbrLeaves, grownSet: new Set(grown.keys()), bb, exact, tileCut: prism(keep(fp.offset(-c2, 'Round', 2, SEG))), pocketCut: prism(keep(fp.offset(c2, 'Round', 2, SEG))) };
  });
  // seams between neighbouring tiles of the same colour: a cylinder along the bisector of both
  // tile axes, so each side gets at most half the angle between them as draft/overhang
  progress('Cortando uniones entre incrustaciones', 0.4);
  const TL = T0.filter(Boolean);
  const boxHit = (a, b) => a[0] <= b[3] && b[0] <= a[3] && a[1] <= b[4] && b[1] <= a[4] && a[2] <= b[5] && b[2] <= a[5];
  for (let ia = 0; ia < TL.length; ia++) {
    const A = TL[ia];
    for (let ib = ia + 1; ib < TL.length; ib++) {
      const B = TL[ib];
      if (!boxHit(A.bb, B.bb)) continue;
      if (cut && A.lf.side !== B.lf.side) continue; // the cut plane already separates them
      // the seam only exists where both footprints overlap (cells facing far apart must not cut each other)
      const zone = [...A.grownSet].filter((t) => B.grownSet.has(t));
      if (!zone.length) continue;
      let m = add(A.n, B.n);
      m = Math.hypot(...m) < 0.2 ? A.n : norm(m);
      const fm = frameFor(m);
      const PA0 = shadow(A.exact, m, fm, 0.02), PB0 = shadow(B.exact, m, fm, 0.02);
      if (!PA0 || !PB0) continue;
      const PA = keep(PA0.simplify(0.05));
      const PB = keep(smoothCS(PB0).simplify(0.03));
      const ZS = shadow(zone.map((t) => ({ t, poly: [0, 1, 2].map((k) => vpos(TV[t * 3 + k])) })), m, fm, -0.5);
      if (!ZS) continue;
      const zcs = keep(keep(ZS.offset(margin + 1.5, 'Round', 2, 16)).simplify(0.05));
      let h0 = Infinity, h1 = -Infinity;
      for (const t of zone) for (let k = 0; k < 3; k++) { const h = dot(vpos(TV[t * 3 + k]), m); h0 = Math.min(h0, h); h1 = Math.max(h1, h); }
      h0 -= Math.max(A.tn, B.tn) + o.clearance + 3; h1 += 3;
      const col = (cs) => keep(keep(keep(cs.intersect(zcs)).extrude(h1 - h0)).transform(frameMat(fm, scl(m, h0))));
      const near = keep(keep(PA.offset(2, 'Square')).simplify(0.1));
      const pbIn = keep(PB.offset(-c2, 'Round', 2, 16)), pbOut = keep(PB.offset(c2, 'Round', 2, 16));
      A.tileCut = keep(A.tileCut.subtract(col(pbOut)));
      A.pocketCut = keep(A.pocketCut.subtract(col(pbIn)));
      B.tileCut = keep(B.tileCut.subtract(col(keep(near.subtract(pbIn)))));
      B.pocketCut = keep(B.pocketCut.subtract(col(keep(near.subtract(pbOut)))));
    }
  }
  progress('Recortando incrustaciones', 0.6);
  // plane mode: the shell is what lies within tn along the axis OR within dh sideways of the surface, so it keeps
  // its thickness down to the cut, where the surface runs parallel to the axis (only near the colour pieces)
  const inner = new Map();
  if (cut) {
    for (const side of [0, 1]) {
      const own = T0.filter((X) => X && X.lf.side === side);
      if (!own.length) continue;
      const a = scl(cut.ax, side ? -1 : 1), fr = frameFor(a), tn = own[0].tn, dh = o.depth * 1.25;
      const reach = Manifold.union(own.map((X) => {
        const fp = keep(X.fp.offset(dh + 2, 'Round', 2, 16));
        return keep(keep(fp.extrude(X.top - X.floor + tn + 4)).transform(frameMat(fr, scl(a, X.floor - tn - 2))));
      }));
      const crop = keep(keep(M.intersect(keep(reach))).intersect(cut.halfSpace(side, dh + 2)));
      for (const [k, d] of [['t', 0], ['p', c2]]) {
        const tr = [keep(crop.translate(scl(a, -(tn + d))))];
        for (let i = 0; i < 8; i++) { const g = (Math.PI * i) / 4, h = add(scl(fr.u, Math.cos(g)), scl(fr.v, Math.sin(g))); tr.push(keep(crop.translate(scl(h, -(dh + d))))); }
        inner.set(side + k, keep(Manifold.intersection(tr)));
      }
    }
  }
  for (const X of T0) {
    if (!X) continue;
    X.inner = (d, k = 't') => (cut ? inner.get(X.lf.side + k).translate(scl(X.n, X.tn - d)) : M.translate(scl(X.n, -d)));
    // curved shell: what lies within tn (along n) of the surface; the pocket is the same plus the clearance
    const lo = X.floor + X.tn + o.clearance + 0.3;
    const atSurface = (pc) => { const b = pc.boundingBox(); return [b.min, b.max].some((q) => q) && corners(b).some((q) => dot(q, X.n) >= lo - 0.05); };
    // back zone: material with less than minWall (+ clearance for the tile) below it along n is not cut, except a
    // skin of minSkin under the painted surface (rims, creases): the colour must still show there
    const skin = (d) => keep(M.subtract(keep(M.translate(scl(X.n, -d)))));
    const back = (d, keepSkin) => keep(keep(M.subtract(keep(M.translate(scl(X.n, d))))).subtract(skin(keepSkin)));
    const Mh = cut ? keep(M.intersect(cut.H[X.lf.side])) : M;
    const R0 = keep(Mh.intersect(X.tileCut));
    let tile = keep(keep(R0.subtract(keep(X.inner(X.tn)))).subtract(back(o.minWall + o.clearance, o.minSkin)));
    if (solidUnion) tile = keep(tile.subtract(solidUnion));
    const pieces = tile.decompose().map(keep).filter((p) => p.volume() > 0.5 && atSurface(p));
    if (!pieces.length) continue;
    const pk = keep(keep(keep(Mh.intersect(X.pocketCut)).subtract(keep(cut ? X.inner(X.tn, 'p') : X.inner(X.tn + c2)))).subtract(back(o.minWall, o.minSkin + c2)));
    pieces.sort((a, b) => b.volume() - a.volume());
    // crumbs (< 3 mm³) are not worth printing: their pocket stays filled with the base colour
    // with the front/back cut, shell fragments detached near the seam are dropped too (few, solid pieces)
    const kept = pieces.filter((pc, i) => i === 0 || pc.volume() >= (cut ? o.minFragment : 3));
    if (kept.length < pieces.length) dropped += pieces.length - kept.length;
    // only the pockets of printed pieces are carved (a dropped crumb's spot stays solid base colour)
    const boxes = kept.map((pc) => pc.boundingBox());
    const near = (b) => boxes.some((q) => [0, 1, 2].every((j) => b.min[j] <= q.max[j] + o.clearance && q.min[j] <= b.max[j] + o.clearance));
    const pkParts = pk.decompose().map(keep).filter((pc) => atSurface(pc) && near(pc.boundingBox()));
    if (pkParts.length) pockets.push(keep(Manifold.union(pkParts)));
    const full = keep(keep(Mh.intersect(X.tileCut)).subtract(keep(X.inner(X.tn))));
    if (tile.volume() < full.volume() * 0.9) thinCount++;
    for (const pc of kept) parts.push({ kind: 'inlay', color: X.lf.region.color, man: pc, up: X.n, floor: X.floor, area: X.fp.area(), X });
  }

  if (thinCount) warnings.push(`${thinCount} incrustaciones más delgadas en zonas de pared fina (se deja ${o.minWall} mm de pared)`);
  if (hiddenArea > 1) warnings.push(`${Math.round(hiddenArea)} mm² pintados en pliegues ocultos (no encajan en línea recta) quedan del color base`);
  if (lostTips.length) warnings.push(`${lostTips.length} puntas de franja (${Math.round(lostTips.reduce((x, y) => x + y, 0))} mm²) que cruzaban el corte quedan del color base`);
  if (dropped) warnings.push(`${dropped} migajas de color (< 3 mm³) descartadas: esa zona queda del color base`);

  // 5) body = base minus pockets and minus the solid parts (socket)
  progress('Tallando cajas en el cuerpo', 0.75);
  let body = M;
  if (pockets.length) body = keep(body.subtract(keep(Manifold.union(pockets))));
  if (solidUnion) body = keep(body.subtract(solidUnion));
  let bodyPieces = body.decompose().map(keep).filter((p) => p.volume() > 1).sort((a, b) => b.volume() - a.volume());
  // slivers of base colour left between pockets are too thin to print
  const slivers = bodyPieces.filter((p, i) => i > 0 && p.volume() < 10);
  if (slivers.length) { bodyPieces = bodyPieces.filter((p) => !slivers.includes(p)); warnings.push(`${slivers.length} astillas del color base (< 10 mm³) entre cajas no se imprimen`); }
  const nObj = M.decompose().filter((p) => p.volume() > 1).length;
  if (bodyPieces.length > nObj) warnings.push(`el cuerpo quedó en ${bodyPieces.length} piezas (paredes delgadas)`);
  if (cut) {
    // two halves, each printed on its flat cut face
    const halves = [0, 1].map((side) => bodyPieces.map((b) => keep(b.intersect(cut.H[side]))).filter((b) => b.volume() > 1));
    // every inlay must slide straight out along n: per column (0.3 mm grid) inlay material lying below an entry into the
    // body half is blocked (hooks at grazing rims, a second layer against a cavity wall) → it goes back to the body
    progress('Comprobando que cada pieza entre recta', 0.78);
    const mb = M.boundingBox();
    let blockedVol = 0;
    const extra = [];
    const MH = [0, 1].map((side) => keep(M.intersect(cut.H[side])));
    for (const p of parts) {
      if (p.kind !== 'inlay' || !halves[p.X.lf.side].length) continue;
      const side = p.X.lf.side, n = p.up, fr = frameFor(n), B = halves[side].length > 1 ? keep(Manifold.union(halves[side])) : halves[side][0];
      const proj = (q) => [dot(q, fr.u), dot(q, fr.v), dot(q, n)];
      const cs = corners(p.man.boundingBox()).map(proj), ms = corners(mb).map(proj);
      const r = 0.3, w0 = Math.min(...cs.map((q) => q[2])) - 1, w1 = Math.max(...ms.map((q) => q[2])) + 1;
      const u0 = Math.min(...cs.map((q) => q[0])), u1 = Math.max(...cs.map((q) => q[0])), v0 = Math.min(...cs.map((q) => q[1])), v1 = Math.max(...cs.map((q) => q[1]));
      const at = (u, v, w) => add(add(scl(fr.u, u), scl(fr.v, v)), scl(n, w));
      const boxes = [];
      for (let v = v0 + r / 2; v < v1; v += r) {
        let run = null;
        const flush = () => { if (run) boxes.push(run); run = null; };
        for (let u = u0 + r / 2; u < u1; u += r) {
          const ph = p.man.rayCast(at(u, v, w0), at(u, v, w1));
          let H = -Infinity;
          if (ph.length) {
            const pMin = w0 + ph[0].distance * (w1 - w0);
            const bh = B.rayCast(at(u, v, w0), at(u, v, w1));
            // body entries are the even hits (rays start outside); the highest entry beyond the inlay's lowest point blocks
            for (let k = 0; k < bh.length; k += 2) { const wb = w0 + bh[k].distance * (w1 - w0); if (wb > pMin + 0.05) H = Math.max(H, wb); }
          }
          if (H === -Infinity) { flush(); continue; }
          const Hq = Math.ceil(H / 0.25) * 0.25;
          if (run && run.H === Hq) run.u1 = u + r / 2; else { flush(); run = { u0: u - r / 2, u1: u + r / 2, v, H: Hq }; }
        }
        flush();
      }
      if (!boxes.length) continue;
      const mk = (g) => {
        // thousands of column boxes: freed right away (the wasm heap is limited)
        const cols = boxes.map((b) => { const c = Manifold.cube([b.u1 - b.u0 + 2 * g, r + 2 * g, b.H - w0]); const t = c.translate([b.u0 - g, b.v - r / 2 - g, w0]); c.delete(); return t; });
        const u = Manifold.union(cols);
        for (const c of cols) c.delete();
        const out = u.transform(frameMat({ ...fr, n }));
        u.delete();
        return keep(out);
      };
      const S = mk(0), blocked = keep(p.man.intersect(S));
      if (blocked.volume() < 0.3) continue;
      const rest = keep(p.man.subtract(mk(o.clearance))).decompose().map(keep).sort((x, y) => y.volume() - x.volume());
      const keepRest = rest.filter((q, i) => i === 0 || q.volume() >= o.minFragment);
      const lost = [blocked, ...rest.filter((q) => !keepRest.includes(q))];
      blockedVol += lost.reduce((t, q) => t + q.volume(), 0);
      // the body takes back all the model inside those columns (pocket gap included, so nothing is left loose)
      const regs = [S, ...rest.filter((q) => !keepRest.includes(q)).map((q) => {
        const b = q.boundingBox();
        return keep(Manifold.cube([0, 1, 2].map((j) => b.max[j] - b.min[j] + 0.6)).translate([0, 1, 2].map((j) => b.min[j] - 0.3)));
      })];
      let fill = keep(keep(MH[side].intersect(keep(Manifold.union(regs)))).subtract(keep(Manifold.union(keepRest))));
      if (solidUnion) fill = keep(fill.subtract(solidUnion));
      halves[side] = [keep(Manifold.union([B, fill]))];
      p.man = keepRest[0];
      for (const q of keepRest.slice(1)) extra.push({ ...p, man: q });
    }
    if (blockedVol > 1) warnings.push(`${Math.round(blockedVol)} mm\u00b3 de incrustaci\u00f3n que no sal\u00edan en l\u00ednea recta pasan al cuerpo`);
    parts.push(...extra);
    // no contact overlap left between a half and its inlays
    for (const side of [0, 1]) {
      const own = parts.filter((p) => p.kind === 'inlay' && p.X.lf.side === side).map((p) => p.man);
      if (own.length) halves[side] = halves[side].map((h) => keep(h.subtract(keep(Manifold.union(own))))).filter((h) => h.volume() > 1);
      // crumbs of base colour left on the cut face are not printable
      // (by mesh connectivity: decompose() aborts on halves with hundreds of shells)
      halves[side] = halves[side].map((h) => {
        const m = h.getMesh(), np = m.numProp, nv = m.vertProperties.length / np;
        const V = new Float32Array(nv * 3);
        for (let k = 0; k < nv; k++) for (let j = 0; j < 3; j++) V[k * 3 + j] = m.vertProperties[k * np + j];
        const shells = shellsOf(V, m.triVerts).map((tr) => ({ tr, vol: triStats(V, m.triVerts, tr).vol }));
        const big = Math.max(...shells.map((q) => q.vol));
        const keepS = shells.filter((q) => q.vol === big || Math.abs(q.vol) >= 10);
        if (keepS.length === shells.length) return h;
        const tris = keepS.flatMap((q) => q.tr);
        return keep(new Manifold(new w.Mesh({ numProp: 3, ...subMesh(V, m.triVerts, tris) })));
      });
    }
    for (const side of [1, 0]) for (const bp of halves[side].sort((a, b) => a.volume() - b.volume())) {
      const a = scl(cut.ax, side ? -1 : 1);
      parts.unshift({ kind: 'body', color: base, man: bp, up: a, n: a, half: side });
    }
  } else for (const bp of bodyPieces) parts.unshift({ kind: 'body', color: base, man: bp, up: [0, 0, 1] });

  // numbers engraved on the flat base of every inlay (same numbering as the part list / assembly map)
  if (o.labels) {
    progress('Grabando números', 0.8);
    let num = 0, done = 0, total = 0;
    for (const p of parts) {
      num++;
      if (p.kind !== 'inlay') continue;
      total++;
      const r = engrave(p, String(num));
      if (r) { p.man = r; done++; }
    }
    if (total && done < total) warnings.push(`${total - done} incrustaciones muy pequeñas van sin número grabado: ubícalas con el mapa de armado`);
  }

  // digits cut into the deepest E mm of the shell (its hidden, glued face), mirrored so they read from behind
  function engrave(p, txt) {
    const X = p.X, n = X.n, fr = frameFor(n);
    const E = Math.min(0.4, X.lf.st.depth * 0.3);
    if (E < 0.2) return null;
    const toLocal = [fr.u[0], fr.v[0], n[0], 0, fr.u[1], fr.v[1], n[1], 0, fr.u[2], fr.v[2], n[2], 0, 0, 0, 0, 1];
    // where the shell has its full thickness: its own deepest layer, seen along n
    const deep = keep(p.man.intersect(keep(X.inner(X.tn - E))));
    if (deep.volume() < 0.5) return null;
    const inner = keep(keep(keep(deep.transform(toLocal)).project()).offset(-0.5, 'Round', 2, 16));
    if (inner.area() < 1.5) return null;
    const inside = (x, y) => keep(inner.intersect(keep(new CrossSection([[[x - 0.01, y - 0.01], [x + 0.01, y - 0.01], [x + 0.01, y + 0.01], [x - 0.01, y + 0.01]]], 'Positive')))).area() > 1e-5;
    const centers = [];
    for (const r of [4, 3, 2.4, 2, 1.7, 1.4, 1.2, 1, 0.8, 0.6, 0.4, 0.2, 0]) {
      const e = r ? keep(inner.offset(-r, 'Round', 2, 16)) : inner;
      if (e.area() < 1e-4) continue;
      for (const q of e.toPolygons().filter((q) => ccw(q))) {
        let sx = 0, sy = 0;
        for (const [x, y] of q) { sx += x; sy += y; }
        const c = [sx / q.length, sy / q.length];
        centers.push(inside(...c) ? c : q[0]);
      }
      if (centers.length) break;
    }
    for (const h of [4, 3.5, 3, 2.5]) {
      const D = digitRects(txt, h);
      for (const [cx, cy] of centers) for (let ang = 0; ang < 180; ang += 15) {
        const ca = Math.cos(ang * Math.PI / 180), sa = Math.sin(ang * Math.PI / 180);
        const place = (x, y) => { const X0 = -(x - D.W / 2), Y0 = y - D.H / 2; return [X0 * ca - Y0 * sa + cx, X0 * sa + Y0 * ca + cy]; };
        const box = keep(new CrossSection([[place(0, 0), place(D.W, 0), place(D.W, D.H), place(0, D.H)]].map((q) => (ccw(q) ? q : q.reverse())), 'Positive'));
        if (keep(box.intersect(inner)).area() < box.area() * 0.999) continue;
        const polys = D.rects.map(([a, b, c, d]) => [place(a, b), place(c, b), place(c, d), place(a, d)]).map((q) => (ccw(q) ? q : q.reverse()));
        const cs = keep(new CrossSection(polys, 'Positive'));
        const col = keep(keep(cs.extrude(X.top - X.floor + 2)).transform(frameMat(fr, scl(n, X.floor - 1))));
        const cutter = keep(col.intersect(keep(X.inner(X.tn - E))));
        const res = keep(p.man.subtract(cutter));
        const removed = p.man.volume() - res.volume();
        if (removed < cs.area() * E * 0.95 || res.decompose().map(keep).length !== 1) continue;
        return res;
      }
    }
    return null;
  }

  return finishParts({ w, o, model, parts, solids, base, keep, garbage, warnings, progress, info: { regions: regions.length, tiles: leaves.length, thickness: thPct, cut: cut && { axis: cut.ax, at: cut.h0 * cut.ax[cut.axI] } } });
}

// voxel grid over bb (node spacing h) for the solid-part cores
function voxGrid(bb, h) {
  const n = [0, 1, 2].map((k) => Math.max(2, Math.ceil((bb.max[k] - bb.min[k]) / h) + 1));
  return { n, o: bb.min, h, N: n[0] * n[1] * n[2] };
}

// inside / outside of a closed mesh at every grid node (parity of the crossings along z columns)
function voxelize(G, mesh) {
  const [nx, ny, nz] = G.n, o0 = G.o, h = G.h, ins = new Uint8Array(G.N);
  const np = mesh.numProp, P = mesh.vertProperties, T = mesh.triVerts;
  const cols = new Array(nx * ny).fill(null);
  const jx = 1.3e-4, jy = 0.7e-4; // keeps the column lines off mesh edges
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t] * np, b = T[t + 1] * np, c = T[t + 2] * np;
    const ax = P[a], ay = P[a + 1], bx = P[b], by = P[b + 1], cx = P[c], cy = P[c + 1];
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - o0[0] - jx) / h)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - o0[0] - jx) / h));
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - o0[1] - jy) / h)), j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - o0[1] - jy) / h));
    if (i0 > i1 || j0 > j1) continue;
    const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(d) < 1e-12) continue;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const x = o0[0] + i * h + jx, y = o0[1] + j * h + jy;
      const u = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / d, v = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / d, wq = 1 - u - v;
      if (u < 0 || v < 0 || wq < 0) continue;
      const k = i + j * nx;
      (cols[k] || (cols[k] = [])).push(u * P[a + 2] + v * P[b + 2] + wq * P[c + 2]);
    }
  }
  for (let k = 0; k < cols.length; k++) {
    const zs = cols[k];
    if (!zs) continue;
    zs.sort((p, q) => p - q);
    for (let m = 0; m + 1 < zs.length; m += 2) {
      const k0 = Math.max(0, Math.ceil((zs[m] - o0[2]) / h)), k1 = Math.min(nz - 1, Math.floor((zs[m + 1] - o0[2]) / h));
      for (let z = k0; z <= k1; z++) ins[k + z * nx * ny] = 1;
    }
  }
  return ins;
}

// distance (mm) from every node in `mask` to the nearest node outside it, minus half a node (exact EDT, separable)
function edt(G, mask) {
  const [nx, ny, nz] = G.n, NN = G.N, D = new Float64Array(NN);
  for (let i = 0; i < NN; i++) D[i] = mask[i] ? 1e20 : 0;
  const L = Math.max(nx, ny, nz), f = new Float64Array(L), dd = new Float64Array(L), v = new Int32Array(L), zz = new Float64Array(L + 1);
  const pass = (len, cnt, idx) => {
    for (let c = 0; c < cnt; c++) {
      for (let q = 0; q < len; q++) f[q] = D[idx(c, q)];
      let k = 0;
      v[0] = 0; zz[0] = -Infinity; zz[1] = Infinity;
      for (let q = 1; q < len; q++) {
        let sx = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (sx <= zz[k]) { k--; sx = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; zz[k] = sx; zz[k + 1] = Infinity;
      }
      k = 0;
      for (let q = 0; q < len; q++) { while (zz[k + 1] < q) k++; const r = v[k]; dd[q] = (q - r) * (q - r) + f[r]; }
      for (let q = 0; q < len; q++) D[idx(c, q)] = dd[q];
    }
  };
  pass(nx, ny * nz, (c, q) => q + c * nx);
  pass(ny, nx * nz, (c, q) => (c % nx) + q * nx + Math.floor(c / nx) * nx * ny);
  pass(nz, nx * ny, (c, q) => c + q * nx * ny);
  const R = new Float32Array(NN);
  for (let i = 0; i < NN; i++) R[i] = mask[i] ? (Math.sqrt(D[i]) - 0.5) * G.h : 0;
  return R;
}

// trilinear lookup of a node field (value `out` beyond the grid)
function sampler(G, F, out) {
  const [nx, ny, nz] = G.n, o0 = G.o, h = G.h, sy = nx, sz = nx * ny;
  return (p) => {
    const fx = (p[0] - o0[0]) / h, fy = (p[1] - o0[1]) / h, fz = (p[2] - o0[2]) / h;
    if (fx < 0 || fy < 0 || fz < 0 || fx > nx - 1 || fy > ny - 1 || fz > nz - 1) return out;
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)), k = Math.min(nz - 2, Math.floor(fz));
    const u = fx - i, v = fy - j, w = fz - k, b = i + j * nx + k * sz;
    const l = (q) => F[q] * (1 - u) + F[q + 1] * u;
    return (l(b) * (1 - v) + l(b + sy) * v) * (1 - w) + (l(b + sz) * (1 - v) + l(b + sz + sy) * v) * w;
  };
}

// box blur (3 taps per axis, `passes` times) of a node field: softens the steps of fields built from voxel masks
function blur(G, F, passes = 2) {
  const st = [1, G.n[0], G.n[0] * G.n[1]], tmp = new Float32Array(F.length);
  for (let p = 0; p < passes; p++) for (let k = 0; k < 3; k++) {
    const s = st[k];
    for (let i = 0; i < F.length; i++) {
      const c = Math.floor(i / s) % G.n[k];
      tmp[i] = (F[c > 0 ? i - s : i] + F[i] + F[c < G.n[k] - 1 ? i + s : i]) / 3;
    }
    F.set(tmp);
  }
  return F;
}

// covers mode, solid colour parts (a bow): the base colour gets the whole shape (a core fused to the base, plus a
// bridge filling the gap between the part's back and the base behind it, so it is glued over a wide face), and the
// colour is ONE cover: a cap of cover thickness over the side seen from its slide direction, glued onto the core
function coverSolids({ w, o, M, solids, solidMans, parts, cutAxis, keep, progress }) {
  const { Manifold } = w;
  progress('Covers: núcleo de las piezas sólidas', 0.8);
  const t = o.depth, c = Math.max(0.05, o.clearance / 2), BRIDGE = 12;
  const ai = cutAxis[0] ? 0 : cutAxis[1] ? 1 : 2, sg = cutAxis[ai] > 0 ? 1 : -1;
  const bodyIdx = parts.map((p, i) => (p.kind === 'body' ? i : -1)).filter((i) => i >= 0);
  const cored = [], cores = [];
  for (const S of keep(Manifold.union(solidMans)).decompose().map(keep)) {
    if (S.volume() < 5) continue;
    const own = solids.filter((s, i) => keep(solidMans[i].intersect(S)).volume() > 1e-3);
    const vol = new Map();
    own.forEach((s) => vol.set(s.dom, (vol.get(s.dom) || 0) + Math.abs(s.vol)));
    const color = [...vol].sort((a, b) => b[1] - a[1])[0][0];
    const b0 = S.boundingBox(), pad = t + 2, padB = BRIDGE + 2;
    const bb = { min: b0.min.map((x) => x - pad), max: b0.max.map((x) => x + pad) };
    // room behind the part for the bridge (along both slide candidates)
    bb.min[ai] = Math.min(bb.min[ai], b0.min[ai] - (sg > 0 ? padB : 0)); bb.max[ai] = Math.max(bb.max[ai], b0.max[ai] + (sg < 0 ? padB : 0));
    bb.min[2] = Math.min(bb.min[2], b0.min[2] - padB);
    const h = Math.max(0.15, Math.cbrt(((bb.max[0] - bb.min[0]) * (bb.max[1] - bb.min[1]) * (bb.max[2] - bb.min[2])) / 6e6));
    const G = voxGrid(bb, h), [nx, ny] = G.n, st = [1, nx, nx * ny];
    const ext = [0, 1, 2].map((k) => bb.max[k] - bb.min[k] + 2 * pad);
    const Mb = keep(M.intersect(keep(Manifold.cube(ext).translate(bb.min.map((x) => x - pad)))));
    const inS = voxelize(G, S.getMesh()), inM = voxelize(G, Mb.getMesh()), inU = inS.map((x, i) => x | inM[i]);
    // depth inside solid + base: where the solid sinks into the base the core runs on into it
    const DU = edt(G, inU);
    for (let i = 0; i < G.N; i++) if (!inU[i]) DU[i] = -h;
    const scan = (k, s, start, f) => {
      const n2 = [0, 1, 2].filter((j) => j !== k), len = G.n[k];
      for (let a = 0; a < G.n[n2[0]]; a++) for (let b = 0; b < G.n[n2[1]]; b++) {
        const b0i = a * st[n2[0]] + b * st[n2[1]];
        start();
        for (let q = 0; q < len; q++) f(b0i + (s > 0 ? q : len - 1 - q) * st[k]);
      }
    };
    // walking each line from the outside in (against the slide direction): the cap is the colour met before the
    // first deep (>= t) node or base node; everything after it is core; the empty gap after the part up to the base
    // (<= BRIDGE mm) is the bridge
    const carve = (k, s, out) => {
      let flag = false, gap = null, tail = null, white = 0, extN = 0, extL = [], run = [], wasS = false;
      const maxGap = Math.round(BRIDGE / h);
      // the shallow colour just before the part's back face: a back cover if nothing (no base) is right behind it.
      // `back` marks a thick region (the back half of the line through the part, and a bit past it) so its blurred
      // level set survives; the back cover is the cap inside it
      const endTail = () => {
        if (tail && out) {
          for (const g of tail) out.force[g] = 0;
          for (const g of extL) out.force[g] = 0;
          for (let q = run.length >> 1; q < run.length; q++) out.back[run[q]] = 1;
          for (const g of [...tail, ...extL]) out.back[g] = 1;
        }
        tail = null;
      };
      // the core mask runs on a few nodes past the part (clipped to it later): its level set then reaches the part's
      // surface instead of fading just inside it, which would leave a film of cap under the core locking the cap in
      const extend = (i) => { if (extN > 0 && out) { out.force[i] = 1; extL.push(i); extN--; } };
      scan(k, -s, () => { endTail(); flag = false; gap = null; tail = null; extN = 0; extL = []; run = []; wasS = false; }, (i) => {
        if (inM[i] && !inS[i]) { wasS = false; extend(i); if (gap && out) for (const g of gap) out.bridge[g] = 1; gap = null; tail = null; flag = true; return; }
        if (inS[i]) {
          if (gap && !wasS) { gap = null; tail = null; } // the part again behind a short gap: that tail is hidden
          extN = 0; extL = [];
          if (!wasS) run = [];
          wasS = true;
          if (DU[i] >= t) { flag = true; tail = null; }
          if (flag) {
            if (out) out.force[i] = 1;
            run.push(i);
            if (DU[i] < t && !inM[i]) { if (!out) white++; (tail || (tail = [])).push(i); } else tail = null;
          }
          gap = flag ? [] : null;
          if (flag) extN = 8;
          return;
        }
        wasS = false;
        extend(i);
        if (gap) { gap.push(i); if (gap.length > maxGap) { gap = null; endTail(); } }
      });
      return white;
    };
    const cands = [[ai, sg], [2, 1]].map(([k, s]) => ({ k, s, white: carve(k, s, null) }));
    const dir = cands[1].white < cands[0].white * 0.7 ? cands[1] : cands[0];
    const force = new Uint8Array(G.N), bridge = new Uint8Array(G.N), back = new Uint8Array(G.N);
    carve(dir.k, dir.s, { force, bridge, back });
    // widen the back region sideways (not along the slide): its blurred edge has to reach past the core's silhouette,
    // or the back of the outermost lines stays on the front cap, behind the core, locking it
    for (let p = 0; p < 4; p++) for (const k of [0, 1, 2]) {
      if (k === dir.k) continue;
      const src = back.slice(), sk = st[k];
      for (let i = 0; i < G.N; i++) {
        if (src[i]) continue;
        const q = Math.floor(i / sk) % G.n[k];
        if ((q > 0 && src[i - sk]) || (q < G.n[k] - 1 && src[i + sk])) back[i] = 1;
      }
    }
    // signed, blurred mask fields (positive inside) -> smooth level sets
    const signed = (mask) => {
      const Fin = edt(G, mask), Fout = edt(G, mask.map((x) => 1 - x));
      for (let i = 0; i < G.N; i++) Fin[i] = mask[i] ? Fin[i] : -Fout[i];
      return blur(G, Fin, 5);
    };
    const fDepth = sampler(G, DU, -h), fForce = sampler(G, signed(force), -h);
    const sdf = (p) => Math.max(fDepth(p) - t - c, fForce(p));
    const edge = Math.max(0.35, h * 1.5);
    // level sets only over the nodes they can be positive at (memory)
    const boxOf = (mask) => {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < G.N; i++) if (mask[i]) { const q = [i % nx, Math.floor(i / nx) % ny, Math.floor(i / st[2])]; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); } }
      return { min: lo.map((x, k) => G.o[k] + x * h - 1), max: hi.map((x, k) => G.o[k] + x * h + 1) };
    };
    const bS = { min: b0.min.map((x) => x - 0.5), max: b0.max.map((x) => x + 0.5) };
    const cav = keep(keep(Manifold.levelSet(sdf, bS, edge, -c)).intersect(S));
    let core = keep(keep(Manifold.levelSet(sdf, bS, edge, 0)).intersect(S));
    if (bridge.some((x) => x)) {
      const fB = sampler(G, signed(bridge), -h);
      const br = keep(keep(keep(Manifold.levelSet(fB, boxOf(bridge), edge, 0)).subtract(S)).subtract(M));
      const brK = br.decompose().map(keep).filter((q) => q.volume() > 1);
      if (brK.length) core = keep(core.add(keep(Manifold.union(brK))));
    }
    // only core islands fused to the base: a loose island stays colour (a cover could not hold it in place)
    const keepC = core.decompose().map(keep).filter((q) => q.volume() > 1 && keep(q.intersect(M)).volume() > 0.5);
    if (!keepC.length) continue;
    const cavK = cav.decompose().map(keep).filter((q) => keepC.some((k) => keep(q.intersect(k)).volume() > 1e-3));
    const capM = keep(keep(S.subtract(keep(Manifold.union(cavK)))).subtract(M));
    const up = [0, 0, 0];
    up[dir.k] = dir.s;
    // back covers (slide on from behind) apart from the front cap
    let backM = null;
    if (back.some((x) => x)) {
      const fBk = sampler(G, signed(back), -h);
      backM = keep(capM.intersect(keep(Manifold.levelSet(fBk, boxOf(back), edge, 0))));
    }
    const front = backM ? keep(capM.subtract(backM)) : capM;
    for (const q of front.decompose().map(keep)) if (q.volume() >= 0.3) parts.push({ kind: 'cover', color, man: q, up, n: up, solidCover: true });
    if (backM) {
      const dn = scl(up, -1);
      for (const q of backM.decompose().map(keep)) if (q.volume() >= 0.3) parts.push({ kind: 'cover', color, man: q, up: dn, n: dn, solidCover: true, back: true });
    }
    cored.push(...own);
    cores.push(...keepC);
  }
  // the cores join the base piece they sink into
  for (const k of cores) {
    let bi = bodyIdx[0], bv = -1;
    for (const i of bodyIdx) { const v = keep(parts[i].man.intersect(k)).volume(); if (v > bv) { bv = v; bi = i; } }
    if (bi != null) parts[bi].man = keep(parts[bi].man.add(k));
  }
  return cored;
}

function finishParts({ w, o, model, parts, solids, base, keep, garbage, warnings, progress, info }) {
  // 6) solid color parts, shrunk by the clearance so they slide into their socket
  progress('Piezas sólidas', 0.85);
  solids.forEach((s) => {
    const sm = subMesh(s.part.V, s.part.T, s.tris, s.vol < 0);
    const shr = keep(toManifold(w, offsetVerts(sm, -o.clearance)));
    const ok = shr.status && shr.status() !== 'NoError' ? null : shr;
    const man = ok && ok.volume() > 0 ? ok : keep(toManifold(w, sm));
    parts.push({ kind: 'solid', color: s.dom, man, up: null });
  });

  // 7) export meshes (assembled pose) + print pose
  const out = parts.map((p, i) => {
    const mesh = manifoldToMesh(p.man);
    // shells always print along their insertion axis: visible face on top (best finish), supports only under the glued face
    const up = p.kind === 'inlay' || p.kind === 'cover' ? p.up : p.up || bestUp(mesh);
    return { kind: p.kind, color: p.color, mesh, up, volume: p.man.volume(), n: p.kind === 'inlay' || p.kind === 'cover' ? p.up : p.n, half: p.half, fromSolid: !!p.solidCover, backCover: !!p.back };
  });
  const counters = {};
  for (const p of out) {
    counters[p.color] = (counters[p.color] || 0) + 1;
    p.index = counters[p.color];
    p.name = `${model.names?.[p.color] || 'Color ' + (p.color + 1)} ${String(p.index).padStart(2, '0')}${p.kind === 'body' ? ' cuerpo' + (p.half === 0 ? ' frente' : p.half === 1 ? ' atrás' : '') : p.kind === 'solid' ? ' pieza' : ''}`;
    p.print = printPose(p.mesh, p.up);
  }
  for (const g of garbage) { try { g.delete(); } catch { /* already freed */ } }
  return { parts: out, base, palette: model.palette, names: model.names, warnings, ...info };
}

// ---------- covers: one intact base body + thin colour covers glued into a shallow recess ----------
// Every painted area becomes a shell of constant thickness that follows the surface (visible face = the original
// surface), the base keeps the full figure minus that recess. Borders are iso-lines of smoothed geodesic distance
// fields on the surface: no triangle zigzag, no hair-thin strips (opening/closing by minFeature).
function heapDijkstra(nV, off, adj, len, dist) {
  const hd = [], hv = [];
  const push = (d, v) => {
    let i = hd.length;
    hd.push(d); hv.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (hd[p] <= d) break; hd[i] = hd[p]; hv[i] = hv[p]; i = p; }
    hd[i] = d; hv[i] = v;
  };
  for (let v = 0; v < nV; v++) if (dist[v] < Infinity) push(dist[v], v);
  while (hd.length) {
    const d0 = hd[0], v0 = hv[0];
    const d = hd.pop(), v = hv.pop();
    if (hd.length) {
      let i = 0;
      const n = hd.length;
      for (;;) { let l = 2 * i + 1; if (l >= n) break; if (l + 1 < n && hd[l + 1] < hd[l]) l++; if (hd[l] >= d) break; hd[i] = hd[l]; hv[i] = hv[l]; i = l; }
      hd[i] = d; hv[i] = v;
    }
    if (d0 > dist[v0]) continue;
    for (let k = off[v0]; k < off[v0 + 1]; k++) { const q = adj[k], nd = d0 + len[k]; if (nd < dist[q]) { dist[q] = nd; push(nd, q); } }
  }
  return dist;
}

// Splits the vertices of F (in place) along edges that are both a colour border and a sharp crease (> ~37°).
// Returns, for every new vertex, the vertex it copies.
function creaseSplit(F, nT, nV, triColor, N, cosMax = 0.8) {
  const eT = new Map();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const a = F[t * 3 + k], b = F[t * 3 + (k + 1) % 3], key = Math.min(a, b) * 4294967296 + Math.max(a, b);
    const l = eT.get(key);
    if (l) l.push(t); else eT.set(key, [t]);
  }
  const nd = (s, t) => N[s * 3] * N[t * 3] + N[s * 3 + 1] * N[t * 3 + 1] + N[s * 3 + 2] * N[t * 3 + 2];
  const cut = new Set();
  for (const [key, l] of eT) {
    if (l.length !== 2) continue;
    const [s, t] = l;
    if (triColor[s] === triColor[t] || nd(s, t) >= cosMax) continue;
    cut.add(key);
  }
  if (!cut.size) return [];
  const vt = new Map();
  for (const key of cut) for (const v of [Math.floor(key / 4294967296), key % 4294967296]) if (!vt.has(v)) vt.set(v, []);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) { const l = vt.get(F[t * 3 + k]); if (l) l.push(t); }
  const dup = [], F0 = F.slice();
  for (const [v, tris] of vt) {
    // fans of triangles around v joined across edges that are not cut
    const par = tris.map((_, i) => i), find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
    const other = (t) => [0, 1, 2].map((k) => F0[t * 3 + k]).filter((u) => u !== v);
    for (let i = 0; i < tris.length; i++) for (let j = i + 1; j < tris.length; j++) {
      const oi = other(tris[i]), oj = other(tris[j]);
      for (const u of oi) if (oj.includes(u) && !cut.has(Math.min(u, v) * 4294967296 + Math.max(u, v))) par[find(i)] = find(j);
    }
    const roots = [...new Set(tris.map((_, i) => find(i)))];
    for (const r of roots.slice(1)) {
      const nv = nV + dup.length;
      dup.push(v);
      tris.forEach((t, i) => { if (find(i) === r) for (let k = 0; k < 3; k++) if (F[t * 3 + k] === v) F[t * 3 + k] = nv; });
    }
  }
  return dup;
}

function buildCovers(ctx) {
  const { w, o, M, mm, TV, nT, A, N, SN, triColor, merged, base, solidUnion, TH, keep, warnings, progress, cutAxis, thickBody } = ctx;
  const { Manifold } = w;
  const np = mm.numProp, nV0 = mm.vertProperties.length / np;
  const F = new Uint32Array(nT * 3);
  for (let i = 0; i < nT * 3; i++) F[i] = merged[TV[i]];
  // a colour border lying on a sharp edge (bottom rim, rim of a hole, a step) is already exact: the surface is split
  // there so fields, smoothing and normals of one side never leak to the other, and the cover keeps the whole face
  const dup = creaseSplit(F, nT, nV0, triColor, N);
  const nV = nV0 + dup.length;
  const X = new Float64Array(nV * 3), vOrig = new Int32Array(nV);
  for (let i = 0; i < nV0; i++) { vOrig[i] = i; for (let k = 0; k < 3; k++) X[i * 3 + k] = mm.vertProperties[i * np + k]; }
  dup.forEach((s, j) => { vOrig[nV0 + j] = s; for (let k = 0; k < 3; k++) X[(nV0 + j) * 3 + k] = X[s * 3 + k]; });
  const used = new Uint8Array(nV);
  for (let i = 0; i < F.length; i++) used[F[i]] = 1;
  // undirected edges (CSR)
  const eIdx = new Map(), E = [];
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const a = F[t * 3 + k], b = F[t * 3 + (k + 1) % 3], lo = Math.min(a, b), hi = Math.max(a, b), key = lo * 4294967296 + hi;
    if (!eIdx.has(key)) { eIdx.set(key, E.length / 2); E.push(lo, hi); }
  }
  const off = new Int32Array(nV + 1);
  for (const v of E) off[v + 1]++;
  for (let i = 0; i < nV; i++) off[i + 1] += off[i];
  const adj = new Int32Array(E.length), len = new Float64Array(E.length), fp = off.slice(0, nV);
  const dist3 = (a, b) => Math.hypot(X[a * 3] - X[b * 3], X[a * 3 + 1] - X[b * 3 + 1], X[a * 3 + 2] - X[b * 3 + 2]);
  for (let e = 0; e < E.length; e += 2) {
    const a = E[e], b = E[e + 1], l = dist3(a, b);
    adj[fp[a]] = b; len[fp[a]++] = l; adj[fp[b]] = a; len[fp[b]++] = l;
  }
  const VA = new Float64Array(nV), VN = new Float64Array(nV * 3);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const v = F[t * 3 + k];
    VA[v] += A[t] / 3;
    for (let j = 0; j < 3; j++) VN[v * 3 + j] += SN[t * 3 + j] * A[t];
  }
  const smoothVec = (S, it) => {
    for (let r = 0; r < it; r++) {
      const nx = new Float64Array(S.length);
      for (let v = 0; v < nV; v++) {
        if (!used[v]) continue;
        let x = S[v * 3], y = S[v * 3 + 1], z = S[v * 3 + 2];
        for (let k = off[v]; k < off[v + 1]; k++) { const q = adj[k]; x += S[q * 3]; y += S[q * 3 + 1]; z += S[q * 3 + 2]; }
        const l = Math.hypot(x, y, z) || 1;
        nx[v * 3] = x / l; nx[v * 3 + 1] = y / l; nx[v * 3 + 2] = z / l;
      }
      S.set(nx);
    }
  };
  smoothVec(VN, 4);
  const VNg = VN;
  const smooth = (f, it, mask = null) => {
    for (let r = 0; r < it; r++) {
      const nx = new Float64Array(f);
      for (let v = 0; v < nV; v++) {
        if (!used[v] || (mask && !mask[v])) continue;
        let s = 0, n = 0;
        for (let k = off[v]; k < off[v + 1]; k++) { s += f[adj[k]]; n++; }
        if (n) nx[v] = 0.5 * f[v] + (0.5 * s) / n;
      }
      f.set(nx);
    }
    return f;
  };
  // signed geodesic distance (along mesh edges) to the zero set of a per-vertex field, + inside
  const signedDist = (phi) => {
    const d = new Float64Array(nV).fill(Infinity);
    for (let e = 0; e < E.length; e += 2) {
      const a = E[e], b = E[e + 1];
      if ((phi[a] > 0) === (phi[b] > 0)) continue;
      const s = phi[a] / (phi[a] - phi[b]), l = dist3(a, b);
      d[a] = Math.min(d[a], s * l); d[b] = Math.min(d[b], (1 - s) * l);
    }
    heapDijkstra(nV, off, adj, len, d);
    for (let v = 0; v < nV; v++) d[v] = (d[v] === Infinity ? 1e6 : d[v]) * (phi[v] > 0 ? 1 : -1);
    return d;
  };
  // geometric clean-up of a region field: opening removes strips thinner than 2r, closing removes thin gaps
  const morph = (d, r) => {
    if (r <= 0) return d;
    const de = signedDist(d.map((x) => x - r));
    for (let v = 0; v < nV; v++) d[v] = Math.min(d[v], de[v] + r);
    const dc = signedDist(d.map((x) => -x - r));
    for (let v = 0; v < nV; v++) d[v] = -Math.min(-d[v], dc[v] + r);
    return d;
  };
  const SMOOTH = 6;
  // the zero line of a field as closed curves on the surface, smoothed as curves (Gaussian, sigma = borderSmooth mm),
  // then the field is rebuilt near them as the exact signed distance to the smooth curves
  const refine = (f, band = 3) => {
    const pt = new Map(), next = new Map();
    const ep = (a, b) => {
      const lo = Math.min(a, b), hi = Math.max(a, b), k = eIdx.get(lo * 4294967296 + hi);
      if (!pt.has(k)) { const s2 = f[lo] / (f[lo] - f[hi]); pt.set(k, [0, 1, 2].map((j) => X[lo * 3 + j] + (X[hi * 3 + j] - X[lo * 3 + j]) * s2)); }
      return k;
    };
    for (let t = 0; t < nT; t++) {
      const vs = [F[t * 3], F[t * 3 + 1], F[t * 3 + 2]], ins = vs.map((v) => f[v] > 0);
      if (ins[0] === ins[1] && ins[1] === ins[2]) continue;
      const ks = [];
      for (let i = 0; i < 3; i++) if (ins[i] !== ins[(i + 1) % 3]) ks.push(ep(vs[i], vs[(i + 1) % 3]));
      if (ks.length !== 2) continue;
      let [k0, k1] = ks;
      // inside on the left, seen from outside
      const p0 = pt.get(k0), p1 = pt.get(k1), vi = vs[ins.indexOf(true)];
      const nt = [N[t * 3], N[t * 3 + 1], N[t * 3 + 2]], left = cross(nt, sub(p1, p0));
      if (dot(left, sub([X[vi * 3], X[vi * 3 + 1], X[vi * 3 + 2]], p0)) < 0) [k0, k1] = [k1, k0];
      next.set(k0, k1);
    }
    const H = 0.25, segs = [], sPrev = [], sNext = [];
    const done2 = new Set();
    for (const k of next.keys()) {
      if (done2.has(k)) continue;
      const loop = [];
      let c = k;
      while (c !== undefined && !done2.has(c)) { done2.add(c); loop.push(pt.get(c)); c = next.get(c); }
      if (loop.length < 3) continue;
      const closed = c === k;
      // resample at H mm
      const rs = [loop[0]];
      let carry = 0;
      for (let i = 1; i < loop.length + (closed ? 1 : 0); i++) {
        const a = loop[i - 1], b = loop[i % loop.length], L = Math.hypot(...sub(b, a));
        let s2 = H - carry;
        while (s2 < L) { rs.push(add(a, scl(sub(b, a), s2 / L))); s2 += H; }
        carry = L - (s2 - H);
      }
      const it = Math.round((2 * o.borderSmooth * o.borderSmooth) / (H * H));
      let q = rs;
      const n = q.length;
      // sharp tips (turning > ~55 deg over 1 mm each side) stay put: smoothing removes the zigzag, not the corners
      const pin = new Uint8Array(n), K = 4, turn = new Float64Array(n);
      if (n > 4 * K) for (let i = 0; i < n; i++) {
        if (!closed && (i < K || i >= n - K)) continue;
        const a = q[(i - K + n) % n], b = q[(i + K) % n], u = sub(q[i], a), v2 = sub(b, q[i]);
        turn[i] = 1 - dot(u, v2) / (Math.hypot(...u) * Math.hypot(...v2) || 1);
      }
      for (let i = 0; i < n; i++) {
        if (turn[i] < 1 - Math.cos((55 * Math.PI) / 180)) continue;
        let mx = true;
        for (let j = -K; j <= K && mx; j++) { const k2 = closed ? (i + j + n) % n : i + j; if (j && k2 >= 0 && k2 < n && (turn[k2] > turn[i] || (turn[k2] === turn[i] && j < 0))) mx = false; }
        if (mx) pin[i] = 1;
      }
      if (n >= 8) for (let r = 0; r < it; r++) {
        const nq = q.map((x, i) => {
          if ((!closed && (i === 0 || i === n - 1)) || pin[i]) return x;
          const a = q[(i - 1 + n) % n], b = q[(i + 1) % n];
          return [(a[0] + 2 * x[0] + b[0]) / 4, (a[1] + 2 * x[1] + b[1]) / 4, (a[2] + 2 * x[2] + b[2]) / 4];
        });
        q = nq;
      }
      const s0 = segs.length, ns = n - (closed ? 0 : 1);
      for (let i = 0; i < ns; i++) {
        segs.push([q[i], q[(i + 1) % n]]);
        sPrev.push(i > 0 ? s0 + i - 1 : closed ? s0 + ns - 1 : -1);
        sNext.push(i < ns - 1 ? s0 + i + 1 : closed ? s0 : -1);
      }
    }
    const lin = (a, b, s2) => f[a] + (f[b] - f[a]) * s2;
    if (!segs.length) return { v: f, at: lin };
    const G = 2, grid = new Map(), gk = (x, y, z) => x * 73856093 ^ y * 19349663 ^ z * 83492791;
    segs.forEach((sg, i) => {
      const lo = [0, 1, 2].map((j) => Math.floor(Math.min(sg[0][j], sg[1][j]) / G)), hi = [0, 1, 2].map((j) => Math.floor(Math.max(sg[0][j], sg[1][j]) / G));
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
        const kk = gk(x, y, z);
        if (!grid.has(kk)) grid.set(kk, []);
        grid.get(kk).push(i);
      }
    });
    const out = new Float64Array(f), R = Math.ceil((band + 1.5) / G);
    const sd = (p2, nv) => {
      const c = p2.map((x) => Math.floor(x / G));
      let best = Infinity, bs = null, bq = null, bt = 0;
      for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) {
        const l = grid.get(gk(c[0] + x, c[1] + y, c[2] + z));
        if (l) for (const i of l) {
          const [a, b] = segs[i], ab = sub(b, a), L2 = dot(ab, ab) || 1e-12;
          const s2 = Math.max(0, Math.min(1, dot(sub(p2, a), ab) / L2)), qq = add(a, scl(ab, s2)), dd = Math.hypot(...sub(p2, qq));
          if (dd < best) { best = dd; bs = i; bq = qq; bt = s2; }
        }
      }
      if (bs === null) return null;
      const lft = (i) => { const [a, b] = segs[i], l = cross(nv, sub(b, a)); return scl(l, 1 / (Math.hypot(...l) || 1)); };
      let left = lft(bs);
      // nearest point is a corner: the side is given by both segments there (pseudo-normal), else points just past a
      // sharp tip get the wrong sign and leave slivers
      const o2 = bt <= 1e-9 ? sPrev[bs] : bt >= 1 - 1e-9 ? sNext[bs] : -1;
      if (o2 >= 0) left = add(left, lft(o2));
      return (dot(left, sub(p2, bq)) >= 0 ? 1 : -1) * Math.max(best, 1e-5);
    };
    // the nearest curve in 3D can lie on another nearby surface (ear against head): only trust it when it agrees
    // with the surface field (same side, similar distance)
    const ok = (r2, g) => r2 !== null && Math.abs(r2) <= Math.abs(g) + 0.75 && (Math.abs(g) < 0.75 || (r2 > 0) === (g > 0));
    for (let v = 0; v < nV; v++) {
      if (!used[v] || Math.abs(f[v]) > band) continue;
      const r2 = sd([X[v * 3], X[v * 3 + 1], X[v * 3 + 2]], [VN[v * 3], VN[v * 3 + 1], VN[v * 3 + 2]]);
      if (ok(r2, f[v])) out[v] = r2;
    }
    // exact value anywhere on an edge (the border crosses long edges at the right place, not by interpolation)
    const at = (a, b, s2) => {
      const r2 = sd([0, 1, 2].map((j) => X[a * 3 + j] + (X[b * 3 + j] - X[a * 3 + j]) * s2), [0, 1, 2].map((j) => VN[a * 3 + j] + (VN[b * 3 + j] - VN[a * 3 + j]) * s2));
      const g = out[a] + (out[b] - out[a]) * s2;
      return ok(r2, g) ? r2 : g;
    };
    return { v: out, at };
  };

  // surface hidden inside a solid colour part (e.g. under the bow): its colour is taken from the visible neighbours
  progress('Covers: zonas visibles', 0.22);
  const hidden = new Uint8Array(nT);
  if (solidUnion) {
    const bb = solidUnion.boundingBox();
    for (let t = 0; t < nT; t++) {
      const c = [0, 1, 2].map((k) => (X[F[t * 3] * 3 + k] + X[F[t * 3 + 1] * 3 + k] + X[F[t * 3 + 2] * 3 + k]) / 3);
      if (c.some((x, k) => x < bb.min[k] - 0.01 || x > bb.max[k] + 0.01)) continue;
      // inside the solid, or touching it from below (0.15 mm out along the normal is inside)
      for (const q of [c, add(c, scl([N[t * 3], N[t * 3 + 1], N[t * 3 + 2]], 0.15))]) {
        if (solidUnion.rayCast(q, [q[0] + 0.0123, q[1] + 0.0071, bb.max[2] + 5]).length % 2) { hidden[t] = 1; break; }
      }
    }
  }
  // paint buried inside the model (overlapping shells: a painted layer just behind the visible surface) is not seen
  {
    const bb = M.boundingBox();
    for (let t = 0; t < nT; t++) {
      if (hidden[t] || triColor[t] === base) continue;
      const c = [0, 1, 2].map((k) => (X[F[t * 3] * 3 + k] + X[F[t * 3 + 1] * 3 + k] + X[F[t * 3 + 2] * 3 + k]) / 3);
      const q = add(c, scl([N[t * 3], N[t * 3 + 1], N[t * 3 + 2]], 0.15));
      if (M.rayCast(q, [q[0] + 0.0123, q[1] + 0.0071, bb.max[2] + 5]).length % 2) hidden[t] = 1;
    }
  }
  const colors = [...new Set([...triColor].filter((c, t) => c !== base && !hidden[t]))];
  // how far each vertex lies inside the hidden surface: covers only tuck 0.8 mm under a solid part (enough to meet
  // its edge), never down into the slot of its tab
  const dvis = new Float64Array(nV).fill(Infinity);
  for (let t = 0; t < nT; t++) if (!hidden[t]) for (let k = 0; k < 3; k++) dvis[F[t * 3 + k]] = 0;
  heapDijkstra(nV, off, adj, len, dvis);
  // nearest mesh vertex of a point (1 mm grid)
  const vg = new Map(), vk = (x, y, z) => `${x},${y},${z}`;
  for (let v = 0; v < nV; v++) if (used[v]) { const k = vk(Math.floor(X[v * 3]), Math.floor(X[v * 3 + 1]), Math.floor(X[v * 3 + 2])); if (!vg.has(k)) vg.set(k, []); vg.get(k).push(v); }
  // raw (unsmoothed) vertex normals
  const RN = new Float64Array(nV * 3);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) RN[F[t * 3 + k] * 3 + j] += SN[t * 3 + j] * A[t];
  for (let v = 0; v < nV; v++) { const l = Math.hypot(RN[v * 3], RN[v * 3 + 1], RN[v * 3 + 2]) || 1; for (let j = 0; j < 3; j++) RN[v * 3 + j] /= l; }
  // nearest mesh vertex of a point (optionally only vertices whose normal is within 78° of dir)
  const nearestV = (p2, dir = null) => {
    const c = p2.map(Math.floor);
    let best = -1, bd = Infinity;
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) for (const v of vg.get(vk(c[0] + x, c[1] + y, c[2] + z)) || []) {
      if (dir && RN[v * 3] * dir[0] + RN[v * 3 + 1] * dir[1] + RN[v * 3 + 2] * dir[2] < 0.2) continue;
      const dd = (X[v * 3] - p2[0]) ** 2 + (X[v * 3 + 1] - p2[1]) ** 2 + (X[v * 3 + 2] - p2[2]) ** 2;
      if (dd < bd) { bd = dd; best = v; }
    }
    return best;
  };
  const THIN = o.minSkin + 0.2;
  // painted islands of (near) zero area (specks along an edge) are not real paint
  const speck = new Uint8Array(nT);
  {
    const vt = Array.from({ length: nV }, () => []), seen = new Uint8Array(nT);
    for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) vt[F[t * 3 + k]].push(t);
    for (let t0 = 0; t0 < nT; t0++) {
      if (seen[t0] || triColor[t0] === base || hidden[t0]) continue;
      const q = [t0];
      seen[t0] = 1;
      let a = 0;
      for (let i = 0; i < q.length; i++) {
        const t = q[i];
        a += A[t];
        for (let k = 0; k < 3; k++) for (const u of vt[F[t * 3 + k]]) if (!seen[u] && !hidden[u] && triColor[u] === triColor[t0]) { seen[u] = 1; q.push(u); }
      }
      if (a < 0.5) for (const t of q) speck[t] = 1;
    }
  }
  // front/back seam: one vertical plane per separate body (each object of the file), placed where the fewest
  // painted faces look the wrong way (through the middle of round parts) -> straight seams, like a mould parting line
  const isl = new Int32Array(nV).fill(-1), planeH = [];
  const twins = new Map();
  for (let v = nV0; v < nV; v++) { const s = vOrig[v]; if (!twins.has(s)) twins.set(s, [s]); twins.get(s).push(v); }
  let nIsl = 0;
  for (let v = 0; v < nV; v++) {
    if (!used[v] || isl[v] >= 0) continue;
    const q = [v];
    isl[v] = nIsl;
    for (let i = 0; i < q.length; i++) {
      for (let k = off[q[i]]; k < off[q[i] + 1]; k++) { const u = adj[k]; if (isl[u] < 0) { isl[u] = nIsl; q.push(u); } }
      for (const u of twins.get(vOrig[q[i]]) || []) if (isl[u] < 0) { isl[u] = nIsl; q.push(u); }
    }
    nIsl++;
  }
  const axI = cutAxis ? (cutAxis[0] ? 0 : 1) : 0, axS = cutAxis ? cutAxis[axI] : 1;
  if (cutAxis) {
    const lo = new Float64Array(nIsl).fill(Infinity), hi = new Float64Array(nIsl).fill(-Infinity), fs = Array.from({ length: nIsl }, () => []);
    for (let t = 0; t < nT; t++) {
      const i = isl[F[t * 3]], x = ((X[F[t * 3] * 3 + axI] + X[F[t * 3 + 1] * 3 + axI] + X[F[t * 3 + 2] * 3 + axI]) / 3) * axS;
      lo[i] = Math.min(lo[i], x); hi[i] = Math.max(hi[i], x);
      if (hidden[t] || triColor[t] === base) continue;
      const nn = N[t * 3 + axI] * axS;
      if (Math.abs(nn) > 0.05) fs[i].push([x, nn > 0, A[t]]);
    }
    for (let i = 0; i < nIsl; i++) {
      let bestC = Infinity, bl = (lo[i] + hi[i]) / 2, bh = bl;
      if (fs[i].length) for (let h = lo[i] + 1; h <= hi[i] - 1; h += 0.25) {
        let c = 0;
        for (const [x, fr, a] of fs[i]) if ((x >= h) !== fr) c += a;
        if (c < bestC - 1e-6) { bestC = c; bl = bh = h; } else if (Math.abs(c - bestC) <= 1e-6 && h - bh <= 0.26) bh = h;
      }
      planeH.push((bl + bh) / 2);
    }
  }
  // wall thickness → cover thickness per vertex (keeps minWall of base under the recess)
  const tv = new Float64Array(nV).fill(o.depth);
  for (let t = 0; t < nT; t++) if (TH[t] < 90) for (let k = 0; k < 3; k++) { const v = F[t * 3 + k]; tv[v] = Math.min(tv[v], Math.max(o.minSkin, TH[t] - o.minWall)); }
  smooth(tv, 3);

  const c2 = o.clearance / 2;
  const fields = []; // { color, d }
  const pieces = []; // { color, h, axis }
  for (const col of colors) {
    progress('Covers: bordes suaves', 0.25);
    const wv = new Float64Array(nV), ws = new Float64Array(nV);
    for (let t = 0; t < nT; t++) {
      if (hidden[t]) continue;
      for (let k = 0; k < 3; k++) { const v = F[t * 3 + k]; ws[v] += A[t]; if (triColor[t] === col) wv[v] += A[t]; }
    }
    const phi = new Float64Array(nV).fill(NaN);
    let front = [];
    for (let v = 0; v < nV; v++) if (used[v] && ws[v] > 0) { phi[v] = wv[v] / ws[v] - 0.5; if (phi[v] === 0) phi[v] = -1e-6; }
    for (let v = 0; v < nV; v++) if (used[v] && Number.isNaN(phi[v])) front.push(v);
    while (front.length) {
      const set = [], rest2 = [];
      for (const v of front) {
        let s = 0, n = 0;
        for (let k = off[v]; k < off[v + 1]; k++) if (!Number.isNaN(phi[adj[k]])) { s += phi[adj[k]]; n++; }
        if (n) set.push([v, s / n]); else rest2.push(v);
      }
      if (!set.length) { for (const v of rest2) phi[v] = -0.5; break; }
      for (const [v, x] of set) phi[v] = x || -1e-6;
      front = rest2;
    }
    let d = smooth(signedDist(phi), SMOOTH);
   
    d = morph(d, o.coverFeature / 2);
    // colour guessed under a solid part may not spill onto visible base-colour surface (max 1.2 mm from real paint)
    const dv = new Float64Array(nV).fill(Infinity);
    for (let t = 0; t < nT; t++) if (!hidden[t] && !speck[t] && triColor[t] === col) for (let k = 0; k < 3; k++) dv[F[t * 3 + k]] = 0;
    heapDijkstra(nV, off, adj, len, dv);
    for (let v = 0; v < nV; v++) d[v] = Math.min(d[v], 1.2 - dv[v], 0.8 - dvis[v]);
    // ...nor round a sharp crease (> 60°) onto a visible face that faces another way than the paint it came from
    {
      const pn = new Float64Array(nV * 3), un = new Float64Array(nV * 3);
      for (let t = 0; t < nT; t++) {
        if (hidden[t]) continue;
        const tg = !speck[t] && triColor[t] === col ? pn : un;
        for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) tg[F[t * 3 + k] * 3 + j] += SN[t * 3 + j] * A[t];
      }
      const src = new Int32Array(nV).fill(-1), ord = [];
      for (let v = 0; v < nV; v++) if (dv[v] === 0) src[v] = v; else if (dv[v] < 1.2) ord.push(v);
      ord.sort((a, b) => dv[a] - dv[b]);
      for (const v of ord) {
        let bu = -1, bd = Infinity;
        for (let k = off[v]; k < off[v + 1]; k++) { const u = adj[k]; if (src[u] >= 0 && dv[u] + len[k] < bd) { bd = dv[u] + len[k]; bu = u; } }
        if (bu < 0) continue;
        src[v] = src[bu];
        if (dvis[v] > 0) continue;
        const s = src[v], l = (Math.hypot(pn[s * 3], pn[s * 3 + 1], pn[s * 3 + 2]) * Math.hypot(un[v * 3], un[v * 3 + 1], un[v * 3 + 2])) || 1;
        if ((un[v * 3] * pn[s * 3] + un[v * 3 + 1] * pn[s * 3 + 1] + un[v * 3 + 2] * pn[s * 3 + 2]) / l < 0.5) d[v] = Math.min(d[v], -dv[v]);
      }
    }
   
    // walls thinner than minSkin + 0.2 whose other face is visible and not this colour (a fin beside a bow tab): a
    // cover there would go right through and show on the other side, so that spot keeps the base colour
    if (thickBody) {
      const thin = new Float64Array(nV).fill(Infinity);
      const rn = new Float64Array(nV * 3);
      for (let t = 0; t < nT; t++) if (triColor[t] === col) for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) rn[F[t * 3 + k] * 3 + j] += SN[t * 3 + j] * A[t];
      const mz = M.boundingBox().max[2] + 5;
      const outside = (q) => M.rayCast(q, [q[0] + 0.0123, q[1] + 0.0071, mz]).length % 2 === 0;
      for (let v = 0; v < nV; v++) {
        if (!used[v] || d[v] < -0.5) continue;
        const c = [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]], n = [VN[v * 3], VN[v * 3 + 1], VN[v * 3 + 2]];
        // inwards along the (smoothed and raw painted) normal and along the front/back axis (knife edges are thin
        // across, not along the normal)
        const dirs = [n];
        const rl = Math.hypot(rn[v * 3], rn[v * 3 + 1], rn[v * 3 + 2]);
        if (rl > 1e-9) dirs.push([rn[v * 3] / rl, rn[v * 3 + 1] / rl, rn[v * 3 + 2] / rl]);
        if (cutAxis) { const k = dot(n, cutAxis); if (Math.abs(k) > 0.2) dirs.push(scl(cutAxis, k > 0 ? 1 : -1)); }
        for (const dn of dirs) {
          const S = THIN + 0.5, hits = thickBody.rayCast(sub(c, scl(dn, 0.02)), sub(c, scl(dn, S))).sort((a, b) => a.distance - b.distance);
          // the first hit that leads out of the model is the far face of the wall (touching shells / slits inside
          // the model are not)
          for (const h of hits) {
            const L = 0.02 + h.distance * (S - 0.02);
            if (L > THIN) break;
            if (!outside(sub(c, scl(dn, L + 0.05)))) continue;
            // the far face looks the other way
            const u = nearestV(sub(c, scl(dn, L)), scl(dn, -1));
            // only a wall with (nearly) parallel faces; the tip of a wedge (knife edge) is taken whole by the cover
            // instead of chopping notches into the paint along it
            const par = u >= 0 && -(RN[u * 3] * dn[0] + RN[u * 3 + 1] * dn[1] + RN[u * 3 + 2] * dn[2]) > 0.85;
            if (par && dv[u] > 0.05 && dvis[u] === 0) thin[v] = Math.min(thin[v], L);
            break;
          }
        }
      }
      for (let v = 0; v < nV; v++) if (thin[v] < Infinity) d[v] = Math.min(d[v], (thin[v] - THIN) * 2);
    }
   
    const D = refine(d);
    d = D.v;
    // the other face of a split crease is never part of this colour's patch
    if (twins.size) {
      const isC = new Uint8Array(nV);
      for (let t = 0; t < nT; t++) if (triColor[t] === col) for (let k = 0; k < 3; k++) isC[F[t * 3 + k]] = 1;
      for (const g of twins.values()) if (g.some((u) => isC[u])) for (const u of g) if (!isC[u]) d[u] = Math.min(d[u], -0.3);
    }
    // normals of the painted surface only: at sharp rims (holes, edges) the unpainted side must not bend them
    const NC = new Float64Array(VN);
    const nw = new Float64Array(nV * 3), hasC = new Uint8Array(nV);
    for (let t = 0; t < nT; t++) {
      if (hidden[t] || triColor[t] !== col) continue;
      for (let k = 0; k < 3; k++) { const v = F[t * 3 + k]; hasC[v] = 1; for (let j = 0; j < 3; j++) nw[v * 3 + j] += SN[t * 3 + j] * A[t]; }
    }
    for (let v = 0; v < nV; v++) if (hasC[v]) { const q = norm([nw[v * 3], nw[v * 3 + 1], nw[v * 3 + 2]]); NC[v * 3] = q[0]; NC[v * 3 + 1] = q[1]; NC[v * 3 + 2] = q[2]; }
    for (let r = 0; r < 4; r++) {
      const nx = new Float64Array(NC);
      for (let v = 0; v < nV; v++) {
        if (!used[v]) continue;
        let x = NC[v * 3], y = NC[v * 3 + 1], z = NC[v * 3 + 2];
        for (let k = off[v]; k < off[v + 1]; k++) {
          const q = adj[k], c = NC[q * 3] * NC[v * 3] + NC[q * 3 + 1] * NC[v * 3 + 1] + NC[q * 3 + 2] * NC[v * 3 + 2];
          if (c > 0.8) { x += NC[q * 3]; y += NC[q * 3 + 1]; z += NC[q * 3 + 2]; }
        }
        const l = Math.hypot(x, y, z) || 1;
        nx[v * 3] = x / l; nx[v * 3 + 1] = y / l; nx[v * 3 + 2] = z / l;
      }
      NC.set(nx);
    }
    // on a split crease the cover wall runs along the bisector (a mitre): neither face is thinned to a knife edge
    for (const g of twins.values()) {
      const m = [0, 0, 0];
      for (const u of g) for (let j = 0; j < 3; j++) m[j] += RN[u * 3 + j];
      // a knife edge (faces > ~105° apart) has no useful bisector: keep the painted normal there
      if (Math.hypot(...m) < 0.6 * g.length) continue;
      const q = norm(m);
      for (const u of g) if (hasC[u]) for (let j = 0; j < 3; j++) NC[u * 3 + j] = q[j];
    }
    D.n = NC;
    for (let v = 0; v < nV; v++) if (Math.abs(d[v]) < 1e-5) d[v] = -1e-5;
    fields.push({ color: col, d: D });

    // connected patches
    const comp = new Int32Array(nV).fill(-1);
    let nc = 0;
    for (let v = 0; v < nV; v++) {
      if (!used[v] || d[v] <= 0 || comp[v] >= 0) continue;
      const q = [v];
      comp[v] = nc;
      for (let i = 0; i < q.length; i++) for (let k = off[q[i]]; k < off[q[i] + 1]; k++) { const u = adj[k]; if (d[u] > 0 && comp[u] < 0) { comp[u] = nc; q.push(u); } }
      nc++;
    }
    for (let ci = 0; ci < nc; ci++) {
      const inC = (v) => comp[v] === ci;
      const trisC = [];
      let area = 0;
      for (let t = 0; t < nT; t++) if (!hidden[t] && inC(F[t * 3]) && inC(F[t * 3 + 1]) && inC(F[t * 3 + 2])) { trisC.push(t); area += A[t]; }
      if (area < o.minArea) continue;
      const meanN = (tris) => { const m = [0, 0, 0]; for (const t of tris) for (let k = 0; k < 3; k++) m[k] += SN[t * 3 + k] * A[t]; return norm(m); };
      const undercut = (tris, m) => { let u = 0, a = 0; for (const t of tris) { a += A[t]; if (SN[t * 3] * m[0] + SN[t * 3 + 1] * m[1] + SN[t * 3 + 2] * m[2] < 0.05) u += A[t]; } return u / (a || 1); };
      const m = meanN(trisC);
      const base0 = (s, at) => {
        const h = new Float64Array(nV).fill(-1), raw = new Float64Array(nV);
        for (let v = 0; v < nV; v++) { raw[v] = s(v); if (inC(v)) h[v] = raw[v] || -1e-6; }
        return { v: h, at, n: NC, raw };
      };
      if (undercut(trisC, m) <= 0.01 || !cutAxis) { pieces.push({ color: col, h: base0((v) => d[v] - c2, (a, b, s2) => D.at(a, b, s2) - c2), r: base0((v) => d[v], D.at), axis: m, area }); continue; }
      // wraps around: front / back covers split by the body's vertical plane (exact, straight seam);
      // if one side would be a crumb the patch stays whole
      const h0 = planeH[isl[F[trisC[0] * 3]]];
      const g = new Float64Array(nV);
      for (let v = 0; v < nV; v++) g[v] = X[v * 3 + axI] * axS - h0 || -1e-6;
      const GD = { v: g, at: (a, b, s2) => g[a] + (g[b] - g[a]) * s2 }, gd = g;
      const sideArea = (s) => trisC.reduce((x, t) => x + (s * (g[F[t * 3]] + g[F[t * 3 + 1]] + g[F[t * 3 + 2]]) > 0 ? A[t] : 0), 0);
      if (sideArea(1) < o.minTile || sideArea(-1) < o.minTile) {
        const sd0 = sideArea(1) >= sideArea(-1) ? 1 : -1;
        pieces.push({ color: col, h: base0((v) => d[v] - c2, (a, b, s2) => D.at(a, b, s2) - c2), r: base0((v) => d[v], D.at), axis: undercut(trisC, m) <= 0.01 ? m : scl(cutAxis, sd0), area, side: sd0 > 0 ? 0 : 1 });
        continue;
      }
      for (const s of [1, -1]) {
        // only the surface that faces this side: crevices looking the other way (behind a bow, in a slot) stay base
        const fa = new Float64Array(nV);
        for (let v = 0; v < nV; v++) fa[v] = ((VN[v * 3] * cutAxis[0] + VN[v * 3 + 1] * cutAxis[1] + VN[v * 3 + 2] * cutAxis[2]) * s + 0.3) * 4;
        const fat = (a, b, s2) => fa[a] + (fa[b] - fa[a]) * s2;
        const h = base0((v) => Math.min(d[v] - c2, s * gd[v] - c2 / 2, fa[v] - c2), (a, b, s2) => Math.min(D.at(a, b, s2) - c2, s * GD.at(a, b, s2) - c2 / 2, fat(a, b, s2) - c2));
        const tris = trisC.filter((t) => h.v[F[t * 3]] > 0 && h.v[F[t * 3 + 1]] > 0 && h.v[F[t * 3 + 2]] > 0);
        const a = tris.reduce((x, t) => x + A[t], 0);
        if (a < o.minArea) continue;
        const ms = meanN(tris), ax = scl(cutAxis, s);
        // recess of this piece: no clearance, and overlapping the other side a little so the split leaves no wall
        const r = base0((v) => Math.min(d[v], s * gd[v] + c2, fa[v]), (a2, b2, s2) => Math.min(D.at(a2, b2, s2), s * GD.at(a2, b2, s2) + c2, fat(a2, b2, s2)));
        pieces.push({ color: col, h, r, axis: undercut(tris, ms) <= 0.01 ? ms : ax, area: a, side: s > 0 ? 0 : 1 });
      }
    }
  }

  // closed shell between the surface patch {h > 0} (pushed e out) and its copy t(v) inside, walls along the normals
  const shell = (H, e = 0.4, extra = 0) => {
    const h = H.v, VN = H.n || VNg;
    const key = new Map(), P2 = [], NN = [], TT = [], tops = [];
    const vid = (k, a, b, s) => {
      let i = key.get(k);
      if (i !== undefined) return i;
      i = P2.length / 3;
      key.set(k, i);
      for (let j = 0; j < 3; j++) { P2.push(X[a * 3 + j] + (X[b * 3 + j] - X[a * 3 + j]) * s); NN.push(VN[a * 3 + j] + (VN[b * 3 + j] - VN[a * 3 + j]) * s); }
      TT.push(tv[a] + (tv[b] - tv[a]) * s + extra);
      return i;
    };
    for (let t = 0; t < nT; t++) {
      const vs = [F[t * 3], F[t * 3 + 1], F[t * 3 + 2]];
      if (h[vs[0]] <= 0 && h[vs[1]] <= 0 && h[vs[2]] <= 0) continue;
      const poly = [];
      for (let i = 0; i < 3; i++) {
        const a = vs[i], b = vs[(i + 1) % 3];
        if (h[a] > 0) poly.push(vid(a, a, a, 0));
        if ((h[a] > 0) !== (h[b] > 0)) {
          const lo = Math.min(a, b), hi = Math.max(a, b);
          const k = nV + eIdx.get(lo * 4294967296 + hi);
          let s0 = 0, s1 = 1;
          if (!key.has(k)) for (let it = 0; it < 14; it++) { const sm = (s0 + s1) / 2; if ((H.at(lo, hi, sm) > 0) === (h[lo] > 0)) s0 = sm; else s1 = sm; }
          poly.push(vid(k, lo, hi, (s0 + s1) / 2));
        }
      }
      for (let i = 1; i + 1 < poly.length; i++) tops.push(poly[0], poly[i], poly[i + 1]);
    }
    if (!tops.length) return null;
    const n0 = P2.length / 3, VP = new Float32Array(n0 * 6);
    const UN = new Float64Array(n0 * 3);
    for (let i = 0; i < n0; i++) { const nv = norm([NN[i * 3], NN[i * 3 + 1], NN[i * 3 + 2]]); UN[i * 3] = nv[0]; UN[i * 3 + 1] = nv[1]; UN[i * 3 + 2] = nv[2]; }
    // the inner copy may not fold over (normals converging at a knife edge / tight concave spot): where an inner
    // triangle turns against its top triangle, the offset there shrinks until it does not (no self-intersecting
    // shell -> no spikes left by the boolean)
    for (let it = 0; it < 12; it++) {
      let bad = 0;
      const shrink = new Uint8Array(n0);
      for (let i = 0; i < tops.length; i += 3) {
        const q = [tops[i], tops[i + 1], tops[i + 2]];
        const pt = (v) => [P2[v * 3], P2[v * 3 + 1], P2[v * 3 + 2]], pi = (v) => sub(pt(v), scl([UN[v * 3], UN[v * 3 + 1], UN[v * 3 + 2]], TT[v]));
        const nt = cross(sub(pt(q[1]), pt(q[0])), sub(pt(q[2]), pt(q[0]))), ni = cross(sub(pi(q[1]), pi(q[0])), sub(pi(q[2]), pi(q[0])));
        const lt = Math.hypot(...nt), li = Math.hypot(...ni);
        if (lt < 1e-12) continue;
        if (dot(nt, ni) < 0.2 * lt * li || li < 0.02 * lt) { bad++; for (const v of q) shrink[v] = 1; }
      }
      if (!bad) break;
      for (let v = 0; v < n0; v++) if (shrink[v]) TT[v] *= 0.6;
    }
    for (let i = 0; i < n0; i++) {
      for (let j = 0; j < 3; j++) { VP[i * 3 + j] = P2[i * 3 + j] + UN[i * 3 + j] * e; VP[(n0 + i) * 3 + j] = P2[i * 3 + j] - UN[i * 3 + j] * TT[i]; }
    }
    const dir = new Set();
    for (let i = 0; i < tops.length; i += 3) for (let k = 0; k < 3; k++) dir.add(tops[i + k] * 4194304 + tops[i + (k + 1) % 3]);
    const tri = [...tops];
    for (let i = 0; i < tops.length; i += 3) tri.push(tops[i] + n0, tops[i + 2] + n0, tops[i + 1] + n0);
    for (const k of dir) {
      const a = Math.floor(k / 4194304), b = k % 4194304;
      if (dir.has(b * 4194304 + a)) continue;
      tri.push(b, a, a + n0, b, a + n0, b + n0);
    }
    try {
      const man = new Manifold(new w.Mesh({ numProp: 3, vertProperties: VP, triVerts: new Uint32Array(tri) }));
      return keep(man);
    } catch (err) {
      return null;
    }
  };

  progress('Covers: tallando la base', 0.45);
  const parts = [];
  // one recess per cover piece (a single shell for a whole colour can fold onto itself where two painted
  // surfaces meet at a tight angle, e.g. ear against head, and the boolean then leaves patches uncut)
  const recesses = pieces.map((pc) => shell(pc.r, 0.4)).filter(Boolean);
  let body = M;
  if (recesses.length) body = keep(body.subtract(keep(Manifold.union(recesses))));
  if (solidUnion && !o.solidCovers) body = keep(body.subtract(solidUnion));
  let bodyPieces = body.decompose().map(keep).filter((p) => p.volume() > 1).sort((a, b) => b.volume() - a.volume());
  const slivers = bodyPieces.filter((p, i) => i > 0 && p.volume() < 10);
  if (slivers.length) { bodyPieces = bodyPieces.filter((p) => !slivers.includes(p)); warnings.push(`${slivers.length} astillas del color base (< 10 mm³) no se imprimen`); }
  const nObj = M.decompose().filter((p) => p.volume() > 1).length;
  if (bodyPieces.length > nObj) warnings.push(`la base quedó en ${bodyPieces.length} piezas (paredes delgadas)`);
  for (const bp of bodyPieces) parts.push({ kind: 'body', color: base, man: bp, up: null });

  progress('Covers: piezas de color', 0.6);
  let failed = 0, crumbs = 0, blockedArea = 0;
  const done = [], back = [];
  pieces.forEach((pc, i) => {
    progress(`Covers: pieza ${i + 1}/${pieces.length}`, 0.6 + (0.2 * i) / pieces.length);
    const sh = shell(pc.h, 0.4);
    if (!sh) { failed++; return; }
    let man = keep(sh.intersect(M));
    if (solidUnion) man = keep(man.subtract(solidUnion));
    if (done.length) man = keep(man.subtract(keep(Manifold.union(done))));
    // a cover face lying on visible model surface outside its own patch is the cover showing through a wall thinner
    // than itself (a ledge or fin beside a tab): that bit is cut off and stays in the base colour
    const mzTop = M.boundingBox().max[2] + 5;
    const pokeCut = (m0) => {
      const mesh = m0.getMesh(), np = mesh.numProp, P = mesh.vertProperties, T = mesh.triVerts, cut = [];
      for (let i = 0; i < T.length; i += 3) {
        const q = [0, 1, 2].map((k) => [P[T[i + k] * np], P[T[i + k] * np + 1], P[T[i + k] * np + 2]]);
        const nn = cross(sub(q[1], q[0]), sub(q[2], q[0])), l = Math.hypot(...nn);
        if (l < 2e-3) continue;
        const n = scl(nn, 1 / l), c = scl(add(add(q[0], q[1]), q[2]), 1 / 3);
        const u = nearestV(c, n);
        if (u < 0 || dvis[u] > 0) continue;
        const pu = [X[u * 3] - c[0], X[u * 3 + 1] - c[1], X[u * 3 + 2] - c[2]];
        // h is distance-like: well outside the patch even at the face itself (any copy of a vertex on a split crease)
        if (Math.abs(dot(pu, n)) > 0.08 || Math.max(...(twins.get(vOrig[u]) || [u]).map((x) => pc.h.raw[x])) + Math.hypot(...pu) > -0.1) continue;
        // lying on that surface, not just touching it along an edge (the mitre of a cover at a split crease)
        if (RN[u * 3] * n[0] + RN[u * 3 + 1] * n[1] + RN[u * 3 + 2] * n[2] < 0.9) continue;
        // on the outside of the model (not a face of an overlapping shell buried inside it)
        const qo = [X[u * 3] + RN[u * 3] * 0.1, X[u * 3 + 1] + RN[u * 3 + 1] * 0.1, X[u * 3 + 2] + RN[u * 3 + 2] * 0.1];
        if (M.rayCast(qo, [qo[0] + 0.0123, qo[1] + 0.0071, mzTop]).length % 2) continue;
        // the face itself is exposed (just outside it is outside the model), not buried under a skin of base
        const qf = add(c, scl(n, 0.03));
        if (M.rayCast(qf, [qf[0] + 0.0123, qf[1] + 0.0071, mzTop]).length % 2) continue;
        const g = q.map((p) => add(p, scl(sub(p, c), 0.15 / Math.max(0.05, Math.hypot(...sub(p, c))))));
        cut.push(Manifold.hull([...g.map((p) => add(p, scl(n, 0.1))), ...g.map((p) => sub(p, scl(n, 0.6)))]));
      }
      // many hits mean the shell just hugs a split crease, not a thin wall: unioning them all is unstable
      if (!cut.length || cut.length > 40) return [m0];
      const U = keep(Manifold.union(cut.map(keep)));
      back.push(keep(m0.intersect(U)));
      return keep(m0.subtract(U)).decompose().map(keep);
    };
    // crumbs and the zero-volume sheets a boolean leaves along shared faces go to the base before anything else
    const comps = [];
    for (const c0 of man.decompose().map(keep)) {
      if (c0.volume() < o.minCover) { if (c0.volume() > 1) crumbs++; back.push(c0); continue; }
      comps.push(...pokeCut(c0));
    }
    comps.sort((a, b) => b.volume() - a.volume());
    for (const cm of comps) {
      if (cm.volume() < o.minCover) { if (cm.volume() > 1) crumbs++; back.push(cm); continue; }
      parts.push({ kind: 'cover', color: pc.color, man: cm, up: pc.axis, n: pc.axis, half: pc.side });
      done.push(cm);
    }
    // seating: the last few mm in along the axis must be free
    let bl = 0;
    for (let t = 0; t < nT; t += 1) {
      const vs = [F[t * 3], F[t * 3 + 1], F[t * 3 + 2]];
      if (hidden[t] || !(pc.h.v[vs[0]] > 0 && pc.h.v[vs[1]] > 0 && pc.h.v[vs[2]] > 0) || t % 5) continue;
      const c = [0, 1, 2].map((k) => (X[vs[0] * 3 + k] + X[vs[1] * 3 + k] + X[vs[2] * 3 + k]) / 3);
      if (M.rayCast(add(c, scl(pc.axis, 0.3)), add(c, scl(pc.axis, 12))).length) bl += A[t] * 5;
    }
    blockedArea += bl;
  });
  if (failed) warnings.push(`${failed} covers no se pudieron construir`);
  if (crumbs) warnings.push(`${crumbs} migajas de color (< ${o.minCover} mm³) quedan del color base`);
  if (back.length) {
    const bi = parts.findIndex((p) => p.kind === 'body');
    if (bi >= 0) parts[bi].man = keep(Manifold.union([parts[bi].man, ...back]));
  }
  if (blockedArea > 5) warnings.push(`${Math.round(blockedArea)} mm² de covers quedan bajo otra parte del modelo: colócalos inclinándolos`);
  return parts;
}

// Orientation with the least unsupported overhang (candidate "up" directions)
function bestUp(mesh) {
  const { V, T } = mesh;
  const cands = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
  let best = cands[0], bestScore = Infinity;
  for (const up of cands) {
    let minH = Infinity;
    for (let i = 0; i < V.length; i += 3) minH = Math.min(minH, V[i] * up[0] + V[i + 1] * up[1] + V[i + 2] * up[2]);
    let score = 0;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const n = cross([V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]], [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]]);
      const l = Math.hypot(...n) || 1;
      const cz = dot(n, up) / l;
      const h = (V[a] * up[0] + V[a + 1] * up[1] + V[a + 2] * up[2]) - minH;
      if (cz < -0.7 && h > 0.3) score += l / 2;
    }
    if (score < bestScore - 1e-6) { bestScore = score; best = up; }
  }
  return best;
}

// rotation that maps `up` to +Z, then rest on z=0 and center in XY
export function printPose(mesh, up) {
  const f = frameFor(up);
  const { V } = mesh;
  const R = [f.u, f.v, f.n];
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < V.length; i += 3) {
    const p = [V[i], V[i + 1], V[i + 2]];
    for (let k = 0; k < 3; k++) { const q = dot(R[k], p); if (q < mn[k]) mn[k] = q; if (q > mx[k]) mx[k] = q; }
  }
  return { R, t: [-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]], size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}

export function applyPose(mesh, pose, dx = 0, dy = 0, rot = false) {
  const V = new Float32Array(mesh.V.length);
  for (let i = 0; i < V.length; i += 3) {
    const p = [mesh.V[i], mesh.V[i + 1], mesh.V[i + 2]];
    const x = dot(pose.R[0], p) + pose.t[0], y = dot(pose.R[1], p) + pose.t[1];
    V[i] = (rot ? -y : x) + dx;
    V[i + 1] = (rot ? x : y) + dy;
    V[i + 2] = dot(pose.R[2], p) + pose.t[2];
  }
  return { V, T: mesh.T };
}

// Shelf packing of printed footprints on plates of plateW × plateH; returns [{ plate, x, y, rot }] per item
// (rot = true → the part is turned 90° to fit the bed)
export function layoutPlates(sizes, plateW = 256, gap = 3, plateH = plateW) {
  const items = sizes.map((s, i) => {
    let [w, h] = s, rot = false;
    if ((w > plateW - 2 * gap || h > w) && h <= plateW - 2 * gap && w <= plateH - 2 * gap) { [w, h] = [h, w]; rot = true; }
    return { i, w, h, rot };
  });
  items.sort((a, b) => b.h - a.h || b.w - a.w);
  const res = new Array(sizes.length);
  let p = 0, x = gap, y = gap, rowH = 0;
  for (const { i, w, h, rot } of items) {
    if (x + w + gap > plateW && x > gap) { x = gap; y += rowH + gap; rowH = 0; }
    if (y + h + gap > plateH && (x > gap || y > gap)) { p++; x = gap; y = gap; rowH = 0; }
    res[i] = { plate: p, x: x + w / 2, y: y + h / 2, rot, fits: w + 2 * gap <= plateW + 1e-6 && h + 2 * gap <= plateH + 1e-6 };
    x += w + gap;
    rowH = Math.max(rowH, h);
  }
  return res;
}
