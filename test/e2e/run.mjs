// End-to-end runner: starts the real Electron app and drives a whole module flow.
//   node test/e2e/run.mjs [colorsplit|logo|hablador|pencil|coloring|coloring-decorations|all] [input file]
// Defaults use synthetic inputs (painted sphere 3MF, test/logo.png, generated LOVECUBE mockup).
// Screenshots and exports go to test/out/e2e/<name>. Exits 1 if any check prints FAIL or the flow didn't finish.
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import electron from 'electron';
import { paintedSphere3MF } from '../fixtures/painted_sphere.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..', '..');
const outRoot = path.join(root, 'test', 'out', 'e2e');
const [which = 'all', inputArg] = process.argv.slice(2);

const inputs = {
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
  const input = path.resolve(inputArg && which !== 'all' ? inputArg : inputs[name]());
  if (!fs.existsSync(input)) { console.log(`FAIL ${name}: input not found ${input}`); return Promise.resolve(false); }
  const dir = path.join(outRoot, name), exp = path.join(dir, 'export');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(exp, { recursive: true });
  console.log(`— ${name} (${path.basename(input)})`);
  const env = { ...process.env, R3D_TEST_FILE: path.join(here, `${name}.e2e.cjs`), E2E_DIR: dir, E2E_INPUT: input, R3D_AUTOSAVE_DIR: exp };
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
if (!names.every((n) => inputs[n])) { console.log('usage: node test/e2e/run.mjs [colorsplit|logo|hablador|pencil|coloring|coloring-decorations|all] [input]'); process.exit(2); }
let allOk = true;
for (const n of names) allOk = (await runOne(n)) && allOk;
console.log(allOk ? '\ne2e OK' : '\ne2e FAILED');
process.exit(allOk ? 0 : 1);
