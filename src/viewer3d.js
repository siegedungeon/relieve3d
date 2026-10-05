import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SEL_EMISSIVE = new THREE.Color(0x2563eb);

export class Viewer3D {
  constructor(container, { onPick } = {}) {
    this.container = container;
    this.onPick = onPick;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2b2e34);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(60, 140, 90);
    this.scene.add(dir, new THREE.AmbientLight(0xffffff, 0.25));

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 5000);
    this.camera.position.set(0, 110, 130);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('change', () => this.requestRender());

    const grid = new THREE.GridHelper(256, 32, 0x5b616c, 0x3d4149);
    grid.position.y = -0.02;
    this.scene.add(grid);

    // Model lives in Z-up space; rotate so it lies on the XZ grid.
    this.root = new THREE.Group();
    this.root.rotation.x = -Math.PI / 2;
    this.model = new THREE.Group();
    this.root.add(this.model);
    this.scene.add(this.root);

    this.meshes = new Map();
    this.extras = new Map();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();

    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || e.button !== 0) { down = null; return; }
      down = null;
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const hits = ray.intersectObjects([...this.meshes.values()].filter((m) => m.visible), false);
      this.onPick?.(hits.length ? hits[0].object.userData.pieceId : null, e.shiftKey || e.ctrlKey || e.metaKey);
    });
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender() {
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => {
      this._pending = false;
      const moving = this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (moving) this.requestRender();
    });
  }

  clear() {
    for (const m of this.meshes.values()) { m.geometry.dispose(); m.material.dispose(); this.model.remove(m); }
    this.meshes.clear();
    for (const k of [...this.extras.keys()]) this.setExtra(k, null);
    this.requestRender();
  }

  setScaleXY(s) {
    this.model.scale.set(s, s, 1);
    this.requestRender();
  }

  addPiece(id, geometry) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.userData.pieceId = id;
    this.meshes.set(id, mesh);
    this.model.add(mesh);
    return mesh;
  }

  updatePiece(id, { color, height, z, visible, selected }) {
    const m = this.meshes.get(id);
    if (!m) return;
    m.material.color.set(color);
    m.material.emissive.copy(selected ? SEL_EMISSIVE : new THREE.Color(0));
    m.material.emissiveIntensity = selected ? 0.45 : 0;
    m.scale.z = Math.max(0.01, height);
    m.position.z = z;
    m.visible = visible;
  }

  setExtra(name, geometry, opts = {}) {
    const old = this.extras.get(name);
    if (old) { old.geometry.dispose(); old.material.dispose(); this.model.remove(old); this.extras.delete(name); }
    if (geometry) {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: opts.color || '#ffffff', roughness: 0.6 }));
      mesh.scale.z = opts.height || 1;
      mesh.position.z = opts.z || 0;
      this.extras.set(name, mesh);
      this.model.add(mesh);
    }
    this.requestRender();
  }

  updateExtra(name, { color, height, z }) {
    const m = this.extras.get(name);
    if (!m) return;
    if (color) m.material.color.set(color);
    if (height != null) m.scale.z = height;
    if (z != null) m.position.z = z;
    this.requestRender();
  }

  frame(top = false) {
    this.scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const m of [...this.meshes.values(), ...this.extras.values()]) if (m.visible) box.expandByObject(m);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z, 10) * 0.5;
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const dist = r / Math.sin(Math.min(vHalf, hHalf)) * 1.15;
    this.controls.target.copy(c);
    if (top) this.camera.position.set(c.x, c.y + dist, c.z + 0.001);
    else this.camera.position.set(c.x, c.y + dist * 0.75, c.z + dist * 0.75);
    this.camera.near = dist / 100;
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }
}
