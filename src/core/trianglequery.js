import { triDist2 } from './colorskin.js';

// Nearest finite painted triangle, including faces too small to be nearest at any voxel corner.
export function triangleQuery(P, np, T, col) {
  const ids = Uint32Array.from({ length: T.length / 3 }, (_, i) => i);
  const centers = new Float64Array(ids.length * 3), nodes = [];
  for (const t of ids) for (let k = 0; k < 3; k++) {
    centers[t * 3 + k] = (P[T[t * 3] * np + k] + P[T[t * 3 + 1] * np + k] + P[T[t * 3 + 2] * np + k]) / 3;
  }
  const build = (start, end) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const c0 = [...lo], c1 = [...hi];
    let color = col[ids[start]];
    for (let i = start; i < end; i++) {
      const t = ids[i];
      if (col[t] !== color) color = -1;
      for (let k = 0; k < 3; k++) {
        c0[k] = Math.min(c0[k], centers[t * 3 + k]); c1[k] = Math.max(c1[k], centers[t * 3 + k]);
        for (let v = 0; v < 3; v++) {
          const x = P[T[t * 3 + v] * np + k];
          lo[k] = Math.min(lo[k], x); hi[k] = Math.max(hi[k], x);
        }
      }
    }
    const index = nodes.length, node = { lo, hi, color, start, end, left: -1, right: -1 };
    nodes.push(node);
    if (end - start > 8) {
      let axis = 0;
      for (let k = 1; k < 3; k++) if (c1[k] - c0[k] > c1[axis] - c0[axis]) axis = k;
      ids.subarray(start, end).sort((a, b) => centers[a * 3 + axis] - centers[b * 3 + axis]);
      const mid = (start + end) >>> 1;
      node.left = build(start, mid); node.right = build(mid, end);
    }
    return index;
  };
  if (ids.length) build(0, ids.length);
  const stack = new Int32Array(64);
  const boxDistance = (node, p) => {
    let d = 0;
    for (let k = 0; k < 3; k++) {
      const x = p[k] < node.lo[k] ? node.lo[k] - p[k] : p[k] > node.hi[k] ? p[k] - node.hi[k] : 0;
      d += x * x;
    }
    return d;
  };
  // only / except: colour index, or -1 for no restriction. out: triangle index and squared distance.
  return (p, only, except, out) => {
    let best = Infinity, triangle = -1, size = nodes.length ? 1 : 0;
    stack[0] = 0;
    while (size) {
      const n = nodes[stack[--size]];
      if (n.color >= 0 && (n.color === except || (only >= 0 && n.color !== only))) continue;
      if (boxDistance(n, p) > best) continue;
      if (n.left >= 0) {
        const a = boxDistance(nodes[n.left], p), b = boxDistance(nodes[n.right], p);
        if (a < b) {
          if (b <= best) stack[size++] = n.right;
          if (a <= best) stack[size++] = n.left;
        } else {
          if (a <= best) stack[size++] = n.left;
          if (b <= best) stack[size++] = n.right;
        }
        continue;
      }
      for (let i = n.start; i < n.end; i++) {
        const t = ids[i];
        if (col[t] === except || (only >= 0 && col[t] !== only)) continue;
        const a = T[t * 3] * np, b = T[t * 3 + 1] * np, c = T[t * 3 + 2] * np;
        const d = triDist2(p[0], p[1], p[2], P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]);
        if (d < best) { best = d; triangle = t; }
      }
    }
    out[0] = triangle; out[1] = best;
  };
}
