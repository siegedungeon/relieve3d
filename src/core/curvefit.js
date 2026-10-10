// Polyline → smooth cubic Bézier fitting (Philip J. Schneider, "An Algorithm for Automatically Fitting Digitized
// Curves", Graphics Gems 1990). Used to turn traced / flattened outlines into few clean curves for laser cutting:
// no stair steps, no spikes, real corners kept as corners.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

function bez(c, t) {
  const u = 1 - t;
  return [
    u * u * u * c[0][0] + 3 * u * u * t * c[1][0] + 3 * u * t * t * c[2][0] + t * t * t * c[3][0],
    u * u * u * c[0][1] + 3 * u * u * t * c[1][1] + 3 * u * t * t * c[2][1] + t * t * t * c[3][1],
  ];
}
function bezD1(c, t) {
  const u = 1 - t;
  return [
    3 * (u * u * (c[1][0] - c[0][0]) + 2 * u * t * (c[2][0] - c[1][0]) + t * t * (c[3][0] - c[2][0])),
    3 * (u * u * (c[1][1] - c[0][1]) + 2 * u * t * (c[2][1] - c[1][1]) + t * t * (c[3][1] - c[2][1])),
  ];
}
function bezD2(c, t) {
  const u = 1 - t;
  return [
    6 * (u * (c[2][0] - 2 * c[1][0] + c[0][0]) + t * (c[3][0] - 2 * c[2][0] + c[1][0])),
    6 * (u * (c[2][1] - 2 * c[1][1] + c[0][1]) + t * (c[3][1] - 2 * c[2][1] + c[1][1])),
  ];
}

function chordParams(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1])));
  const L = u[u.length - 1] || 1;
  return u.map((v) => v / L);
}

function generate(pts, u, t1, t2) {
  const first = pts[0], last = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i], s = 1 - t;
    const a1 = mul(t1, 3 * s * s * t), a2 = mul(t2, 3 * s * t * t);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(first, s * s * s + 3 * s * s * t), mul(last, 3 * s * t * t + t * t * t)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = 0, ar = 0;
  if (Math.abs(det) > 1e-12) { al = (x0 * c11 - x1 * c01) / det; ar = (c00 * x1 - c01 * x0) / det; }
  const seg = len(sub(last, first)), eps = 1e-6 * seg;
  let arc = 0;
  for (let i = 1; i < pts.length; i++) arc += len(sub(pts[i], pts[i - 1]));
  // runaway handles (degenerate systems) → safe heuristic
  if (al < eps || ar < eps || !Number.isFinite(al) || !Number.isFinite(ar) || al > arc || ar > arc) { al = ar = Math.max(seg, arc * 0.5) / 3; }
  return [first, add(first, mul(t1, al)), add(last, mul(t2, ar)), last];
}

function maxError(pts, c, u) {
  let max = 0, idx = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len(sub(bez(c, u[i]), pts[i]));
    if (d > max) { max = d; idx = i; }
  }
  return { max, idx };
}

function reparam(pts, c, u) {
  return u.map((t, i) => {
    const d = sub(bez(c, t), pts[i]), d1 = bezD1(c, t), d2 = bezD2(c, t);
    const den = dot(d1, d1) + dot(d, d2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.min(1, Math.max(0, t - dot(d, d1) / den));
  });
}

function fitCubic(pts, t1, t2, tol, out) {
  if (pts.length === 2) {
    const d = len(sub(pts[1], pts[0])) / 3;
    out.push([pts[0], add(pts[0], mul(t1, d)), add(pts[1], mul(t2, d)), pts[1]]);
    return;
  }
  let u = chordParams(pts);
  let c = generate(pts, u, t1, t2);
  let { max, idx } = maxError(pts, c, u);
  if (max < tol) { out.push(c); return; }
  if (max < tol * 4) {
    for (let k = 0; k < 20; k++) {
      u = reparam(pts, c, u);
      c = generate(pts, u, t1, t2);
      ({ max, idx } = maxError(pts, c, u));
      if (max < tol) { out.push(c); return; }
    }
  }
  idx = Math.min(pts.length - 2, Math.max(1, idx));
  const tc = norm(sub(pts[idx - 1], pts[idx + 1]));
  fitCubic(pts.slice(0, idx + 1), t1, tc, tol, out);
  fitCubic(pts.slice(idx), mul(tc, -1), t2, tol, out);
}

// Removes consecutive duplicates (and the closing duplicate of a closed ring).
function dedupe(pts, closed, minD = 1e-6) {
  const out = [];
  for (const p of pts) if (!out.length || len(sub(p, out[out.length - 1])) > minD) out.push(p);
  if (closed && out.length > 1 && len(sub(out[0], out[out.length - 1])) <= minD) out.pop();
  return out;
}

// Indices of real corners: turning angle above `cornerDeg` measured over a neighbourhood of ~`span` length
// so that fine flattening of a smooth curve never reads as a corner.
function corners(pts, cornerDeg, span) {
  const n = pts.length, res = [];
  const cos = Math.cos((cornerDeg * Math.PI) / 180);
  const back = (i) => { let d = 0, j = i; do { const k = (j - 1 + n) % n; d += len(sub(pts[j], pts[k])); j = k; } while (d < span && j !== (i + 1) % n); return j; };
  const fwd = (i) => { let d = 0, j = i; do { const k = (j + 1) % n; d += len(sub(pts[k], pts[j])); j = k; } while (d < span && j !== (i - 1 + n) % n); return j; };
  const turn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = norm(sub(pts[i], pts[back(i)])), b = norm(sub(pts[fwd(i)], pts[i]));
    turn[i] = dot(a, b);
  }
  for (let i = 0; i < n; i++) {
    if (turn[i] >= cos) continue;
    // keep only the sharpest point within `span` on either side (ties → first index)
    let best = true;
    for (const dir of [-1, 1]) {
      let d = 0, j = i;
      for (let s = 0; s < n - 1; s++) {
        const k = (j + dir + n) % n;
        d += len(sub(pts[k], pts[j])); j = k;
        if (d > span) break;
        if (turn[j] < turn[i] || (turn[j] === turn[i] && j < i)) { best = false; break; }
      }
      if (!best) break;
    }
    if (best) res.push(i);
  }
  return res;
}

// Fits a closed ring of points. Returns an array of cubic segments [[p0,c1,c2,p3], ...] forming a loop.
// tol: max deviation (same units as the points). cornerDeg: turning angle that is kept sharp.
export function fitClosed(points, { tol = 0.05, cornerDeg = 40, span = null } = {}) {
  const pts = dedupe(points, true);
  if (pts.length < 3) return [];
  let per = 0;
  for (let i = 0; i < pts.length; i++) per += len(sub(pts[(i + 1) % pts.length], pts[i]));
  const sp = span ?? Math.max(tol * 4, per / 400);
  let cs = corners(pts, cornerDeg, sp);
  const out = [];
  if (!cs.length) {
    // smooth loop (circle, O): split in two halves at the extreme points with shared tangents
    let far = 0, fd = 0;
    for (let i = 1; i < pts.length; i++) { const d = len(sub(pts[i], pts[0])); if (d > fd) { fd = d; far = i; } }
    cs = [0, far];
    const n = pts.length;
    for (let k = 0; k < 2; k++) {
      const a = cs[k], b = cs[(k + 1) % 2];
      const run = [];
      for (let i = a; ; i = (i + 1) % n) { run.push(pts[i]); if (i === b) break; }
      const ta = norm(sub(pts[(a + 1) % n], pts[(a - 1 + n) % n]));
      const tb = norm(sub(pts[(b - 1 + n) % n], pts[(b + 1) % n]));
      fitCubic(run, ta, tb, tol, out);
    }
    return out;
  }
  const n = pts.length;
  for (let k = 0; k < cs.length; k++) {
    const a = cs[k], b = cs[(k + 1) % cs.length];
    const run = [];
    for (let i = a; ; i = (i + 1) % n) { run.push(pts[i]); if (i === b && run.length > 1) break; }
    if (run.length < 2) continue;
    const t1 = norm(sub(run[1], run[0])), t2 = norm(sub(run[run.length - 2], run[run.length - 1]));
    if (cs.length === 1 && run.length > 3) {
      // single corner: the run is a closed loop, split it at the farthest point with a smooth tangent
      let m = 1, md = 0;
      for (let i = 1; i < run.length - 1; i++) { const d = len(sub(run[i], run[0])); if (d > md) { md = d; m = i; } }
      const tc = norm(sub(run[m - 1], run[m + 1]));
      fitCubic(run.slice(0, m + 1), t1, tc, tol, out);
      fitCubic(run.slice(m), mul(tc, -1), t2, tol, out);
      continue;
    }
    if (run.length === 2 || isStraight(run, tol)) { out.push(line(run[0], run[run.length - 1])); continue; }
    fitCubic(run, t1, t2, tol, out);
  }
  return out;
}

function isStraight(run, tol) {
  const a = run[0], b = run[run.length - 1], d = norm(sub(b, a));
  for (const p of run) { const v = sub(p, a); if (Math.abs(v[0] * d[1] - v[1] * d[0]) > tol) return false; }
  return true;
}
function line(a, b) { return [a, add(a, mul(sub(b, a), 1 / 3)), add(a, mul(sub(b, a), 2 / 3)), b]; }

// Segments → SVG path data. Straight cubics are written as L.
export function cubicsToPath(segs, fmt = (v) => +v.toFixed(3)) {
  if (!segs.length) return '';
  let d = `M${fmt(segs[0][0][0])} ${fmt(segs[0][0][1])}`;
  for (const c of segs) {
    const straight = isStraight([c[0], c[1], c[2], c[3]], 1e-4);
    d += straight ? ` L${fmt(c[3][0])} ${fmt(c[3][1])}` : ` C${fmt(c[1][0])} ${fmt(c[1][1])} ${fmt(c[2][0])} ${fmt(c[2][1])} ${fmt(c[3][0])} ${fmt(c[3][1])}`;
  }
  return d + ' Z';
}
