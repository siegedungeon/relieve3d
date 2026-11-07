// End-to-end runner: starts the real Electron app and drives a whole module flow.
//   node test/e2e/run.mjs [colorsplit|logo|hablador|pencil|fonts|text-quality|coloring|coloring-decorations|quote|tiktok|phonestand|local-links|all] [input file]
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
  // A local HTML (like a personal guide) in a path with spaces, accents and ñ, plus a missing and an invalid entry.
  'local-links': (dir) => {
    const folder = path.join(dir, 'Guía local ñ'), guide = path.join(folder, 'guía de prueba.html');
    fs.mkdirSync(folder, { recursive: true });
    fs.copyFileSync(path.join(root, 'test', 'fixtures', 'local-guide.html'), guide);
    fs.writeFileSync(path.join(folder, 'otra.html'), '<title>Otra</title>');
    const config = path.join(dir, 'accesos-locales.json');
    fs.writeFileSync(config, JSON.stringify({ accesos: [
      { id: 'e2e-guia-local', titulo: 'Guía de prueba', descripcion: 'HTML local de prueba', icono: '🎯', archivo: guide },
      { id: 'e2e-movida', titulo: 'Guía movida', archivo: path.join(folder, 'no-existe.html') },
      { id: 'e2e-relativa', titulo: 'Relativa', archivo: 'guia.html' },
    ] }, null, 2));
    return { R3D_LOCAL_LINKS_CONFIG: config, R3D_LOCAL_LINKS_NO_OPEN: '1', E2E_LOCAL_GUIDE: guide };
  },
};

// Per-module cleanup after Electron has exited (its files are no longer locked). Returns false if something was left behind.
const cleanups = {
  // The test guide's persistent partition is created in the real profile (%APPDATA%\relieve3d\Partitions): remove it.
  'local-links': (dir) => {
    const file = path.join(dir, 'partition-path.txt');
    if (!fs.existsSync(file)) return true;
    const partition = fs.readFileSync(file, 'utf8').trim();
    if (!/[\\/]Partitions[\\/]local-e2e-[a-z0-9-]+$/i.test(partition)) { console.log(`  FAIL cleanup: unexpected partition path ${partition}`); return false; }
    fs.rmSync(partition, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    if (fs.existsSync(partition)) { console.log(`  FAIL cleanup: could not delete ${partition}`); return false; }
    console.log('  test partition deleted from the profile');
    return true;
  },
};

const inputs = {
  laser: () => null,
  fonts: () => null,
  'text-quality': () => null,
  'pencil-batch': () => null,
  quote: () => null,
  tiktok: () => null,
  'local-links': () => null,
  colorsplit: () => { const f = path.join(outRoot, 'painted_sphere.3mf'); fs.mkdirSync(outRoot, { recursive: true }); fs.writeFileSync(f, paintedSphere3MF()); return f; },
  logo: () => path.join(root, 'test', 'logo.png'),
  pencil: () => path.join(root, 'test', 'logo.png'),
  phonestand: () => path.join(root, 'test', 'logo.png'),
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
    p.on('close', () => {
      let cleaned = true;
      try { cleaned = cleanups[name]?.(dir) ?? true; } catch (err) { console.log(`  FAIL cleanup: ${err.message}`); cleaned = false; }
      const ok = done && !fails && cleaned;
      console.log(`  ${ok ? 'OK' : 'FAILED'} — screenshots in ${path.relative(root, dir)}`); resolve(ok);
    });
  });
}

const names = which === 'all' ? Object.keys(inputs) : [which];
if (!names.every((n) => inputs[n])) { console.log('usage: node test/e2e/run.mjs [colorsplit|logo|hablador|pencil|fonts|text-quality|coloring|coloring-decorations|quote|tiktok|phonestand|local-links|all] [input]'); process.exit(2); }
let allOk = true;
for (const n of names) allOk = (await runOne(n)) && allOk;
console.log(allOk ? '\ne2e OK' : '\ne2e FAILED');
process.exit(allOk ? 0 : 1);
