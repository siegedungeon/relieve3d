// splitJob (the colour-split worker's job runner): a WASM abort in one run must not break the next ones.
//   node test/splitjob.test.mjs
import { splitJob } from '../src/core/splitjob.js';

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

// fake engine: like manifold's WASM, an instance that aborted once aborts on every later call
let made = 0, loadFails = 0;
const load = async () => {
  if (loadFails) { loadFails--; throw new Error('no se pudo cargar'); }
  return { n: ++made, broken: false };
};
const split = (w, model, options, progress) => {
  if (w.broken) throw new WebAssembly.RuntimeError('Aborted(). Build with -sASSERTIONS for more info.');
  if (model.abort) { w.broken = true; throw new WebAssembly.RuntimeError('Aborted(). Build with -sASSERTIONS for more info.'); }
  if (model.bad) throw new Error('No se encontró un cuerpo base');
  progress('Uniendo cuerpo', 0.05);
  return { engine: w.n, parts: [{ mesh: { V: new Float32Array(9), T: new Uint32Array(3) } }] };
};
const run = splitJob(load, split);
const job = async (id, model) => {
  const out = [];
  await run({ id, model, options: {} }, (msg, transfer) => out.push({ msg, transfer }));
  return { progress: out.filter((o) => o.msg.progress), last: out[out.length - 1] };
};

{
  const r = await job(1, {});
  check(r.last.msg.result?.engine === 1 && r.progress.length === 1, 'a run posts its progress and result');
  check(r.last.transfer?.length === 2, 'the part buffers are transferred, not copied');
}
{
  const r = await job(2, { bad: true });
  check(r.last.msg.error === 'No se encontró un cuerpo base' && r.last.msg.fatal === false, 'an ordinary error is reported as such');
  const r2 = await job(3, {});
  check(r2.last.msg.result?.engine === 1 && made === 1, 'after an ordinary error the same engine is kept');
}
{
  const r = await job(4, { abort: true });
  check(/^Aborted\(\)/.test(r.last.msg.error) && r.last.msg.fatal === true, 'an abort inside the engine is reported as fatal');
  const r2 = await job(5, {});
  check(r2.last.msg.result?.engine === 2, `the next run works, on a fresh engine (${r2.last.msg.error || 'engine ' + r2.last.msg.result?.engine})`);
}
{
  const runL = splitJob(load, split);
  loadFails = 1;
  const out = [];
  await runL({ id: 6, model: {}, options: {} }, (msg) => out.push(msg));
  check(out[0]?.error === 'no se pudo cargar', 'an engine that fails to load is reported');
  const out2 = [];
  await runL({ id: 7, model: {}, options: {} }, (msg) => out2.push(msg));
  check(out2.some((m) => m.result), 'and loading is tried again on the next run');
}

if (fails) console.log(`${fails} FAILED`);
else console.log('all ok');
process.exitCode = fails ? 1 : 0;
