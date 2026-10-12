// Module worker: runs the color separation (manifold WASM) off the UI thread.
// Import maps don't apply inside workers, so dependencies use relative paths.
import Module from '../node_modules/manifold-3d/manifold.js';
import { splitColors } from './core/colorsplit.js';

let wasm = null;
const getWasm = async () => {
  if (!wasm) {
    wasm = await Module({ locateFile: (f) => new URL('../node_modules/manifold-3d/' + f, import.meta.url).href });
    wasm.setup();
  }
  return wasm;
};

self.onmessage = async (e) => {
  const { id, model, options } = e.data;
  try {
    const w = await getWasm();
    const res = splitColors(w, model, options, (msg, frac) => self.postMessage({ id, progress: { msg, frac } }));
    const transfer = [];
    for (const p of res.parts) {
      transfer.push(p.mesh.V.buffer, p.mesh.T.buffer);
    }
    self.postMessage({ id, result: res }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err), stack: err?.stack });
  }
};
