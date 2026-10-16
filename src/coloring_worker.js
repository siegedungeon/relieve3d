import { createColoring } from './core/coloring.js';

self.onmessage = ({ data }) => {
  try {
    const result = createColoring(data.image, data.options, message => self.postMessage({ progress: message }));
    self.postMessage({ result }, [result.mask.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message || String(error) });
  }
};
