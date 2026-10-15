// Colour-split benchmark: runs splitColors() for every model × mode and measures how printable and how faithful the
// resulting parts are. Every run is a child process (fresh WASM heap, killed on timeout); the parent prints a markdown
// table and writes <out>/bench.json (+ bench.md).
//   node test/tools/bench.mjs --models="<a.3mf>|<b.3mf>|fx:bandSphere|fx:figure" --modes=covers,skin,carve
//        [--opts='{"key":val}'] [--out=test/out/bench] [--timeout=900] [--jobs=1] [--reuse] [--force] [--samples=30000]
//        [--threads=2]
// Models: a .3mf path or fx:<name>[:arg] from test/fixtures/multicolor.mjs (fx:bandSphere:8 = 8 colours).
// --jobs: model×mode runs in parallel. --threads (1..4, default 2): worker threads per run for the metric phase, each
// with its own WASM heap (results do not depend on it). Bow model (103k triangles in), covers: 1 → 44 s, 2 → 21 s,
// 3-4 → 19 s; skin (2.5M triangles out): 1 → 54 s / 4.1 GB peak, 2 → 40 s / 4.6 GB. Memory is dominated by the
// booleans on the union of all parts, not by the thread count (splitting also keeps each wasm32 heap below its 4 GB
// cap). The split runs in its own worker too, whose heap is freed before the metrics start. metrics.json records
// metric_s, metricTimes, splitRSS_MB (peak while loading + splitting) and maxRSS_MB.
// Each run writes <out>/<model>/<mode>/parts.json (test/tools/compare.mjs format) and metrics.json; fixtures also get
// <out>/<model>/model.3mf, so these work on the outputs:
//   node test/tools/compare.mjs <model.3mf> <out>/<model>/<mode> --reuse
//   node test/tools/pieces.mjs <out>/<model>/<mode>/parts.json out.png
// --reuse: skip the split when parts.json exists (re-measure only). --force: run a mode even if src/core never mentions
// it (splitColors silently falls back to the inlays path for unknown modes, so by default that is reported as an error).
// Options may also be given as --opts=@file.json; PowerShell 5 quote stripping ({key:val}) is tolerated.
//
// Metrics (volumes mm³, areas mm², percentages are area-weighted):
//  time_s split wall clock · nParts, byKind, nBodies, nCovers · small = parts < 20 mm³ · minVol · warnings
//  invalid = parts that do not rebuild as a Manifold with volume > 0 · bodyGenus (per body, summed over its components)
//    · coverGenusMax / coverGenusSum · multiComp = parts made of several disconnected pieces
//  volM = original solid M (union of every original shell, components < 0.5 mm³ dropped) · volParts = Σ part volumes
//    · missing = vol(M − ∪parts) · extra = vol(∪parts − M) (skin mode grows the model by skinDepth on purpose, so its
//    extra ≈ area × skinDepth); in brackets (table) / missingThick, extraThick: the share of it in solid pieces
//    (a cavity belongs to its enclosing piece) whose mean thickness 2·vol/area ≥ 0.1 mm (the rest are films: surface
//    deviation, glue gaps); missingPieces / extraPieces list the biggest
//    · overlap = Σ vol(A ∩ B) over part pairs whose boxes overlap (negative sliver volumes of touching parts → 0)
//  thin04 / thin08 = % of the parts' surface whose inward thickness (ray along −normal through the same part) is < 0.4 /
//    < 0.8 mm (2 µm tolerance) · thinWorst = part with the largest < 0.4 mm area
//  colErr = % of the original painted outer surface whose printed colour (first part hit by a ray from p + δ·n to
//    p − 0.6·n; δ = 0.3, skin: skinDepth + 0.3) differs or is missing · colErrFar = same, ignoring points within 0.5 mm
//    of another colour · colConfusion = top expected→got pairs
//  catchCount / nCoversChecked = covers (and inlays) that hit the union of the bodies when slid 0.5…5 mm along their
//    direction (n / up) by more than max(1 mm³, 2 % of the cover) · catchWorst = worst 3
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), '..', '..');
const argv = process.argv.slice(2);
const flag = (k, d) => {
  for (const a of argv) {
    if (a === `--${k}`) return true;
    if (a.startsWith(`--${k}=`)) return a.slice(k.length + 3);
  }
  return d;
};
const errMsg = (e) => (e && (e.message || String(e))) || 'unknown error';
const r2 = (x, d = 2) => (x == null || !Number.isFinite(x) ? x : Math.round(x * 10 ** d) / 10 ** d);
const slugOf = (spec) =>
  spec.startsWith('fx:') ? 'fx_' + spec.slice(3).replace(/[^\w]+/g, '_') : path.basename(spec).replace(/\.3mf$/i, '').replace(/[^\w.-]+/g, '_');

function parseOpts(s) {
  if (s == null || s === true || s === '') return {};
  s = String(s).trim();
  if (s.startsWith('@')) s = fs.readFileSync(s.slice(1), 'utf8');
  try {
    return JSON.parse(s);
  } catch {
    // PowerShell 5 strips the inner double quotes of native arguments: accept {key:val,key2:'x',key3:word} as well
    const fixed = s
      .replace(/'/g, '"')
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/:\s*([A-Za-z_][\w.-]*)\s*(?=[,}])/g, (m, v) => (/^(true|false|null)$/.test(v) ? `:${v}` : `:"${v}"`));
    return JSON.parse(fixed);
  }
}

// ======================================================================= parent
async function parent() {
  const models = String(flag('models', '') === true ? '' : flag('models', '')).split('|').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  const modes = String(flag('modes', 'covers')).split(',').map((s) => s.trim()).filter(Boolean);
  if (!models.length) {
    console.log('usage: node test/tools/bench.mjs --models="a.3mf|fx:bandSphere|fx:figure" --modes=covers,skin [--opts=JSON] [--out=dir] [--timeout=900] [--jobs=1] [--threads=2] [--samples=30000] [--reuse] [--force]');
    process.exit(2);
  }
  let opts;
  try {
    opts = parseOpts(flag('opts'));
  } catch (e) {
    console.error(`--opts is not valid JSON: ${errMsg(e)}`);
    process.exit(2);
  }
  const out = path.resolve(flag('out') && flag('out') !== true ? String(flag('out')) : path.join(ROOT, 'test', 'out', 'bench'));
  const timeout = +flag('timeout', 900) || 900;
  const jobs = Math.max(1, +flag('jobs', 1) | 0);
  const pass = ['reuse', 'force'].filter((k) => flag(k)).map((k) => `--${k}`);
  for (const k of ['samples', 'threads']) if (flag(k) && flag(k) !== true) pass.push(`--${k}=${flag(k)}`);
  fs.mkdirSync(out, { recursive: true });
  const runs = [];
  for (const model of models) for (const mode of modes) runs.push({ model, mode });
  console.log(`bench: ${models.length} model(s) × ${modes.length} mode(s), opts ${JSON.stringify(opts)}, timeout ${timeout} s, jobs ${jobs} → ${out}`);
  const rows = new Array(runs.length);
  let next = 0;
  const worker = async () => {
    while (next < runs.length) {
      const i = next++;
      rows[i] = await runChild(runs[i], { opts, out, timeout, pass });
      const r = rows[i];
      console.log(`=> ${r.slug}/${r.mode}: ${r.error ? 'ERROR ' + r.error : `${r2(r.time_s, 1)} s split, ${r.nParts} parts, metrics ${r2(r.metric_s, 1)} s`}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, runs.length) }, worker));
  const md = table(rows);
  console.log('\n' + md);
  fs.writeFileSync(path.join(out, 'bench.md'), md + '\n');
  fs.writeFileSync(path.join(out, 'bench.json'), JSON.stringify({ date: new Date().toISOString(), models, modes, opts, timeout, runs: rows }, null, 1));
  console.log(`\n→ ${path.join(out, 'bench.json')}`);
}

function runChild({ model, mode }, { opts, out, timeout, pass }) {
  return new Promise((resolve) => {
    const slug = slugOf(model), tag = `[${slug}/${mode}]`, t0 = Date.now();
    const args = [HERE, '--one', `--model=${model}`, `--mode=${mode}`, `--opts=${JSON.stringify(opts)}`, `--out=${out}`, ...pass];
    let json = null, timedOut = false, done = false;
    const tail = [];
    const onLine = (line, isErr) => {
      if (line.startsWith('BENCH_JSON ')) {
        try {
          json = JSON.parse(line.slice(11));
        } catch (e) {
          tail.push('bad BENCH_JSON: ' + errMsg(e));
        }
        return;
      }
      if (!line.trim()) return;
      console.log(`  ${tag} ${line}`);
      if (isErr || /error/i.test(line)) {
        tail.push(line.trim());
        if (tail.length > 30) tail.shift();
      }
    };
    const pipe = (stream, isErr) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (d) => {
        buf += d;
        let k;
        while ((k = buf.indexOf('\n')) >= 0) {
          onLine(buf.slice(0, k).replace(/\r$/, ''), isErr);
          buf = buf.slice(k + 1);
        }
      });
      stream.on('end', () => buf && onLine(buf, isErr));
    };
    const finish = (code, signal, spawnErr) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const wall_s = (Date.now() - t0) / 1000;
      const why = timedOut ? `timeout after ${timeout} s` : spawnErr ? `spawn failed: ${errMsg(spawnErr)}` : `child exited with code ${code}${signal ? ' (' + signal + ')' : ''}`;
      if (json) {
        json.wall_s = r2(wall_s, 1);
        // a partial result (printed right after the split) means the metric phase died
        if (json.stage !== 'done' && !json.error) json.error = `${why} during metrics` + (tail.length ? ': ' + tail.slice(-2).join(' | ') : '');
        resolve(json);
      } else resolve({ model, slug, mode, error: why + (tail.length ? ': ' + tail.slice(-3).join(' | ') : ''), wall_s: r2(wall_s, 1) });
    };
    const ch = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => {
      timedOut = true;
      ch.kill();
    }, timeout * 1000);
    pipe(ch.stdout, false);
    pipe(ch.stderr, true);
    ch.on('error', (e) => finish(null, null, e));
    ch.on('close', (code, signal) => finish(code, signal));
  });
}

function table(rows) {
  const f = (x, d = 1) => (x == null || x === '' ? '-' : typeof x === 'number' ? (Number.isFinite(x) ? x.toFixed(d) : String(x)) : String(x));
  const H = ['model', 'mode', 'time s', 'parts b/c/o', 'small', 'invalid', 'body genus', 'cover genus max/sum', 'missing mm³ (thick)', 'extra mm³ (thick)', 'overlap mm³', 'thin<0.4 %', 'thin<0.8 %', 'colErr %', 'colErrFar %', 'catch', 'warn', 'notes / error'];
  const lines = [`| ${H.join(' | ')} |`, `|${H.map(() => '---').join('|')}|`];
  for (const r of rows) {
    const other = (r.nParts || 0) - (r.nBodies || 0) - (r.nCovers || 0);
    const cell = (s) => String(s).replace(/\|/g, '/').replace(/\s+/g, ' ');
    lines.push('| ' + [
      r.slug, r.mode, f(r.time_s), r.nParts == null ? '-' : `${r.nParts} (${r.nBodies || 0}/${r.nCovers || 0}/${other})`,
      r.small == null ? '-' : r.small, r.invalid == null ? '-' : r.invalid,
      Array.isArray(r.bodyGenus) ? rle(r.bodyGenus) || '-' : '-',
      r.coverGenusMax == null ? '-' : `${r.coverGenusMax}/${r.coverGenusSum}`,
      f(r.missing) + (r.missingThick != null ? ` (${f(r.missingThick)})` : ''), f(r.extra) + (r.extraThick != null ? ` (${f(r.extraThick)})` : ''), f(r.overlap) + (r.overlapPartial ? '+' : ''),
      f(r.thin04, 2), f(r.thin08, 2), f(r.colErr, 2), f(r.colErrFar, 2),
      r.catchCount == null ? '-' : `${r.catchCount}/${r.nCoversChecked}`,
      Array.isArray(r.warnings) ? r.warnings.length : '-',
      cell(r.error ? r.error.slice(0, 160) : notes(r)),
    ].map(cell).join(' | ') + ' |');
  }
  return lines.join('\n');
}

const rle = (a) => {
  const out = [];
  for (let i = 0; i < a.length; ) {
    let j = i;
    while (j < a.length && a[j] === a[i]) j++;
    out.push(j - i > 1 ? `${a[i] ?? '?'}×${j - i}` : `${a[i] ?? '?'}`);
    i = j;
  }
  return out.join(',');
};

function notes(r) {
  const k = r.byKind || {}, o = r.origSolid, n = [];
  if (k.solid) n.push(`${k.solid} solid`);
  if (k.inlay) n.push(`${k.inlay} inlay`);
  if (o && (o.failed || o.flat)) n.push(`M skips ${o.failed + o.flat}/${o.shells} shells (${o.failedTris} tris)`);
  if (o && o.repaired) n.push(`M: ${o.repaired} shell(s) T-junction-repaired`);
  if (r.overlapDegenerate) n.push(`${r.overlapDegenerate} degenerate contact(s)`);
  if (r.reused) n.push('reused parts');
  if (r.metricErrors) n.push(`metric errors: ${Object.keys(r.metricErrors).join(',')}`);
  return n.join(', ');
}

// ======================================================================= child
async function child() {
  const spec = String(flag('model', ''));
  const mode = String(flag('mode', 'covers'));
  const out = path.resolve(flag('out') && flag('out') !== true ? String(flag('out')) : path.join(ROOT, 'test', 'out', 'bench'));
  const slug = slugOf(spec), dir = path.join(out, slug, mode);
  const R = { model: spec, slug, mode, stage: 'start' };
  const emit = () => console.log('BENCH_JSON ' + JSON.stringify(R));
  try {
    R.opts = parseOpts(flag('opts'));
    fs.mkdirSync(dir, { recursive: true });
    const cache = path.join(dir, 'parts.json'), metricsFile = path.join(dir, 'metrics.json');
    const reuse = !!flag('reuse') && fs.existsSync(cache);
    if (!reuse && !flag('force') && !modeKnown(mode)) {
      R.error = `mode '${mode}' is not implemented in src/core (splitColors would silently run the inlays path); --force runs it anyway`;
      return;
    }

    // ---- model + split (or reuse), in a worker: its WASM heap (> 1 GB for some skin runs) is freed when it exits,
    // before the metric workers start; this thread never instantiates WASM
    const S = await inWorker({ task: 'split', spec, mode, opts: R.opts, split: !reuse });
    for (const k of ['time_s', 'warnings', 'info']) if (S[k] !== undefined) R[k] = S[k];
    if (S.model) {
      R.nColors = S.model.palette.length;
      R.nTrisIn = S.model.parts.reduce((a, p) => a + p.T.length / 3, 0);
    }
    if (S.model3mf) fs.writeFileSync(path.join(out, slug, 'model.3mf'), S.model3mf);
    if (S.error) {
      R.error = S.error;
      return;
    }
    let parts;
    if (reuse) {
      parts = JSON.parse(fs.readFileSync(cache, 'utf8'));
      R.reused = true;
      if (fs.existsSync(metricsFile)) {
        const prev = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));
        for (const k of ['time_s', 'warnings', 'info']) if (prev[k] !== undefined) R[k] = prev[k];
      }
      console.log(`reusing ${cache} (${parts.length} parts)`);
    } else {
      parts = S.parts;
      console.log(`split ${R.time_s} s: ${parts.length} parts, ${R.warnings.length} warnings`);
      // same layout as test/tools/compare.mjs; 9 significant digits round-trip float32 exactly, so --reuse re-measures
      // exactly the same parts (rounding to 1e-4 would add films that glue separate missing/extra pieces together)
      fs.writeFileSync(cache, JSON.stringify(parts.map((p) => ({ ...p, V: Array.from(p.V, (x) => +Math.fround(x).toPrecision(9)), T: Array.from(p.T) }))));
    }
    R.splitRSS_MB = Math.round(process.resourceUsage().maxRSS / 1024); // peak memory of loading + splitting
    R.stage = 'split';
    emit(); // partial result: survives a crash / timeout in the metric phase

    let DEFAULT_SPLIT = {};
    try {
      ({ DEFAULT_SPLIT } = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'colorsplit.js')).href));
    } catch { /* defaults below */ }
    const skinDepth = +(R.opts.skinDepth ?? DEFAULT_SPLIT.skinDepth ?? 1.2);
    const cores = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
    const threads = +flag('threads', Math.min(2, Math.max(1, cores - 1))) || 1;
    await runMetrics(S.model, parts, { mode, skinDepth, samples: +flag('samples', 30000) || 30000, threads }, R);
    R.stage = 'done';
    fs.writeFileSync(metricsFile, JSON.stringify(R, null, 1));
  } catch (e) {
    R.error = (R.error ? R.error + '; ' : '') + errMsg(e);
    console.log((e && e.stack) || e);
  } finally {
    emit();
  }
}

function modeKnown(mode) {
  const dir = path.join(ROOT, 'src', 'core');
  const re = new RegExp(`['"\`]${mode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
  return fs.readdirSync(dir).filter((f) => /\.m?js$/.test(f)).some((f) => re.test(fs.readFileSync(path.join(dir, f), 'utf8')));
}

// Runs a task of this file in a worker thread (own WASM heap, released when it exits); resolves to its message
function inWorker(data) {
  return new Promise((resolve) => {
    let got = null, err = null;
    const wk = new Worker(new URL(import.meta.url), { workerData: data });
    wk.on('message', (msg) => (got = msg));
    wk.on('error', (e) => (err = e));
    wk.on('exit', (code) => resolve(got || { error: `${data.task} worker: ${err ? errMsg(err) : 'exited with code ' + code}` }));
  });
}

async function workerMain() {
  const d = workerData;
  const { default: Module } = await import('manifold-3d');
  const w = await Module();
  w.setup();
  parentPort.postMessage(d.task === 'split' ? await splitTask(w, d) : metrics(w, d.model, d.parts, d.cfg, d.steps));
}

// Worker task: load the model (fixtures are built with WASM) and, unless reusing parts, run splitColors on it.
async function splitTask(w, { spec, mode, opts, split }) {
  const S = {};
  let model;
  try {
    if (spec.startsWith('fx:')) {
      const fx = await import(pathToFileURL(path.join(ROOT, 'test', 'fixtures', 'multicolor.mjs')).href);
      model = fx.fixtureModel(w, spec);
      S.model3mf = fx.to3MF(model);
    } else {
      const { read3MF } = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'threemf_read.js')).href);
      model = read3MF(new Uint8Array(fs.readFileSync(spec)));
    }
  } catch (e) {
    S.error = 'load: ' + errMsg(e);
    return S;
  }
  S.model = { palette: model.palette, names: model.names, parts: model.parts.map((p) => ({ V: p.V, T: p.T, tc: p.tc })) };
  if (!split) return S;
  let splitColors;
  try {
    ({ splitColors } = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'colorsplit.js')).href));
  } catch (e) {
    S.error = 'import colorsplit.js: ' + errMsg(e);
    return S;
  }
  let last = '';
  const t0 = performance.now();
  const progress = (msg, frac) => {
    if (msg !== last) {
      last = msg;
      console.log(`[${((performance.now() - t0) / 1000).toFixed(1)} s] ${msg}${frac != null ? ' ' + Math.round(frac * 100) + '%' : ''}`);
    }
  };
  let res;
  try {
    res = splitColors(w, model, { ...opts, mode }, progress);
    if (res && typeof res.then === 'function') res = await res;
  } catch (e) {
    S.time_s = r2((performance.now() - t0) / 1000, 1);
    S.error = 'split: ' + errMsg(e);
    console.log((e && e.stack) || e);
    return S;
  }
  S.time_s = r2((performance.now() - t0) / 1000, 1);
  S.warnings = (res.warnings || []).map(String);
  const plain = (v) => v == null || ['number', 'string', 'boolean'].includes(typeof v);
  S.info = Object.fromEntries(Object.entries(res).filter(([k, v]) => !['parts', 'palette', 'names', 'warnings'].includes(k) && (plain(v) || (Array.isArray(v) && v.length < 20 && v.every(plain)))));
  const arr = (d) => (d && typeof d === 'object' && d.length === 3 ? Array.from(d, Number) : d);
  S.parts = res.parts.map((p) => ({ kind: p.kind, color: p.color, n: arr(p.n), up: arr(p.up), fromSolid: p.fromSolid, backCover: p.backCover, name: p.name, V: p.mesh.V, T: p.mesh.T }));
  return S;
}

// ======================================================================= geometry helpers
const mulberry32 = (a) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
function triGeom(V, T, t) {
  const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
  const A = [V[a], V[a + 1], V[a + 2]], B = [V[b], V[b + 1], V[b + 2]], C = [V[c], V[c + 1], V[c + 2]];
  const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(n[0], n[1], n[2]);
  return { A, B, C, u, v, area: l / 2, n: l ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0] };
}
const pointIn = (g, rnd) => {
  let s = rnd(), t = rnd();
  if (s + t > 1) { s = 1 - s; t = 1 - t; }
  return [g.A[0] + s * g.u[0] + t * g.v[0], g.A[1] + s * g.u[1] + t * g.v[1], g.A[2] + s * g.u[2] + t * g.v[2]];
};
function signedVolume(V, T) {
  let s = 0;
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
    s += V[a] * (V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1]) - V[a + 1] * (V[b] * V[c + 2] - V[b + 2] * V[c]) + V[a + 2] * (V[b] * V[c + 1] - V[b + 1] * V[c]);
  }
  return s / 6;
}
const boxesOverlap = (a, b, eps = 0) => [0, 1, 2].every((k) => a.min[k] < b.max[k] - eps && b.min[k] < a.max[k] - eps);

// Manifold from flat V/T; null if it is not a valid 2-manifold even after merging coincident open-edge vertices
function buildMan(w, V, T) {
  const mk = (merge) => {
    const mesh = new w.Mesh({ numProp: 3, vertProperties: Float32Array.from(V), triVerts: Uint32Array.from(T) });
    if (merge) mesh.merge();
    return new w.Manifold(mesh);
  };
  try {
    return { man: mk(false), how: 'ok' };
  } catch { /* try merging */ }
  try {
    return { man: mk(true), how: 'merged' };
  } catch {
    return null;
  }
}

// Splits triangles at vertices lying on their open edges (T-junctions, e.g. left by per-triangle paint subdivision in
// 3MF files). Returns { P, T } or null when there is nothing to split.
function fixTJunctions(P0, T0) {
  let P = Array.from(P0), T = Array.from(T0), changed = false;
  const nxt = (e) => e - (e % 3) + ((e % 3) + 1) % 3;
  for (let pass = 0; pass < 3; pass++) {
    const nV = P.length / 3, nE = T.length;
    const he = new Set();
    for (let e = 0; e < nE; e++) he.add(T[e] * nV + T[nxt(e)]);
    const open = [];
    for (let e = 0; e < nE; e++) if (!he.has(T[nxt(e)] * nV + T[e])) open.push(e);
    if (!open.length) break;
    const ov = new Set();
    let len = 0;
    for (const e of open) {
      const a = T[e], b = T[nxt(e)];
      ov.add(a);
      ov.add(b);
      len += Math.hypot(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
    }
    const h = Math.max(1e-3, len / open.length), grid = new Map();
    const key = (x, y, z) => `${x},${y},${z}`;
    for (const v of ov) {
      const k = key(Math.floor(P[v * 3] / h), Math.floor(P[v * 3 + 1] / h), Math.floor(P[v * 3 + 2] / h));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(v);
    }
    const splits = new Map();
    for (const e of open) {
      const a = T[e], b = T[nxt(e)];
      const d = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], dd = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
      if (!(dd > 0)) continue;
      const lo = [0, 1, 2].map((k) => Math.floor(Math.min(P[a * 3 + k], P[b * 3 + k]) / h)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(P[a * 3 + k], P[b * 3 + k]) / h));
      if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 4096) continue;
      const found = [];
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
        for (const v of grid.get(key(x, y, z)) || []) {
          if (v === a || v === b) continue;
          const q = [P[v * 3] - P[a * 3], P[v * 3 + 1] - P[a * 3 + 1], P[v * 3 + 2] - P[a * 3 + 2]];
          const s = (q[0] * d[0] + q[1] * d[1] + q[2] * d[2]) / dd;
          if (s <= 1e-7 || s >= 1 - 1e-7) continue;
          const r = (q[0] - s * d[0]) ** 2 + (q[1] - s * d[1]) ** 2 + (q[2] - s * d[2]) ** 2;
          if (r < 1e-10 * dd + 1e-14) found.push([s, v]);
        }
      }
      if (found.length) splits.set(e, found.sort((x, y) => x[0] - y[0]).map((x) => x[1]).filter((v, i, arr) => i === 0 || v !== arr[i - 1]));
    }
    if (!splits.size) break;
    changed = true;
    const T2 = [];
    for (let t = 0; t < T.length / 3; t++) {
      const es = [t * 3, t * 3 + 1, t * 3 + 2];
      if (!es.some((e) => splits.has(e))) {
        T2.push(T[t * 3], T[t * 3 + 1], T[t * 3 + 2]);
        continue;
      }
      const poly = [];
      for (const e of es) poly.push(T[e], ...(splits.get(e) || []));
      const c = P.length / 3;
      for (let k = 0; k < 3; k++) P.push((P[T[t * 3] * 3 + k] + P[T[t * 3 + 1] * 3 + k] + P[T[t * 3 + 2] * 3 + k]) / 3);
      for (let i = 0; i < poly.length; i++) T2.push(poly[i], poly[(i + 1) % poly.length], c);
    }
    T = T2;
  }
  return changed ? { P, T } : null;
}

// Original solid M: every part split into connected shells (vertices with identical float32 coordinates merged first),
// one Manifold per shell (flipped if inside-out; T-junctions repaired if needed; failures skipped), all unioned,
// components < 0.5 mm³ dropped.
function buildOriginalSolid(w, model) {
  const info = { shells: 0, built: 0, merged: 0, repaired: 0, failed: 0, failedTris: 0, flat: 0, dropped: 0 };
  const mans = [];
  for (const p of model.parts) {
    const nV = p.V.length / 3, nT = p.T.length / 3;
    const ids = new Map(), remap = new Uint32Array(nV), pos = [];
    for (let i = 0; i < nV; i++) {
      const x = Math.fround(p.V[i * 3]), y = Math.fround(p.V[i * 3 + 1]), z = Math.fround(p.V[i * 3 + 2]);
      const k = `${x},${y},${z}`;
      let j = ids.get(k);
      if (j === undefined) {
        j = pos.length / 3;
        ids.set(k, j);
        pos.push(x, y, z);
      }
      remap[i] = j;
    }
    const par = new Int32Array(pos.length / 3).map((_, i) => i);
    const find = (x) => {
      while (par[x] !== x) x = par[x] = par[par[x]];
      return x;
    };
    for (let t = 0; t < nT; t++) {
      const a = find(remap[p.T[t * 3]]), b = find(remap[p.T[t * 3 + 1]]);
      par[b] = a;
      par[find(remap[p.T[t * 3 + 2]])] = find(a);
    }
    const groups = new Map();
    for (let t = 0; t < nT; t++) {
      const r = find(remap[p.T[t * 3]]);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(t);
    }
    for (const tris of groups.values()) {
      info.shells++;
      const vm = new Map(), P = [], TT = new Uint32Array(tris.length * 3);
      tris.forEach((t, k) => {
        for (let j = 0; j < 3; j++) {
          const g = remap[p.T[t * 3 + j]];
          let q = vm.get(g);
          if (q === undefined) {
            q = P.length / 3;
            vm.set(g, q);
            P.push(pos[g * 3], pos[g * 3 + 1], pos[g * 3 + 2]);
          }
          TT[k * 3 + j] = q;
        }
      });
      const vol = signedVolume(P, TT);
      if (Math.abs(vol) < 1e-6) {
        info.flat++;
        info.failedTris += tris.length;
        continue;
      }
      if (vol < 0) for (let k = 0; k < TT.length; k += 3) [TT[k + 1], TT[k + 2]] = [TT[k + 2], TT[k + 1]];
      let b = buildMan(w, P, TT);
      if (!b) {
        try {
          const F = fixTJunctions(P, TT);
          const r = F && buildMan(w, F.P, F.T);
          if (r) b = { man: r.man, how: 'repaired' };
        } catch { /* skip */ }
      }
      if (!b) {
        info.failed++;
        info.failedTris += tris.length;
        continue;
      }
      info.built++;
      if (b.how !== 'ok') info[b.how]++;
      mans.push(b.man);
    }
  }
  if (!mans.length) return { M: null, info };
  const U = w.Manifold.union(mans);
  mans.forEach((m) => m.delete());
  // drop components < 0.5 mm³ (debris); meshComponents is O(n), decompose() is not
  const comps = groupCavities(meshComponents(U, true)), keep = comps.map((c) => c.vol >= 0.5);
  info.dropped = keep.filter((k) => !k).length;
  if (!info.dropped) return { M: U, info };
  let M = null;
  if (info.dropped < comps.length) {
    const g = comps.mesh, T = [];
    for (let t = 0; t < comps.label.length; t++) if (keep[comps.label[t]]) T.push(g.triVerts[t * 3], g.triVerts[t * 3 + 1], g.triVerts[t * 3 + 2]);
    try {
      M = new w.Manifold(new w.Mesh({ numProp: g.numProp, vertProperties: g.vertProperties, triVerts: Uint32Array.from(T), mergeFromVert: g.mergeFromVert, mergeToVert: g.mergeToVert }));
    } catch {
      const parts = U.decompose(), kept = parts.filter((c) => c.volume() >= 0.5);
      M = kept.length ? w.Manifold.compose(kept) : null;
      parts.forEach((c) => c.delete());
    }
  }
  U.delete();
  return { M, info };
}

// Point hash for "is there a point of another colour within r" (colErrFar)
function colorPointHash(model, r) {
  const xs = [], cs = [], step = r / 2;
  for (const p of model.parts) {
    for (let t = 0; t < p.T.length / 3; t++) {
      const c = p.tc ? p.tc[t] : 0, g = triGeom(p.V, p.T, t), Q = [g.A, g.B, g.C];
      xs.push((g.A[0] + g.B[0] + g.C[0]) / 3, (g.A[1] + g.B[1] + g.C[1]) / 3, (g.A[2] + g.B[2] + g.C[2]) / 3);
      cs.push(c);
      for (let k = 0; k < 3; k++) {
        const a = Q[k], b = Q[(k + 1) % 3], m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / step));
        for (let i = 0; i < m; i++) {
          xs.push(a[0] + ((b[0] - a[0]) * i) / m, a[1] + ((b[1] - a[1]) * i) / m, a[2] + ((b[2] - a[2]) * i) / m);
          cs.push(c);
        }
      }
    }
  }
  const n = cs.length;
  let size = 1;
  while (size < n * 2) size *= 2;
  const mask = size - 1;
  const hash = (x, y, z) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
  const cellOf = new Uint32Array(n), start = new Uint32Array(size + 1);
  for (let i = 0; i < n; i++) {
    cellOf[i] = hash(Math.floor(xs[i * 3] / r), Math.floor(xs[i * 3 + 1] / r), Math.floor(xs[i * 3 + 2] / r));
    start[cellOf[i] + 1]++;
  }
  for (let i = 0; i < size; i++) start[i + 1] += start[i];
  const fill = start.slice(0, size), order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[fill[cellOf[i]]++] = i;
  const X = Float64Array.from(xs), C = Uint8Array.from(cs), rr = r * r;
  return {
    n,
    nearOther(p, c) {
      const ix = Math.floor(p[0] / r), iy = Math.floor(p[1] / r), iz = Math.floor(p[2] / r);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const h = hash(ix + dx, iy + dy, iz + dz);
        for (let k = start[h]; k < start[h + 1]; k++) {
          const i = order[k];
          if (C[i] !== c && (X[i * 3] - p[0]) ** 2 + (X[i * 3 + 1] - p[1]) ** 2 + (X[i * 3 + 2] - p[2]) ** 2 < rr) return true;
        }
      }
      return false;
    },
  };
}

// Connected components of a Manifold's mesh in O(n) (Manifold.decompose() is O(components × size): minutes on a
// difference with thousands of slivers). With geo: signed volume, area and box per component. The returned array also
// carries .mesh (the MeshGL) and .label (component index of every triangle).
function meshComponents(man, geo = false) {
  const g = man.getMesh(), np = g.numProp, P = g.vertProperties, T = g.triVerts, nV = P.length / np, nT = T.length / 3;
  const par = new Int32Array(nV);
  for (let i = 0; i < nV; i++) par[i] = i;
  const find = (x) => {
    while (par[x] !== x) x = par[x] = par[par[x]];
    return x;
  };
  const unite = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) par[a] = b;
  };
  if (g.mergeFromVert) for (let k = 0; k < g.mergeFromVert.length; k++) unite(g.mergeFromVert[k], g.mergeToVert[k]);
  for (let t = 0; t < nT; t++) {
    unite(T[t * 3], T[t * 3 + 1]);
    unite(T[t * 3], T[t * 3 + 2]);
  }
  const id = new Map(), out = [], label = new Int32Array(nT);
  for (let t = 0; t < nT; t++) {
    const a = T[t * 3] * np, b = T[t * 3 + 1] * np, c = T[t * 3 + 2] * np, r = find(T[t * 3]);
    let k = id.get(r);
    if (k === undefined) {
      id.set(r, (k = out.length));
      out.push({ nT: 0, vol: 0, area: 0, o: [P[a], P[a + 1], P[a + 2]], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    }
    label[t] = k;
    const C = out[k];
    C.nT++;
    if (!geo) continue;
    const o = C.o;
    const A = [P[a] - o[0], P[a + 1] - o[1], P[a + 2] - o[2]], B = [P[b] - o[0], P[b + 1] - o[1], P[b + 2] - o[2]], D = [P[c] - o[0], P[c + 1] - o[1], P[c + 2] - o[2]];
    C.vol += (A[0] * (B[1] * D[2] - B[2] * D[1]) - A[1] * (B[0] * D[2] - B[2] * D[0]) + A[2] * (B[0] * D[1] - B[1] * D[0])) / 6;
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [D[0] - A[0], D[1] - A[1], D[2] - A[2]];
    C.area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    for (const q of [a, b, c]) for (let j = 0; j < 3; j++) {
      if (P[q + j] < C.min[j]) C.min[j] = P[q + j];
      if (P[q + j] > C.max[j]) C.max[j] = P[q + j];
    }
  }
  out.mesh = g;
  out.label = label;
  return out;
}

// A cavity is a separate surface with negative volume: merge it into the smallest positive component whose box holds
// it, so components become solids (like decompose()) — a hollow shell is one piece, not a huge solid plus a hole.
function groupCavities(cs) {
  const pos = [];
  for (let i = 0; i < cs.length; i++) if (cs[i].vol > 0) pos.push(i);
  pos.sort((a, b) => cs[a].vol - cs[b].vol);
  const owner = cs.map((_, i) => i), e = 1e-6;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.vol > 0) continue;
    for (const k of pos) {
      const o = cs[k];
      if (o.vol < -c.vol) continue;
      if (o.min[0] <= c.min[0] + e && o.min[1] <= c.min[1] + e && o.min[2] <= c.min[2] + e && o.max[0] >= c.max[0] - e && o.max[1] >= c.max[1] - e && o.max[2] >= c.max[2] - e) {
        owner[i] = k;
        break;
      }
    }
  }
  const idx = new Int32Array(cs.length).fill(-1), out = [];
  for (let i = 0; i < cs.length; i++) {
    const r = owner[i], c = cs[i];
    if (idx[r] < 0) {
      idx[r] = out.length;
      out.push({ nT: 0, vol: 0, area: 0, surfaces: 0, min: [...cs[r].min], max: [...cs[r].max] });
    }
    const G = out[idx[r]];
    G.nT += c.nT;
    G.vol += c.vol;
    G.area += c.area;
    G.surfaces++;
    for (let k = 0; k < 3; k++) {
      G.min[k] = Math.min(G.min[k], c.min[k]);
      G.max[k] = Math.max(G.max[k], c.max[k]);
    }
  }
  out.mesh = cs.mesh;
  out.label = cs.label.map((k) => idx[owner[k]]);
  return out;
}

// missing / extra pieces: total, share in components with mean thickness 2·vol/area ≥ 0.1 mm, biggest pieces
function pieceStats(man) {
  const cs = groupCavities(meshComponents(man, true)), top = [];
  let thick = 0;
  for (const c of cs) {
    const t = c.area > 0 ? (2 * c.vol) / c.area : 0;
    if (t >= 0.1) thick += c.vol;
    if (c.vol > 0.05) top.push({ vol: r2(c.vol, 2), meanThick: r2(t, 3), at: [0, 1, 2].map((k) => r2((c.min[k] + c.max[k]) / 2, 1)), size: [0, 1, 2].map((k) => r2(c.max[k] - c.min[k], 1)) });
  }
  return { n: cs.length, thick: r2(thick, 2), top: top.sort((a, b) => b.vol - a.vol).slice(0, 5) };
}

// ======================================================================= metrics
// Metric steps and how they are grouped into worker threads (--threads=N; 1 = a single worker runs them all).
// Every worker has its own WASM heap and rebuilds what its steps need (parts, original solid M, union of the parts):
// booleans between glued parts (shared contact surfaces) are what costs time, and they parallelise well this way.
const STEPS = ['valid', 'original', 'missing', 'extra', 'overlap', 'catch', 'thin', 'color'];
const GROUPS = {
  1: [STEPS],
  2: [['valid', 'original', 'missing', 'extra'], ['overlap', 'catch', 'thin', 'color']],
  3: [['valid', 'original', 'missing', 'extra'], ['overlap', 'catch'], ['thin', 'color']],
  4: [['valid', 'original', 'missing'], ['extra'], ['overlap', 'catch'], ['thin', 'color']],
};

async function runMetrics(model, parts, cfg, R) {
  const T0 = performance.now(), n = Math.max(1, Math.min(4, cfg.threads | 0 || 1));
  // only plain data crosses into the workers
  const m = { palette: model.palette, parts: model.parts.map((p) => ({ V: p.V, T: p.T, tc: p.tc })) };
  const ps = parts.map((p) => ({ kind: p.kind, color: p.color, n: p.n, up: p.up, V: Float32Array.from(p.V), T: Uint32Array.from(p.T) }));
  const outs = await Promise.all(GROUPS[n].map(async (steps) => {
    const o = await inWorker({ task: 'metrics', model: m, parts: ps, cfg, steps });
    return o.R ? o : { errors: Object.fromEntries(steps.map((s) => [s, o.error])) };
  }));
  const times = {}, errors = {};
  for (const o of outs) {
    Object.assign(R, o.R || {});
    for (const [k, v] of Object.entries(o.times || {})) times[k] = Math.max(times[k] ?? 0, v);
    Object.assign(errors, o.errors || {});
  }
  R.metricTimes = times;
  if (Object.keys(errors).length) R.metricErrors = errors;
  R.metricThreads = n;
  R.metric_s = r2((performance.now() - T0) / 1000, 1);
  R.maxRSS_MB = Math.round(process.resourceUsage().maxRSS / 1024);
  console.log(`metrics ${R.metric_s} s (${n} thread${n > 1 ? 's' : ''}, peak RSS ${R.maxRSS_MB} MB) ${JSON.stringify(times)}`);
}

// Runs the given metric steps (plus whatever they depend on); returns { R, times, errors }
function metrics(w, model, parts, { mode, skinDepth, samples }, steps) {
  const { Manifold } = w;
  const R = {}, times = {}, errors = {}, own = [];
  const want = (s) => steps.includes(s);
  const step = (name, fn) => {
    const t = performance.now();
    try {
      fn();
    } catch (e) {
      errors[name] = errMsg(e);
      console.log(`metric ${name} failed: ${(e && e.stack) || e}`);
    }
    times[name] = r2((performance.now() - t) / 1000, 2);
  };
  const vec = (d) => (Array.isArray(d) || ArrayBuffer.isView(d)) && d.length === 3 && d.every(Number.isFinite) && Math.hypot(d[0], d[1], d[2]) > 1e-9;

  // ---- parts as manifolds (every step needs them); 1/2: counts, validity, genus
  const PM = new Array(parts.length).fill(null), vols = new Array(parts.length).fill(0), info = [];
  step('build', () => {
    parts.forEach((p, i) => {
      const b = buildMan(w, p.V, p.T);
      let vol = signedVolume(p.V, p.T), genus = null, comps = null;
      if (b) {
        vol = b.man.volume();
        try {
          const surf = meshComponents(b.man, true);
          genus = b.man.genus() + surf.length - 1; // Manifold.genus() of c closed surfaces = 1 − c + Σ genus
          comps = groupCavities(surf).length; // solids (a cavity is not a separate piece)
        } catch { /* leave unknown */ }
        if (vol > 0) {
          PM[i] = b.man;
          own.push(b.man);
        } else b.man.delete();
      }
      vols[i] = vol;
      info.push({ i, kind: p.kind, color: p.color, vol: r2(vol, 2), genus, comps, valid: !!PM[i], merged: b ? b.how === 'merged' : null });
    });
  });
  const valid = PM.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
  const boxes = PM.map((m) => (m ? m.boundingBox() : null));
  if (want('valid')) step('valid', () => {
    R.nParts = parts.length;
    R.byKind = {};
    for (const p of parts) R.byKind[p.kind] = (R.byKind[p.kind] || 0) + 1;
    R.nBodies = R.byKind.body || 0;
    R.nCovers = R.byKind.cover || 0;
    const bodies = info.filter((x) => x.kind === 'body'), covers = info.filter((x) => x.kind === 'cover' && x.genus != null);
    R.invalid = info.filter((x) => !x.valid).length;
    R.mergedToBuild = info.filter((x) => x.merged).length;
    R.multiComp = info.filter((x) => x.comps > 1).length;
    R.bodyGenus = bodies.map((x) => x.genus);
    R.bodyComps = bodies.map((x) => x.comps);
    R.coverGenusMax = R.nCovers ? (covers.length ? Math.max(...covers.map((x) => x.genus)) : null) : null;
    R.coverGenusSum = R.nCovers ? covers.reduce((a, x) => a + x.genus, 0) : null;
    R.small = vols.filter((v) => v < 20).length;
    R.smallList = info.filter((x) => x.vol < 20).slice(0, 12).map((x) => [x.i, x.kind, x.color, x.vol]);
    R.minVol = parts.length ? r2(Math.min(...vols), 3) : null;
    R.parts = info;
  });

  // ---- 3: volumes against the original solid M
  let M = null, U = null;
  if (['original', 'missing', 'extra', 'color'].some(want)) step('original', () => {
    const r = buildOriginalSolid(w, model);
    M = r.M;
    if (M) own.push(M);
    if (want('original')) {
      R.origSolid = r.info;
      R.volM = M ? r2(M.volume(), 1) : null;
    }
    if (!M) throw new Error('could not build the original solid');
  });
  if (want('missing') || want('extra')) step('union', () => {
    if (!valid.length) throw new Error('no valid part');
    U = Manifold.union(valid.map((i) => PM[i]));
    own.push(U);
    U.volume(); // booleans are lazy: evaluate here so the timing lands in this step
  });
  if (want('missing')) step('missing', () => {
    R.volParts = r2(valid.reduce((a, i) => a + vols[i], 0), 1);
    if (!M || !U) throw new Error('needs the original solid and the union of the parts');
    R.volUnion = r2(U.volume(), 1);
    R.overlapUnion = r2(R.volParts - U.volume(), 2); // = Σ pairwise overlaps when no 3 parts share volume
    const D = M.subtract(U);
    R.missing = r2(D.volume(), 2);
    R.missingPct = r2((100 * D.volume()) / M.volume(), 3);
    const s = pieceStats(D);
    D.delete();
    R.missingThick = s.thick;
    R.missingPieces = s;
  });
  if (want('extra')) step('extra', () => {
    if (!M || !U) throw new Error('needs the original solid and the union of the parts');
    const E = U.subtract(M);
    R.extra = r2(E.volume(), 2);
    R.extraPct = r2((100 * E.volume()) / M.volume(), 3);
    const s = pieceStats(E);
    E.delete();
    R.extraThick = s.thick;
    R.extraPieces = s;
  });
  if (want('overlap')) step('overlap', () => {
    let sum = 0, pairs = 0, degenerate = 0;
    const worst = [], t0 = performance.now();
    for (let x = 0; x < valid.length && !R.overlapPartial; x++) for (let y = x + 1; y < valid.length; y++) {
      const i = valid[x], j = valid[y];
      if (!boxesOverlap(boxes[i], boxes[j])) continue;
      const I = PM[i].intersect(PM[j]), v = I.volume();
      I.delete();
      // parts that merely touch can intersect in inverted slivers with a (meaningless) negative volume
      if (v < -1e-3) degenerate++;
      sum += Math.max(0, v);
      pairs++;
      if (v > 1e-3) worst.push({ i, j, vol: r2(v, 3) });
      if (performance.now() - t0 > 120e3) {
        R.overlapPartial = true;
        break;
      }
    }
    R.overlap = r2(sum, 2);
    R.overlapPairs = pairs;
    R.overlapDegenerate = degenerate;
    R.overlapWorst = worst.sort((a, b) => b.vol - a.vol).slice(0, 5);
  });

  // ---- 4: thinness (inward ray through the same part, in 2 mm chunks: Manifold.rayCast cost grows with the ray's box)
  if (want('thin')) step('thin', () => {
    const rnd = mulberry32(7), MAXR = 30000, CHUNK = 2, FAR = 20;
    const thick = (m, c, n) => {
      for (let s0 = 0.01; s0 < FAR; s0 += CHUNK) {
        const s1 = Math.min(FAR, s0 + CHUNK);
        const h = m.rayCast([c[0] - n[0] * s0, c[1] - n[1] * s0, c[2] - n[2] * s0], [c[0] - n[0] * s1, c[1] - n[1] * s1, c[2] - n[2] * s1]);
        if (h.length) return s0 + h[0].distance * (s1 - s0);
      }
      return FAR;
    };
    let totA = 0, a04 = 0, a08 = 0, rays = 0, worst = { i: -1, mm2: 0 };
    const per = [];
    for (const i of valid) {
      const p = parts[i], m = PM[i], nT = p.T.length / 3;
      const geo = [];
      let A = 0, pts = 0;
      for (let t = 0; t < nT; t++) {
        const g = triGeom(p.V, p.T, t);
        if (g.area <= 1e-4) continue;
        geo.push(g);
        A += g.area;
        pts += Math.min(50, Math.ceil(g.area)); // one ray per mm², at least the centroid of every triangle
      }
      // [point, normal, weight]
      const S = [];
      if (pts <= MAXR) {
        for (const g of geo) {
          const k = Math.min(50, Math.ceil(g.area));
          if (k === 1) S.push([[(g.A[0] + g.B[0] + g.C[0]) / 3, (g.A[1] + g.B[1] + g.C[1]) / 3, (g.A[2] + g.B[2] + g.C[2]) / 3], g.n, g.area]);
          else for (let q = 0; q < k; q++) S.push([pointIn(g, rnd), g.n, g.area / k]);
        }
      } else {
        const cum = new Float64Array(geo.length);
        geo.reduce((acc, g, k) => (cum[k] = acc + g.area), 0);
        for (let q = 0; q < MAXR; q++) {
          const r = rnd() * A;
          let lo = 0, hi = geo.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cum[mid] > r) hi = mid;
            else lo = mid + 1;
          }
          S.push([pointIn(geo[lo], rnd), geo[lo].n, A / MAXR]);
        }
      }
      let t04 = 0, t08 = 0;
      for (const [c, n, wt] of S) {
        const th = thick(m, c, n);
        // 2 µm tolerance: walls designed exactly at a limit (e.g. 1.2 − 0.8 = 0.4) must not flip on float noise
        if (th < 0.4 - 0.002) t04 += wt;
        if (th < 0.8 - 0.002) t08 += wt;
      }
      rays += S.length;
      totA += A;
      a04 += t04;
      a08 += t08;
      if (t04 > worst.mm2) worst = { i, mm2: t04 };
      per.push({ i, area: r2(A, 1), thin04: r2(t04, 2), thin08: r2(t08, 2) });
    }
    R.thin04 = totA ? r2((100 * a04) / totA, 3) : null;
    R.thin08 = totA ? r2((100 * a08) / totA, 3) : null;
    R.thin04mm2 = r2(a04, 1);
    R.thin08mm2 = r2(a08, 1);
    R.thinWorst = worst.i >= 0 ? { i: worst.i, kind: parts[worst.i].kind, color: parts[worst.i].color, mm2: r2(worst.mm2, 2) } : null;
    R.thinByPart = per.filter((x) => x.thin04 > 0.5).sort((a, b) => b.thin04 - a.thin04).slice(0, 10);
    R.thinRays = rays;
  });

  // ---- 5: colour error on the original painted outer surface
  if (want('color')) step('color', () => {
    const delta = mode === 'skin' ? skinDepth + 0.3 : 0.3, back = 0.6;
    R.colDelta = r2(delta, 3);
    const tris = [];
    let tot = 0;
    for (const p of model.parts) for (let t = 0; t < p.T.length / 3; t++) {
      const g = triGeom(p.V, p.T, t);
      if (!(g.area > 0)) continue;
      g.c = p.tc ? p.tc[t] : 0;
      tot += g.area;
      g.cum = tot;
      tris.push(g);
    }
    const rnd = mulberry32(12345);
    const pick = (r) => {
      let lo = 0, hi = tris.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tris[mid].cum > r) hi = mid;
        else lo = mid + 1;
      }
      return tris[lo];
    };
    const near = colorPointHash(model, 0.5);
    const bb = M ? M.boundingBox() : null;
    if (!M) R.colNote = 'original solid unavailable: inner surfaces are not filtered out';
    const par = (h) => h.length & 1;
    // ray parity against M, near-axis rays to the box wall (short ray boxes keep Manifold.rayCast fast); 2 of 3 vote
    const insideM = (q) => {
      if (!M || q.some((x, k) => x <= bb.min[k] || x >= bb.max[k])) return false;
      const zt = bb.max[2] + 1 - q[2], zb = q[2] - bb.min[2] + 1, xr = bb.max[0] + 1 - q[0];
      const a = par(M.rayCast(q, [q[0] + 0.0123 * zt, q[1] + 0.0071 * zt, bb.max[2] + 1]));
      const b = par(M.rayCast(q, [q[0] - 0.0087 * zb, q[1] + 0.0109 * zb, bb.min[2] - 1]));
      if (a === b) return a === 1;
      return par(M.rayCast(q, [bb.max[0] + 1, q[1] + 0.0097 * xr, q[2] - 0.0113 * xr])) === 1;
    };
    let kept = 0, err = 0, noHit = 0, far = 0, farErr = 0;
    const conf = new Map(), byCol = new Map();
    for (let s = 0; s < samples; s++) {
      const g = pick(rnd() * tot), p = pointIn(g, rnd), n = g.n, c = g.c;
      if (insideM([p[0] + 0.05 * n[0], p[1] + 0.05 * n[1], p[2] + 0.05 * n[2]])) continue;
      kept++;
      const a = [p[0] + delta * n[0], p[1] + delta * n[1], p[2] + delta * n[2]], b = [p[0] - back * n[0], p[1] - back * n[1], p[2] - back * n[2]];
      const sb = { min: [0, 1, 2].map((k) => Math.min(a[k], b[k]) - 1e-3), max: [0, 1, 2].map((k) => Math.max(a[k], b[k]) + 1e-3) };
      let best = Infinity, got = -1;
      for (const i of valid) {
        if (!boxesOverlap(boxes[i], sb)) continue;
        const h = PM[i].rayCast(a, b);
        if (h.length && h[0].distance < best) {
          best = h[0].distance;
          got = parts[i].color;
        }
      }
      const bad = got !== c;
      const bc = byCol.get(c) || [0, 0];
      bc[0]++;
      if (bad) {
        err++;
        bc[1]++;
        if (got < 0) noHit++;
        const k = `${c}→${got < 0 ? 'none' : got}`;
        conf.set(k, (conf.get(k) || 0) + 1);
      }
      byCol.set(c, bc);
      if (!near.nearOther(p, c)) {
        far++;
        if (bad) farErr++;
      }
    }
    R.colSamples = samples;
    R.colKept = kept;
    R.colErr = kept ? r2((100 * err) / kept, 3) : null;
    R.colErrFar = far ? r2((100 * farErr) / far, 3) : null;
    R.colFarSamples = far;
    R.colNoHit = kept ? r2((100 * noHit) / kept, 3) : null;
    R.colConfusion = [...conf.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([pair, k]) => ({ pair, pct: r2((100 * k) / kept, 3) }));
    R.colErrByColor = Object.fromEntries([...byCol.entries()].sort((x, y) => x[0] - y[0]).map(([c, [k, e]]) => [c, r2((100 * e) / k, 2)]));
  });

  // ---- 6: insertion catch: covers slid along their direction must not hit the bodies
  if (want('catch')) step('catch', () => {
    const bodies = valid.filter((i) => parts[i].kind === 'body');
    const covers = valid.filter((i) => (parts[i].kind === 'cover' || parts[i].kind === 'inlay') && (vec(parts[i].n) || vec(parts[i].up)));
    R.nCoversChecked = covers.length;
    R.nCoversNoDir = valid.filter((i) => parts[i].kind === 'cover' && !vec(parts[i].n) && !vec(parts[i].up)).length;
    if (!bodies.length) {
      R.catchCount = covers.length ? null : 0;
      R.catchNote = 'no body part';
      return;
    }
    const B = bodies.length > 1 ? Manifold.union(bodies.map((i) => PM[i])) : PM[bodies[0]];
    if (bodies.length > 1) own.push(B);
    const rows = [];
    for (const i of covers) {
      const p = parts[i], m = PM[i], d0 = vec(p.n) ? p.n : p.up, l = Math.hypot(d0[0], d0[1], d0[2]), n = [d0[0] / l, d0[1] / l, d0[2] / l];
      const bb = boxes[i], D = 5;
      // the bodies clipped to the box swept by the cover: the slides below then only touch local geometry
      const lo = [0, 1, 2].map((k) => Math.min(bb.min[k], bb.min[k] + D * n[k]) - 0.5), hi = [0, 1, 2].map((k) => Math.max(bb.max[k], bb.max[k] + D * n[k]) + 0.5);
      const c0 = Manifold.cube([hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]), box = c0.translate(lo), BL = B.intersect(box);
      c0.delete();
      box.delete();
      let worst = 0, atD = 0;
      for (const d of [0.5, 1, 2, 3, D]) {
        const t = m.translate([n[0] * d, n[1] * d, n[2] * d]), I = t.intersect(BL), v = I.volume();
        t.delete();
        I.delete();
        if (v > worst) {
          worst = v;
          atD = d;
        }
      }
      BL.delete();
      rows.push({ i, kind: p.kind, color: p.color, vol: r2(worst, 3), d: atD, coverVol: r2(vols[i], 1), catch: worst > Math.max(1, 0.02 * vols[i]) });
    }
    R.catchCount = rows.filter((r) => r.catch).length;
    R.catchWorst = rows.sort((a, b) => b.vol - a.vol).slice(0, 3);
  });

  for (const m of own) {
    try {
      m.delete();
    } catch { /* already freed */ }
  }
  return { R, times, errors };
}

if (!isMainThread) await workerMain();
else if (flag('one')) await child();
else await parent();
