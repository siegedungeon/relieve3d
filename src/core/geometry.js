import * as THREE from 'three';

// Tiny deterministic jitter breaks exact collinearity between holes (e.g. letters sharing a baseline),
// which otherwise makes the triangulator create T-junctions (non-watertight meshes).
const jitter = (i, k) => (((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1) * 0.004);
const vec = (p, i, cx, cy) => new THREE.Vector2(p[0] - cx + jitter(i, 1), cy - p[1] + jitter(i, 2));

// Builds an extruded geometry (depth = 1) from shapes given in image-pixel coordinates.
// Output coordinates: x right, y up (image y flipped), centered at (cx, cy).
export function shapesToGeometry(shapes, cx, cy) {
  const tShapes = [];
  for (const s of shapes) {
    const shape = new THREE.Shape(s.outer.map((p, i) => vec(p, i, cx, cy)));
    shape.holes = s.holes.map((h, k) => new THREE.Path(h.map((p, i) => vec(p, i + (k + 1) * 7919, cx, cy))));
    tShapes.push(shape);
  }
  if (!tShapes.length) return null;
  return new THREE.ExtrudeGeometry(tShapes, { depth: 1, bevelEnabled: false, curveSegments: 1, steps: 1 });
}

export function ringGeometry(xPx, yPx, rOutPx, rInPx, cx, cy) {
  const x = xPx - cx, y = cy - yPx;
  const shape = new THREE.Shape();
  shape.absarc(x, y, rOutPx, 0, Math.PI * 2, false);
  if (rInPx > 0 && rInPx < rOutPx) {
    const hole = new THREE.Path();
    hole.absarc(x, y, rInPx, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 64, steps: 1 });
}

// Transforms a unit-depth pixel geometry into a millimetre geometry.
export function toWorld(geometry, scaleXY, height, z) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geometry.getAttribute('position').clone());
  if (geometry.index) g.setIndex(geometry.index.clone());
  g.applyMatrix4(new THREE.Matrix4().makeScale(scaleXY, scaleXY, height));
  g.translate(0, 0, z);
  return g;
}
