// Copies the Three.js addons used by the app into src/vendor (electron-builder strips node_modules/*/examples).
import fs from 'fs';
import path from 'path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const files = ['controls/OrbitControls.js', 'environments/RoomEnvironment.js', 'utils/BufferGeometryUtils.js'];
for (const f of files) {
  const src = path.join(root, 'node_modules/three/examples/jsm', f);
  const dst = path.join(root, 'src/vendor/three-addons', f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
console.log('vendor: copied', files.length, 'Three.js addons');
