import * as THREE from 'three';

// Draggable markers live in model coordinates, so camera rotation and model centering are respected.
export class PlacementHandles {
  constructor(viewer, onMove) {
    this.viewer = viewer;
    this.onMove = onMove;
    this.handles = new Map();
    this.drag = null;
    const canvas = viewer.renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(pointer, viewer.camera);
      const hit = ray.intersectObjects([...this.handles.values()], false)[0];
      if (!hit) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      this.drag = { id: hit.object.userData.handle, z: hit.object.position.z };
      viewer.controls.enabled = false;
      canvas.setPointerCapture(event.pointerId);
    }, true);
    canvas.addEventListener('pointermove', (event) => {
      if (!this.drag) return;
      event.stopImmediatePropagation();
      const rect = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(pointer, viewer.camera);
      viewer.model.updateWorldMatrix(true, false);
      const origin = viewer.model.localToWorld(new THREE.Vector3(0, 0, this.drag.z));
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(viewer.model.matrixWorld);
      const point = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin), new THREE.Vector3());
      if (!point) return;
      const local = viewer.model.worldToLocal(point);
      const marker = this.handles.get(this.drag.id);
      marker.position.set(local.x, local.y, this.drag.z);
      viewer.requestRender();
    }, true);
    const finish = (event) => {
      if (!this.drag) return;
      event.stopImmediatePropagation();
      const marker = this.handles.get(this.drag.id);
      const id = this.drag.id;
      this.drag = null;
      viewer.controls.enabled = true;
      this.onMove(id, { x: marker.position.x, y: marker.position.y });
    };
    canvas.addEventListener('pointerup', finish, true);
    canvas.addEventListener('pointercancel', finish, true);
  }

  clear() {
    for (const marker of this.handles.values()) {
      this.viewer.model.remove(marker);
      marker.geometry.dispose();
      marker.material.dispose();
    }
    this.handles.clear();
  }

  set(id, position, color) {
    if (!position) return;
    const marker = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 12),
      new THREE.MeshBasicMaterial({ color, depthTest: false }));
    marker.position.set(position.x, position.y, position.z);
    marker.userData.handle = id;
    marker.renderOrder = 100;
    this.viewer.model.add(marker);
    this.handles.set(id, marker);
  }
}

export function openerHandle(opener, z) {
  if (!opener) return null;
  const angle = opener.angle * Math.PI / 180;
  const x = opener.xin + opener.depth;
  const y = opener.ys + opener.len / 2;
  return { x: opener.sg * (x * Math.cos(angle) - y * Math.sin(angle)),
    y: x * Math.sin(angle) + y * Math.cos(angle), z };
}
