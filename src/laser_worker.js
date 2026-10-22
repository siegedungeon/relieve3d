import { optimizeLaser } from './core/laser_nest.js';
self.onmessage = async ({ data }) => {
  try {
    const result = await optimizeLaser(data.templates, data.config, { onProgress: progress => self.postMessage({ type: 'progress', progress }) });
    self.postMessage({ type: 'done', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
