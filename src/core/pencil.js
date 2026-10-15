import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

let engine, loading;
export async function preparePencil(settings) {
  if (!settings.pencil?.enabled || settings.pencil.mount !== 'integrated') return;
  if (!loading) loading = import('../../node_modules/manifold-3d/manifold.js')
    .then(({ default: init }) => init()).then((w) => { w.setup(); engine = w; })
    .catch((err) => { loading = null; throw err; });
  await loading;
}

export function joinedPencilGeometry(geometries) {
  if (!engine) throw new Error('El motor del canal integrado todavía no está preparado.');
  const owned = [];
  try {
    for (const g of geometries) {
      const mesh = new engine.Mesh({ numProp: 3, vertProperties: g.attributes.position.array, triVerts: g.index.array });
      mesh.merge();
      const man = new engine.Manifold(mesh); owned.push(man);
      if (man.status() !== 'NoError') throw new Error('Una pieza del nombre no es sólida: cambia la fuente o el grosor.');
    }
    const solid = engine.Manifold.union(owned); owned.push(solid);
    const components = solid.decompose(); owned.push(...components);
    if (solid.status() !== 'NoError' || components.length !== 1) throw new Error('El nombre tiene piezas sin apoyo sobre la base.');
    return meshGeometry(solid.getMesh());
  } finally { for (const man of owned.reverse()) man.delete(); }
}

function meshGeometry(m) {
  const positions = new Float32Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) for (let j = 0; j < 3; j++) positions[i * 3 + j] = m.vertProperties[i * m.numProp + j];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(m.triVerts), 1));
  const shaded = toCreasedNormals(geometry, Math.PI / 4);
  geometry.dispose();
  return shaded;
}

// The support strip surrounds the channel along its entire length, including gaps between letters.
export function integratedPencil(shapes, profile, settings, { scale, center, axisY }) {
  if (!engine) throw new Error('El motor del canal integrado todavía no está preparado.');
  const P = settings.pencil, T = settings.base.thickness, wall = P.wall;
  if (!settings.base.enabled) throw new Error('Activa la base para alojar el canal del lápiz.');
  if (![T, wall, P.value, P.tolerance, P.offset].every(Number.isFinite) || wall < 0.8 || P.value <= 0 || P.tolerance < 0) {
    throw new Error('Usa un calibre positivo, holgura no negativa y pared de al menos 0.8 mm.');
  }
  const zs = profile.pts.map(p => p[1]), us = profile.pts.map(p => p[0]);
  const z0 = Math.min(...zs), z1 = Math.max(...zs), u0 = Math.min(...us), u1 = Math.max(...us);
  const minT = z1 - z0 + 2 * wall;
  if (T < minT - 1e-6) throw new Error(`El canal necesita una base de al menos ${minT.toFixed(2)} mm (calibre + paredes).`);
  const { CrossSection } = engine, owned = [];
  const own = v => { owned.push(v); return v; };
  const [cx, cy] = center, s = scale;
  try {
    const loops = shapes.flatMap(sh => [sh.outer, ...sh.holes]).map(loop => loop.map(([x, y]) => [(x - cx) * s, (cy - y) * s]));
    const outline = own(new CrossSection(loops, 'EvenOdd')), bb = outline.bounds();
    const y = (cy - axisY) * s + P.offset, z = (T - z0 - z1) / 2;
    if (y <= bb.min[1] || y >= bb.max[1]) throw new Error('El eje del lápiz queda fuera del nombre: reduce el desplazamiento.');
    const xa = bb.min[0], xb = bb.max[0];
    const radius = (u1 - u0 + 2 * wall) / 2, middle = y + (u0 + u1) / 2;
    if (xb - xa < 2 * radius) throw new Error('El nombre es demasiado corto para este calibre: aumenta el ancho.');
    const capsule = [];
    for (const [x, start] of [[xb - radius, -Math.PI / 2], [xa + radius, Math.PI / 2]]) {
      for (let i = 0; i <= 48; i++) {
        const a = start + Math.PI * i / 48;
        capsule.push([x + radius * Math.cos(a), middle + radius * Math.sin(a)]);
      }
    }
    const strip = own(new CrossSection([capsule]));
    const footprint = own(outline.add(strip));
    const body = own(footprint.extrude(T));
    const channel = own(new CrossSection([profile.pts]));
    // Local XY -> world YZ; local extrusion -> world X. Extend past both end faces.
    const cutter = own(own(channel.extrude(xb - xa + 2)).transform([
      0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, xa - 1, y, z, 1,
    ]));
    const solid = own(body.subtract(cutter));
    if (solid.status() !== 'NoError' || solid.isEmpty()) throw new Error('No se pudo construir una base sólida con el canal.');
    if (solid.decompose().map(own).length !== 1) throw new Error('La base queda separada: activa unir islas o aumenta el margen.');
    const geometry = meshGeometry(solid.getMesh());
    const toImage = loop => loop.map(([x, y]) => [cx + x / s, cy - y / s]);
    const regions = footprint.decompose().map(own).map(cs => {
      const [outer, ...holes] = cs.toPolygons();
      return { outer: toImage(outer), holes: holes.map(toImage) };
    });
    return {
      geometry, footprint: regions,
      channel: { axis: 'x', center: [0, y, z], size: P.value, clearance: P.tolerance, minWall: wall },
    };
  } finally {
    for (const v of owned.reverse()) v.delete();
  }
}
