import { createColoring, applyColoringEdits, coloringShapes } from './core/coloring.js';

self.onmessage = ({ data }) => {
  try {
    const result = data.image ? createColoring(data.image, data.options, message => self.postMessage({ progress: message })) : data.result;
    const mask = applyColoringEdits(result, data.edits);
    let shapes = null;
    if (data.options.curveSmooth) {
      self.postMessage({ progress: 'Puliendo los contornos con curvas…' });
      shapes = coloringShapes(mask, result.width, result.height, data.options);
    }
    self.postMessage({ result, mask, shapes }, [result.mask.buffer, mask.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message || String(error) });
  }
};
