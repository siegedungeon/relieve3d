// End-to-end runner: starts the real Electron app and drives a whole module flow.
//   node test/e2e/run.mjs [colorsplit|logo|hablador|pencil|fonts|text-quality|coloring|coloring-decorations|quote|tiktok|all] [input file]
// Defaults use synthetic inputs (painted sphere 3MF, test/logo.png, generated LOVECUBE mockup).
// tiktok drives a throwaway copy of the TikTok workspace (R3D_TIKTOK_E2E_SRC, default ~/Documents/TikTok-Impresion3D);
// it needs Python with edge-tts, ffmpeg and internet for the guide voice. The real workspace is never written.
// Screenshots and exports go to test/out/e2e/<name>. Exits 1 if any check prints FAIL or the flow didn't finish.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import electron from 'electron';
import { paintedSphere3MF } from '../fixtures/painted_sphere.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..', '..');
const outRoot = path.join(root, 'test', 'out', 'e2e');
const [which = 'all', inputArg] = process.argv.slice(2);

// Per-module environment, prepared after the output folder is wiped.
const environments = {
  tiktok: (dir) => {
    const src = path.resolve(process.env.R3D_TIKTOK_E2E_SRC || path.join(os.homedir(), 'Documents', 'TikTok-Impresion3D'));
    if (!fs.existsSync(path.join(src, 'herramientas', 'tiktok3d.py'))) throw new Error(`TikTok workspace not found: ${src}`);
    const dest = path.join(dir, 'TikTok-Impresion3D');
    fs.cpSync(src, dest, { recursive: true, filter: (s) => !/[\\/](\.git|__pycache__|node_modules)$/.test(s) && !(fs.statSync(s).isFile() && fs.statSync(s).size > 50e6) });
    const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { R3D_TIKTOK_DIR: dest, R3D_TIKTOK_E2E_SRC: src, R3D_TIKTOK_TODAY: today, R3D_TIKTOK_NO_OPEN: '1', R3D_TIKTOK_CONFIG: path.join(dir, 'tiktok-studio.json') };
  },
};

const inputs = {
  laser: () => null,
  fonts: () => null,
  'text-quality': () => null,
  'pencil-batch': () => null,
  quote: () => null,
  tiktok: () => null,
  colorsplit: () => { const f = path.join(outRoot, 'painted_sphere.3mf'); fs.mkdirSync(outRoot, { recursive: true }); fs.writeFileSync(f, paintedSphere3MF()); return f; },
  logo: () => path.join(root, 'test', 'logo.png'),
  pencil: () => path.join(root, 'test', 'logo.png'),
  coloring: () => path.join(root, 'src', 'examples', 'coloring-scene.svg'),
  'coloring-decorations': () => path.join(root, 'src', 'examples', 'coloring-scene.svg'),
  hablador: () => {
    const f = path.join(root, 'test', 'out', 'mockup_LOVECUBE.png');
    if (!fs.existsSync(f)) spawnSync(process.execPath, [path.join(root, 'test', 'hablador_mockup.test.mjs')], { stdio: 'ignore' });
    return f;
  },
};

function runOne(name) {
  const source = inputArg && which !== 'all' ? inputArg : inputs[name]();
  const input = source ? path.resolve(source) : null;
  if (input && !fs.existsSync(input)) { console.log(`FAIL ${name}: input not found ${input}`); return Promise.resolve(false); }
  const dir = path.join(outRoot, name), exp = path.join(dir, 'export');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(exp, { recursive: true });
  console.log(`— ${name} (${input ? path.basename(input) : 'sin archivo de entrada'})`);
  let extra = {};
  try { extra = environments[name]?.(dir) || {}; } catch (err) { console.log(`  FAIL ${name}: ${err.message}`); return Promise.resolve(false); }
  const env = { ...process.env, R3D_TEST_FILE: path.join(here, `${name}.e2e.cjs`), E2E_DIR: dir, E2E_INPUT: input || '', R3D_AUTOSAVE_DIR: exp,
    R3D_QUOTE_TEST_DIR: path.join(dir, 'quotation-data'), ...extra };
  return new Promise((resolve) => {
    const p = spawn(electron, ['.'], { cwd: root, env });
    let buf = '', fails = 0, done = false;
    const onData = (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trimEnd(); buf = buf.slice(i + 1);
        if (!/\[e2e\]|\[test error\]/.test(line)) continue;
        console.log('  ' + line.replace('[e2e] ', ''));
        if (/\[e2e\] FAIL|\[test error\]/.test(line)) fails++;
        if (/\[e2e\] done/.test(line)) done = true;
      }
    };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('close', () => { const ok = done && !fails; console.log(`  ${ok ? 'OK' : 'FAILED'} — screenshots in ${path.relative(root, dir)}`); resolve(ok); });
  });
}

const names = which === 'all' ? Object.keys(inputs) : [which];
if (!names.every((n) => inputs[n])) { console.log('usage: node test/e2e/run.mjs [colorsplit|logo|hablador|pencil|fonts|text-quality|coloring|coloring-decorations|quote|tiktok|all] [input]'); process.exit(2); }
let allOk = true;
for (const n of names) allOk = (await runOne(n)) && allOk;
console.log(allOk ? '\ne2e OK' : '\ne2e FAILED');
process.exit(allOk ? 0 : 1);
