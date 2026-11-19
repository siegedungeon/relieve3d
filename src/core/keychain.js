import * as THREE from 'three';

let engine, loading;

export function prepareKeychain() {
  return loading ??= import('../../node_modules/manifold-3d/manifold.js')
    .then(({ default: init }) => init())
    .then(w => { w.setup(); engine = w; })
    .catch(error => { loading = null; throw error; });
}

export const FACE_LAYER = 0.2;

// Flat mode partitions only the visible layer. The existing base, including
// its ring and pockets, supplies both the outline and the backing material.
export function buildKeychainGeometry(features, design, states, { scale, center, flat, baseFilament }) {
  if (!engine) throw new Error('El motor de geometría del llavero no está disponible.');
  const { CrossSection, Manifold } = engine;
  const owned = [], created = [];
  const own = value => { owned.push(value); return value; };
  const [cx, cy] = center;
  const profile = shapes => own(new CrossSection(shapes.flatMap(sh => [sh.outer, ...sh.holes])
    .map(loop => loop.map(([x, y]) => [(x - cx) * scale, (cy - y) * scale])), 'EvenOdd'));
  const slab = (cs, z, h) => own(own(cs.extrude(h)).translate([0, 0, z]));
  const union = (solids, type = Manifold) => solids.length === 1 ? solids[0] : own(type.union(solids));
  const mesh = (solid, props) => {
    if (solid.status() !== 'NoError' || solid.isEmpty()) throw new Error('No se pudo generar una malla cerrada para el llavero.');
    const source = solid.getMesh();
    const geometry = new THREE.BufferGeometry();
    created.push(geometry);
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(source.vertProperties), 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(source.triVerts), 1));
    geometry.scale(1 / scale, 1 / scale, 1);
    geometry.computeVertexNormals();
    return { ...props, geometry, volume: solid.volume() };
  };
  try {
    const art = design.pieces.filter(p => states[p.id]?.enabled && p.shapes.length);
    if (!flat) {
      const ring = features.layers.find(l => l.key === 'ring');
      if (!ring || !art.length) return null;
      const outline = profile(ring.shapes);
      const { min, max } = outline.bounds();
      const touching = art.filter(p => {
        const [x0, y0, x1, y1] = p.bbox;
        return x0 <= cx + max[0] / scale && x1 >= cx + min[0] / scale &&
          y0 <= cy - min[1] / scale && y1 >= cy - max[1] / scale;
      }).map(p => ({ state: states[p.id], region: profile(p.shapes) }))
        .filter(({ region }) => !own(outline.intersect(region)).isEmpty());
      if (!touching.length) return null;
      const height = Math.min(ring.height, Math.max(...touching.map(({ state }) => state.elevation + state.height)));
      const artwork = touching.filter(({ state }) => state.elevation < height)
        .map(({ region, state }) => slab(region, state.elevation, state.height));
      if (!artwork.length) return null;
      const tab = own(slab(outline, 0, height).subtract(union(artwork)));
      return { layers: [ring], parts: tab.isEmpty() ? [] : [mesh(tab, { key: 'ring', name: ring.name, fil: ring.fil })], height };
    }

    const layers = features.layers.filter(l => l.fil === 'base' && l.key.startsWith('base'));
    const top = Math.max(...layers.map(l => l.z + l.height));
    const upper = layers.find(l => l.z + l.height === top);
    if (!upper || top < FACE_LAYER + 0.19) throw new Error('La base plana necesita al menos 0,4 mm de grosor.');
    const boundary = profile(upper.shapes);
    const body = union(layers.map(l => slab(profile(l.shapes), l.z, l.height)));
    const groups = new Map();
    for (const p of art) {
      const { filament } = states[p.id];
      if (filament === baseFilament) continue;
      if (!groups.has(filament)) groups.set(filament, []);
      groups.get(filament).push(profile(p.shapes));
    }
    let occupied;
    const inserts = [];
    for (const [fil, sections] of groups) {
      let region = own(union(sections, CrossSection).intersect(boundary));
      if (occupied) region = own(region.subtract(occupied));
      if (region.isEmpty()) continue;
      occupied = occupied ? own(occupied.add(region)) : region;
      const solid = own(body.intersect(slab(region, top - FACE_LAYER, FACE_LAYER)));
      if (!solid.isEmpty()) inserts.push({ fil, solid });
    }
    const backing = inserts.length ? own(body.subtract(union(inserts.map(v => v.solid)))) : body;
    return {
      layers, height: top,
      parts: [mesh(backing, { key: 'face-base', name: 'Base', fil: baseFilament }),
        ...inserts.map(({ fil, solid }) => mesh(solid, { key: 'face-' + fil, fil }))],
    };
  } catch (error) {
    for (const geometry of created) geometry.dispose();
    throw error;
  } finally {
    for (const value of owned.reverse()) value.delete();
  }
}
