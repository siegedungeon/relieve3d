import { createColoring, applyColoringEdits, coloringShapes, coloringLayout } from './core/coloring.js';
import { validateDecorations, createDecorations, fitDecoration } from './core/coloring_decorations.js';

self.onmessage = ({ data }) => {
  try {
    const result = data.image ? createColoring(data.image, data.options, message => self.postMessage({ progress: message })) : data.result;
    const mask = applyColoringEdits(result, data.edits);
    let shapes = null;
    if (data.options.curveSmooth) {
      self.postMessage({ progress: 'Puliendo los contornos con curvas…' });
      shapes = coloringShapes(mask, result.width, result.height, data.options);
    }
    const decorations = validateDecorations(data.decorations);
    let warnings = [];
    if (data.options.decorate && decorations.items === null) {
      self.postMessage({ progress: 'Componiendo plantas, figuras y estrellas…' });
      const generated = createDecorations(result, coloringLayout(result.width, result.height, data.options), data.options, decorations.seed);
      decorations.items = generated.items; warnings = generated.warnings;
    } else if (decorations.items) decorations.items = decorations.items.map(p => fitDecoration(p, data.options));
    self.postMessage({ result, mask, shapes, decorations, warnings }, [result.mask.buffer, mask.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message || String(error) });
  }
};
