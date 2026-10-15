// Multicolor 3MF reader (Bambu Studio / Orca / PrusaSlicer / plain 3MF materials).
// Returns every mesh part in world coordinates with a palette index per triangle:
//   { title, palette: ['#RRGGBB', ...], parts: [{ name, V: Float64Array, T: Uint32Array, tc: Uint8Array }] }
import { unzipSync, strFromU8 } from 'fflate';
import { weldPainted } from './meshweld.js';

const attrRe = new Map();
const attr = (s, name) => {
  let re = attrRe.get(name);
  if (!re) attrRe.set(name, (re = new RegExp(`(?:^|\\s)${name.replace(/[.:]/g, '\\$&')}="([^"]*)"`)));
  const m = re.exec(s);
  return m ? m[1] : null;
};
const parseMat = (s) => {
  if (!s) return null;
  const v = s.trim().split(/\s+/).map(Number);
  return v.length === 12 ? v : null;
};
// 3MF transform "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32" (row vectors: p' = p * M)
const mulMat = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  const r = new Array(12);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    let s = i === 3 ? b[9 + j] : 0;
    for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j];
    r[i * 3 + j] = s;
  }
  return r;
};

// PrusaSlicer/Bambu TriangleSelector bitstream (hex string, read from the end, 4 bits per char).
// Returns a list of { state, weight } leaves (weight = fraction of the parent triangle area) or,
// when `geom` is given, sub-triangles with their state.
export function decodePaint(str, tri) {
  const nib = [];
  for (let i = str.length - 1; i >= 0; i--) nib.push(parseInt(str[i], 16));
  let p = 0;
  const next = () => (p < nib.length ? nib[p++] : 0);
  const out = [];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const rec = (v) => {
    const code = next();
    const sides = code & 3;
    if (!sides) {
      const st = (code & 12) === 12 ? next() + 3 : code >> 2;
      out.push({ state: st, v });
      return;
    }
    const special = code >> 2;
    const r = [v[special], v[(special + 1) % 3], v[(special + 2) % 3]];
    let kids;
    if (sides === 1) {
      const m = mid(r[1], r[2]);
      kids = [[r[0], r[1], m], [m, r[2], r[0]]];
    } else if (sides === 2) {
      const m01 = mid(r[0], r[1]), m02 = mid(r[0], r[2]);
      kids = [[r[0], m01, m02], [m01, r[1], m02], [r[1], r[2], m02]];
    } else {
      const m01 = mid(r[0], r[1]), m12 = mid(r[1], r[2]), m20 = mid(r[2], r[0]);
      kids = [[r[0], m01, m20], [m01, r[1], m12], [m12, r[2], m20], [m01, m12, m20]];
    }
    // children are serialized last-to-first
    for (let k = kids.length - 1; k >= 0; k--) rec(kids[k]);
  };
  rec(tri);
  return out;
}

function parseHexColor(c) {
  if (!c) return null;
  const m = /^#?([0-9a-f]{6})/i.exec(c.trim());
  return m ? '#' + m[1].toUpperCase() : null;
}

export function read3MF(bytes) {
  const files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const get = (p) => {
    const k = Object.keys(files).find((f) => f.toLowerCase() === p.replace(/^\//, '').toLowerCase());
    return k ? strFromU8(files[k]) : null;
  };
  const rootXml = get('3D/3dmodel.model');
  if (!rootXml) throw new Error('El archivo no es un 3MF válido (falta 3D/3dmodel.model)');
  const title = (/<metadata name="Title">([^<]*)</.exec(rootXml) || [])[1] || '';

  // palette: Bambu/Orca project settings or PrusaSlicer config
  let palette = [];
  const ps = get('Metadata/project_settings.config');
  if (ps) {
    try {
      const j = JSON.parse(ps);
      palette = (j.filament_colour || []).map(parseHexColor);
    } catch { /* ignore */ }
  }
  const pe = get('Metadata/Slic3r_PE.config');
  if (!palette.length && pe) {
    const m = /;\s*(?:extruder_colour|filament_colour)\s*=\s*([^\n]+)/.exec(pe);
    if (m) palette = m[1].split(';').map(parseHexColor);
  }

  // per object / part default extruder (1-based)
  const objExtruder = new Map(), partExtruder = new Map();
  const ms = get('Metadata/model_settings.config');
  if (ms) {
    for (const om of ms.matchAll(/<object id="(\d+)">([\s\S]*?)<\/object>/g)) {
      const head = om[2].split('<part')[0];
      const e = /key="extruder" value="(\d+)"/.exec(head);
      if (e) objExtruder.set(om[1], +e[1]);
      for (const pm of om[2].matchAll(/<part id="(\d+)"[^>]*>([\s\S]*?)<\/part>/g)) {
        const pe2 = /key="extruder" value="(\d+)"/.exec(pm[2]);
        if (pe2) partExtruder.set(om[1] + ':' + pm[1], +pe2[1]);
      }
    }
  }
  // PrusaSlicer volumes: triangle ranges with an extruder
  const prusaVolumes = new Map();
  const pmc = get('Metadata/Slic3r_PE_model.config');
  if (pmc) {
    for (const om of pmc.matchAll(/<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
      const e = /type="object" key="extruder" value="(\d+)"/.exec(om[2]);
      if (e) objExtruder.set(om[1], +e[1]);
      const vols = [];
      for (const vm of om[2].matchAll(/<volume firstid="(\d+)" lastid="(\d+)">([\s\S]*?)<\/volume>/g)) {
        const ve = /key="extruder" value="(\d+)"/.exec(vm[3]);
        vols.push({ a: +vm[1], b: +vm[2], ext: ve ? +ve[1] : 0 });
      }
      if (vols.length) prusaVolumes.set(om[1], vols);
    }
  }

  // parse all model files: objects (mesh or components) + materials
  const models = new Map(); // path -> { objects: Map(id -> obj), materials: Map(id -> [hex]) }
  const parseModel = (path) => {
    if (models.has(path)) return models.get(path);
    const xml = get(path);
    const res = { objects: new Map(), materials: new Map() };
    models.set(path, res);
    if (!xml) return res;
    for (const bm of xml.matchAll(/<(?:m:)?(basematerials|colorgroup)\s+id="(\d+)"[^>]*>([\s\S]*?)<\/(?:m:)?\1>/g)) {
      const cols = [...bm[3].matchAll(/(?:displaycolor|color)="([^"]+)"/g)].map((m) => parseHexColor(m[1]));
      res.materials.set(bm[2], cols);
    }
    for (const om of xml.matchAll(/<object\s([^>]*)>([\s\S]*?)<\/object>/g)) {
      const id = attr(om[1], 'id');
      const o = { id, name: attr(om[1], 'name') || '', pid: attr(om[1], 'pid'), pindex: attr(om[1], 'pindex'), path };
      const body = om[2];
      if (/<mesh/.test(body)) {
        const vs = [];
        const vre = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g;
        for (let m; (m = vre.exec(body));) vs.push(+m[1], +m[2], +m[3]);
        const ts = [], paint = [], tp = [];
        const tre = /<triangle\s([^>]*?)\/?>/g;
        for (let m; (m = tre.exec(body));) {
          const a = m[1];
          ts.push(+attr(a, 'v1'), +attr(a, 'v2'), +attr(a, 'v3'));
          paint.push(attr(a, 'paint_color') || attr(a, 'slic3rpe:mmu_segmentation') || '');
          const pid = attr(a, 'pid'), p1 = attr(a, 'p1');
          tp.push(p1 != null ? [pid, +p1] : null);
        }
        o.mesh = { V: vs, T: ts, paint, tp };
      } else {
        o.components = [...body.matchAll(/<component\s([^>]*?)\/?>/g)].map((m) => ({
          objectid: attr(m[1], 'objectid'), path: attr(m[1], 'p:path') || path, transform: parseMat(attr(m[1], 'transform')),
        }));
      }
      res.objects.set(id, o);
    }
    return res;
  };
  parseModel('3D/3dmodel.model');

  const usedExtruders = new Set();
  const parts = [];
  const emit = (o, mat, topId, matHex) => {
    const mesh = o.mesh;
    const nV = mesh.V.length / 3, nT = mesh.T.length / 3;
    const defExt = partExtruder.get(topId + ':' + o.id) || objExtruder.get(topId) || objExtruder.get(o.id) || 1;
    const V = new Float64Array(nV * 3);
    for (let i = 0; i < nV; i++) {
      const x = mesh.V[i * 3], y = mesh.V[i * 3 + 1], z = mesh.V[i * 3 + 2];
      if (mat) {
        V[i * 3] = x * mat[0] + y * mat[3] + z * mat[6] + mat[9];
        V[i * 3 + 1] = x * mat[1] + y * mat[4] + z * mat[7] + mat[10];
        V[i * 3 + 2] = x * mat[2] + y * mat[5] + z * mat[8] + mat[11];
      } else { V[i * 3] = x; V[i * 3 + 1] = y; V[i * 3 + 2] = z; }
    }
    const extraV = [], extraT = [], extraC = [];
    const T = [], tcol = [];
    const vols = prusaVolumes.get(topId) || prusaVolumes.get(o.id);
    const materials = models.get(o.path).materials;
    for (let t = 0; t < nT; t++) {
      const a = mesh.T[t * 3], b = mesh.T[t * 3 + 1], c = mesh.T[t * 3 + 2];
      let ext = defExt;
      if (vols) { const v = vols.find((q) => t >= q.a && t <= q.b); if (v && v.ext) ext = v.ext; }
      let hex = matHex;
      const tp = mesh.tp[t];
      if (tp) { const cols = materials.get(tp[0] || o.pid); if (cols && cols[tp[1]]) hex = cols[tp[1]]; }
      const code = mesh.paint[t];
      if (code) {
        const pts = [a, b, c].map((i) => [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]]);
        const leaves = decodePaint(code, pts);
        if (leaves.length === 1) {
          const e = leaves[0].state || ext;
          T.push(a, b, c); tcol.push(hex ? 'h' + hex : e);
        } else {
          for (const lf of leaves) {
            const base = (nV + extraV.length / 3);
            for (const q of lf.v) extraV.push(q[0], q[1], q[2]);
            extraT.push(base, base + 1, base + 2);
            extraC.push(hex ? 'h' + hex : (lf.state || ext));
          }
        }
        continue;
      }
      T.push(a, b, c); tcol.push(hex ? 'h' + hex : ext);
    }
    let VV = V, TT = T, tk = tcol;
    if (extraV.length) {
      VV = new Float64Array(V.length + extraV.length);
      VV.set(V); VV.set(extraV, V.length);
      for (let i = 0; i < extraT.length; i++) T.push(extraT[i]);
      for (const c of extraC) tcol.push(c);
      // brush paint: the sub-triangles come loose (own vertices, T-junctions); weld them back into a closed surface
      ({ V: VV, T: TT, tags: tk } = weldPainted(VV, T, tcol, nV));
    }
    for (const c of tk) usedExtruders.add(c);
    parts.push({ name: o.name || `pieza ${parts.length + 1}`, V: VV, T: new Uint32Array(TT), tkey: tk });
  };
  const walk = (path, id, mat, topId, matHex) => {
    const o = parseModel(path).objects.get(id);
    if (!o) return;
    let hex = matHex;
    if (o.pid != null && o.pindex != null) { const cols = models.get(path).materials.get(o.pid); if (cols && cols[+o.pindex]) hex = cols[+o.pindex]; }
    if (o.mesh) emit(o, mat, topId, hex);
    else for (const c of o.components) walk((c.path || path).replace(/^\//, ''), c.objectid, mulMat(c.transform, mat), topId, hex);
  };
  const buildXml = /<build[^>]*>([\s\S]*?)<\/build>/.exec(rootXml);
  if (buildXml) {
    for (const im of buildXml[1].matchAll(/<item\s([^>]*?)\/?>/g)) {
      if (attr(im[1], 'printable') === '0') continue;
      walk('3D/3dmodel.model', attr(im[1], 'objectid'), parseMat(attr(im[1], 'transform')), attr(im[1], 'objectid'), null);
    }
  }
  if (!parts.length) throw new Error('El 3MF no contiene mallas');

  // map extruder numbers / direct colors to a compact palette
  const keys = [...usedExtruders].sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }));
  const fallback = ['#F4F4F4', '#E8AFCF', '#8ADFBD', '#3F51B5', '#FFC107', '#212121', '#E53935', '#43A047'];
  const outPalette = keys.map((k, i) => (typeof k === 'string' && k[0] === 'h' ? k.slice(1) : palette[k - 1] || fallback[(k - 1) % fallback.length] || fallback[i % 8]));
  const names = keys.map((k) => (typeof k === 'string' ? 'Material ' + k.slice(1) : 'Filamento ' + k));
  for (const p of parts) {
    p.tc = new Uint8Array(p.tkey.length);
    for (let i = 0; i < p.tkey.length; i++) p.tc[i] = keys.indexOf(p.tkey[i]);
    delete p.tkey;
  }
  return { title, palette: outPalette, names, parts };
}
