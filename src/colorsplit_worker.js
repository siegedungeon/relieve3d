// Module worker: runs the color separation (manifold WASM) off the UI thread.
// Import maps don't apply inside workers, so dependencies use relative paths.
import Module from '../node_modules/manifold-3d/manifold.js';
import { splitColors } from './core/colorsplit.js';
import { splitJob } from './core/splitjob.js';

const run = splitJob(async () => {
  const w = await Module({ locateFile: (f) => new URL('../node_modules/manifold-3d/' + f, import.meta.url).href });
  w.setup();
  return w;
}, splitColors);

self.onmessage = (e) => run(e.data, (msg, transfer) => self.postMessage(msg, transfer || []));
