import * as THREE from 'three';
import type { Engine } from '$lib/engine/Engine';
import { lineMaterial, dashedMaterial } from '$lib/engine/materials';
import type { WorkPlane } from './plane';

/** Little crosshair on the work plane + a drop line to the ground for depth reading. */
export class CursorMark {
  group = new THREE.Group();
  private ring: THREE.LineLoop;
  private cross: THREE.LineSegments;
  private drop: THREE.Line;
  private engine: Engine;

  constructor(engine: Engine) {
    this.engine = engine;
    const pts = Array.from({ length: 33 }, (_, i) => new THREE.Vector3(Math.cos((i / 32) * Math.PI * 2), 0, Math.sin((i / 32) * Math.PI * 2)));
    this.ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMaterial('#ffffff', 0.95, false));
    this.cross = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.8, 0, 0), new THREE.Vector3(1.8, 0, 0), new THREE.Vector3(0, 0, -1.8), new THREE.Vector3(0, 0, 1.8)]),
      lineMaterial('#ffffff', 0.5, false)
    );
    this.drop = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]), dashedMaterial('#ffffff', 0.2, 0.15, false));
    this.ring.renderOrder = this.cross.renderOrder = this.drop.renderOrder = 30;
    for (const o of [this.ring, this.cross, this.drop]) o.raycast = () => {};
    this.group.add(this.ring, this.cross, this.drop);
    this.group.visible = false;
    engine.overlay.add(this.group);
  }

  update(p: THREE.Vector3 | null, wp: WorkPlane | null, vertex = false) {
    if (!p || !wp) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const s = this.engine.pixelSize(p) * 6;
    this.ring.position.copy(p);
    this.cross.position.copy(p);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), wp.normal);
    this.ring.quaternion.copy(q);
    this.cross.quaternion.copy(q);
    this.ring.scale.setScalar(vertex ? s * 1.5 : s);
    this.cross.scale.setScalar(s);
    this.ring.material = lineMaterial(vertex ? '#4da3ff' : '#ffffff', 0.95, false);
    // drop line to y=0 when floating
    const ground = Math.min(0, this.engine.editor.planeY);
    const h = p.y - ground;
    this.drop.visible = h > 0.3;
    if (this.drop.visible) {
      this.drop.geometry.setFromPoints([p, new THREE.Vector3(p.x, ground, p.z)]);
      this.drop.computeLineDistances();
    }
  }

  dispose() {
    this.group.removeFromParent();
  }
}
