// Runs colour-split jobs on one manifold WASM instance, made on first use. An abort or a memory fault inside WASM
// (a RuntimeError) leaves that instance broken: every later call aborts too, so a failed run in one mode would make
// every other mode fail until the app restarts. The broken instance is dropped and the next job starts a fresh one.
//   load(): Promise<wasm module>, split(w, model, options, progress): result, post(message, transfer?)
export function splitJob(load, split) {
  let wasm = null;
  return async ({ id, model, options }, post) => {
    try {
      const w = await (wasm ||= load().catch((err) => { wasm = null; throw err; }));
      const res = split(w, model, options, (msg, frac) => post({ id, progress: { msg, frac } }));
      post({ id, result: res }, res.parts.flatMap((p) => [p.mesh.V.buffer, p.mesh.T.buffer]));
    } catch (err) {
      const fatal = err instanceof WebAssembly.RuntimeError;
      if (fatal) wasm = null;
      post({ id, error: String(err?.message || err), fatal, stack: err?.stack });
    }
  };
}
