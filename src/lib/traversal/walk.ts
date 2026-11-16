import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import type { Engine } from '$lib/engine/Engine';
import { derive } from '$lib/model/physics';

/**
 * First/third-person walk mode: a kinematic capsule against the merged blockout BVH,
 * using the project's character profile.
 */
export class WalkMode {
  engine: Engine;
  camera = new THREE.PerspectiveCamera(72, 1, 0.05, 2000);
  pos = new THREE.Vector3(); // feet position
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  coyote = 0;
  jumpsLeft = 0;
  third = false;
  keys = new Set<string>();
  geom: THREE.BufferGeometry | null = null;
  bvh: MeshBVH | null = null;
  spawn = new THREE.Vector3();
  body: THREE.Mesh | null = null;
  stats = { speed: 0, peak: 0, airtime: 0 };
  private air = 0;
  private jumpStartY = 0;
  private hook = (dt: number) => this.update(dt);
  private off: (() => void)[] = [];
  onExit: () => void = () => {};

  constructor(engine: Engine) {
    this.engine = engine;
  }

  start(at: THREE.Vector3, yawDeg: number) {
    const geom = this.engine.collisionGeometry();
    if (!geom) {
      this.engine.editor.toast('Draw some solid geometry to walk on first', 'warn');
      return false;
    }
    this.geom = geom;
    this.bvh = (geom as any).boundsTree;
    this.spawn.copy(at);
    this.pos.copy(at).add(new THREE.Vector3(0, 0.05, 0));
    this.vel.set(0, 0, 0);
    this.yaw = (yawDeg * Math.PI) / 180 + Math.PI;
    this.pitch = -0.05;
    this.camera.aspect = this.engine.width / this.engine.height;
    this.camera.updateProjectionMatrix();
    const c = this.engine.editor.project.character;
    const g = new THREE.CapsuleGeometry(c.radius, Math.max(0.01, c.height - 2 * c.radius), 6, 16).translate(0, c.height / 2, 0);
    this.body = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#4da3ff', roughness: 0.5 }));
    this.body.castShadow = true;
    this.body.visible = this.third;
    this.engine.scene.add(this.body);

    const el = this.engine.renderer.domElement;
    const on = (t: EventTarget, type: string, fn: any) => {
      t.addEventListener(type, fn);
      this.off.push(() => t.removeEventListener(type, fn));
    };
    on(document, 'mousemove', (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return;
      this.yaw -= e.movementX * 0.0023;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0023, -1.45, 1.45);
    });
    on(window, 'keydown', (e: KeyboardEvent) => {
      const k = e.code;
      this.keys.add(k);
      if (k === 'Space') {
        this.tryJump();
        e.preventDefault();
      }
      if (k === 'KeyC') {
        this.third = !this.third;
        if (this.body) this.body.visible = this.third;
      }
      if (k === 'KeyR') this.respawn();
      if (k === 'Escape') this.stop();
      e.stopImmediatePropagation();
    });
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    on(document, 'pointerlockchange', () => {
      if (document.pointerLockElement !== el) this.stop();
    });
    on(el, 'click', () => {
      if (document.pointerLockElement !== el) el.requestPointerLock?.();
    });
    el.requestPointerLock?.();
    this.engine.frameHooks.add(this.hook);
    this.engine.cameraOverride = this.camera;
    this.engine.continuous = true;
    return true;
  }

  stop() {
    if (!this.geom) return;
    this.engine.frameHooks.delete(this.hook);
    this.off.forEach((f) => f());
    this.off = [];
    if (document.pointerLockElement) document.exitPointerLock();
    this.geom.dispose();
    this.geom = null;
    this.bvh = null;
    this.body?.removeFromParent();
    this.body = null;
    this.engine.cameraOverride = null;
    this.engine.continuous = false;
    this.keys.clear();
    this.engine.invalidate();
    this.onExit();
  }

  respawn() {
    this.pos.copy(this.spawn).add(new THREE.Vector3(0, 0.05, 0));
    this.vel.set(0, 0, 0);
  }

  private tryJump() {
    const c = this.engine.editor.project.character;
    const { v0 } = derive(c);
    if (this.onGround || this.coyote > 0) {
      this.vel.y = v0;
      this.onGround = false;
      this.coyote = 0;
      this.jumpsLeft = c.extraJumps;
      this.jumpStartY = this.pos.y;
      this.stats.peak = 0;
      this.air = 0;
    } else if (this.jumpsLeft > 0) {
      this.vel.y = v0;
      this.jumpsLeft--;
    }
  }

  private update(dt: number) {
    if (!this.bvh) return;
    const c = this.engine.editor.project.character;
    const { g } = derive(c);
    const steps = 4;
    const h = dt / steps;
    // input
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const input = new THREE.Vector3();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) input.add(fwd);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) input.sub(fwd);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) input.add(right);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) input.sub(right);
    if (input.lengthSq() > 0) input.normalize();
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = sprint ? c.sprintSpeed : c.walkSpeed;
    const want = input.multiplyScalar(speed);

    for (let s = 0; s < steps; s++) {
      if (this.onGround) {
        this.vel.x = want.x;
        this.vel.z = want.z;
      } else {
        const k = Math.min(1, c.airControl * 8 * h);
        if (want.lengthSq() > 0) {
          this.vel.x += (want.x - this.vel.x) * k;
          this.vel.z += (want.z - this.vel.z) * k;
        }
      }
      this.vel.y -= g * h;
      this.pos.addScaledVector(this.vel, h);
      this.collide(h, c.radius, c.height);
    }
    if (this.onGround) {
      this.coyote = c.coyoteTime;
      this.air = 0;
    } else {
      this.coyote -= dt;
      this.air += dt;
      this.stats.peak = Math.max(this.stats.peak, this.pos.y - this.jumpStartY);
    }
    if (this.pos.y < -60) this.respawn();
    this.stats.speed = Math.hypot(this.vel.x, this.vel.z);
    this.stats.airtime = this.air;

    // camera
    const eye = this.pos.clone().add(new THREE.Vector3(0, c.height * 0.92, 0));
    const look = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    if (this.third) {
      const back = eye.clone().addScaledVector(look, -4.5).add(new THREE.Vector3(0, 0.8, 0));
      this.camera.position.copy(back);
      this.camera.lookAt(eye.clone().addScaledVector(look, 2));
    } else {
      this.camera.position.copy(eye);
      this.camera.lookAt(eye.clone().add(look));
    }
    if (this.body) this.body.position.copy(this.pos);
    this.camera.aspect = this.engine.width / this.engine.height;
    this.camera.updateProjectionMatrix();
    this.engine.editor.walkStats = { speed: this.stats.speed, peak: this.stats.peak, airtime: this.stats.airtime, grounded: this.onGround, sprint };
  }

  private seg = new THREE.Line3();
  private box = new THREE.Box3();
  private collide(dt: number, r: number, height: number) {
    const bvh = this.bvh!;
    const start = this.pos.clone().add(new THREE.Vector3(0, r, 0));
    const end = this.pos.clone().add(new THREE.Vector3(0, height - r, 0));
    this.seg.set(start.clone(), end.clone());
    this.box.makeEmpty();
    this.box.expandByPoint(this.seg.start);
    this.box.expandByPoint(this.seg.end);
    this.box.min.addScalar(-r);
    this.box.max.addScalar(r);
    const triPoint = new THREE.Vector3(), capPoint = new THREE.Vector3();
    bvh.shapecast({
      intersectsBounds: (b: THREE.Box3) => b.intersectsBox(this.box),
      intersectsTriangle: (tri: any) => {
        const d = tri.closestPointToSegment(this.seg, triPoint, capPoint);
        if (d < r) {
          const depth = r - d;
          const dir = capPoint.sub(triPoint).normalize();
          this.seg.start.addScaledVector(dir, depth);
          this.seg.end.addScaledVector(dir, depth);
        }
      }
    });
    const delta = this.seg.start.clone().sub(start);
    this.onGround = delta.y > Math.abs(dt * this.vel.y * 0.25);
    const off = Math.max(0, delta.length() - 1e-5);
    if (off > 0) {
      const n = delta.clone().normalize();
      this.pos.addScaledVector(n, off);
      if (this.onGround) this.vel.y = 0;
      else this.vel.addScaledVector(n, -n.dot(this.vel));
    }
  }
}
