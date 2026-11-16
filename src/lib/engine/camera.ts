import * as THREE from 'three';

const D2R = Math.PI / 180;

export interface RigState {
  target: THREE.Vector3;
  distance: number;
  yaw: number; // radians
  pitch: number; // radians, 0 = horizon, PI/2 = straight down
}

/**
 * Orbit/pan/zoom rig with a perspective camera for 3D and an orthographic camera for plan view.
 * Input handling lives in Engine; this is pure camera math + animation.
 */
export class CameraRig {
  persp: THREE.PerspectiveCamera;
  ortho: THREE.OrthographicCamera;
  mode: '3d' | 'plan' = '3d';
  s: RigState = { target: new THREE.Vector3(0, 0, 0), distance: 38, yaw: 35 * D2R, pitch: 42 * D2R };
  private saved3d: { yaw: number; pitch: number } | null = null;
  private anim: { from: RigState; to: RigState; t0: number; dur: number; done?: () => void } | null = null;
  aspect = 1;
  onChange: () => void = () => {};

  constructor() {
    this.persp = new THREE.PerspectiveCamera(50, 1, 0.05, 4000);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -2000, 4000);
    this.apply();
  }

  get camera(): THREE.Camera {
    return this.mode === 'plan' ? this.ortho : this.persp;
  }

  setAspect(a: number) {
    this.aspect = a;
    this.persp.aspect = a;
    this.persp.updateProjectionMatrix();
    this.apply();
  }

  /** half-height of the visible area at the target (meters) */
  viewHalfHeight() {
    return this.s.distance * Math.tan((this.persp.fov * D2R) / 2);
  }

  apply() {
    const { target, distance, yaw, pitch } = this.s;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const off = new THREE.Vector3(cp * Math.sin(yaw), sp, cp * Math.cos(yaw)).multiplyScalar(distance);
    this.persp.position.copy(target).add(off);
    this.persp.up.set(0, 1, 0);
    if (pitch > 89.5 * D2R) {
      // looking straight down: keep screen-up stable
      this.persp.up.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    }
    this.persp.lookAt(target);
    this.persp.updateMatrixWorld();

    const h = this.viewHalfHeight();
    this.ortho.left = -h * this.aspect;
    this.ortho.right = h * this.aspect;
    this.ortho.top = h;
    this.ortho.bottom = -h;
    this.ortho.position.set(target.x, target.y + 500, target.z);
    this.ortho.up.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.ortho.lookAt(target);
    this.ortho.updateProjectionMatrix();
    this.ortho.updateMatrixWorld();
    this.onChange();
  }

  orbit(dx: number, dy: number) {
    if (this.mode === 'plan') return;
    this.s.yaw -= dx * 0.0055;
    this.s.pitch = THREE.MathUtils.clamp(this.s.pitch + dy * 0.0055, -10 * D2R, 89.9 * D2R);
    this.anim = null;
    this.apply();
  }

  /** pan by screen pixels; height = viewport height in px */
  pan(dx: number, dy: number, height: number) {
    const h = this.viewHalfHeight();
    const perPx = (2 * h) / height;
    const cam = this.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    let fwd: THREE.Vector3;
    if (this.mode === 'plan' || this.s.pitch > 60 * D2R) {
      fwd = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(-Math.sin(this.s.yaw), 0, -Math.cos(this.s.yaw));
      fwd.normalize();
    } else {
      const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      fwd = up;
    }
    right.y = this.mode === 'plan' ? 0 : right.y;
    this.s.target.addScaledVector(right, -dx * perPx).addScaledVector(fwd, dy * perPx);
    this.anim = null;
    this.apply();
  }

  /** zoom by factor (<1 = in) toward a world point */
  zoom(factor: number, toward?: THREE.Vector3) {
    const d0 = this.s.distance;
    const d1 = THREE.MathUtils.clamp(d0 * factor, 0.8, 1500);
    const f = d1 / d0;
    if (toward) {
      this.s.target.lerp(toward, 1 - f);
    }
    this.s.distance = d1;
    this.anim = null;
    this.apply();
  }

  /** orbit around a new pivot without moving the camera */
  repivot(p: THREE.Vector3) {
    if (this.mode === 'plan') return;
    const cam = this.persp.position.clone();
    const off = cam.clone().sub(p);
    const dist = off.length();
    if (dist < 0.5) return;
    this.s.target.copy(p);
    this.s.distance = dist;
    this.s.pitch = Math.asin(THREE.MathUtils.clamp(off.y / dist, -1, 1));
    this.s.yaw = Math.atan2(off.x, off.z);
    this.apply();
  }

  fly(forward: number, right: number, up: number) {
    const cam = this.persp;
    const f = new THREE.Vector3();
    cam.getWorldDirection(f);
    const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const speed = Math.max(4, this.s.distance * 0.9);
    const delta = f.multiplyScalar(forward * speed).add(r.multiplyScalar(right * speed)).add(new THREE.Vector3(0, up * speed, 0));
    this.s.target.add(delta);
    this.apply();
  }

  animateTo(to: Partial<RigState>, dur = 320, done?: () => void) {
    const from: RigState = { target: this.s.target.clone(), distance: this.s.distance, yaw: this.s.yaw, pitch: this.s.pitch };
    const full: RigState = {
      target: to.target?.clone() ?? from.target.clone(),
      distance: to.distance ?? from.distance,
      yaw: to.yaw ?? from.yaw,
      pitch: to.pitch ?? from.pitch
    };
    // shortest yaw
    while (full.yaw - from.yaw > Math.PI) full.yaw -= Math.PI * 2;
    while (full.yaw - from.yaw < -Math.PI) full.yaw += Math.PI * 2;
    this.anim = { from, to: full, t0: performance.now(), dur, done };
  }

  get animating() {
    return !!this.anim;
  }

  tick(now: number) {
    if (!this.anim) return false;
    const { from, to, t0, dur, done } = this.anim;
    const t = Math.min(1, (now - t0) / dur);
    const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    this.s.target.lerpVectors(from.target, to.target, k);
    this.s.distance = from.distance + (to.distance - from.distance) * k;
    this.s.yaw = from.yaw + (to.yaw - from.yaw) * k;
    this.s.pitch = from.pitch + (to.pitch - from.pitch) * k;
    this.apply();
    if (t >= 1) {
      this.anim = null;
      done?.();
    }
    return true;
  }

  setMode(mode: '3d' | 'plan', animate = true) {
    if (mode === this.mode) return;
    if (mode === 'plan') {
      this.saved3d = { yaw: this.s.yaw, pitch: this.s.pitch };
      const yaw = Math.round(this.s.yaw / (Math.PI / 2)) * (Math.PI / 2);
      if (!animate) {
        this.s.yaw = yaw;
        this.s.pitch = 89.99 * D2R;
        this.mode = 'plan';
        this.apply();
        return;
      }
      this.animateTo({ yaw: 0 * yaw, pitch: 89.99 * D2R }, 280, () => {
        this.mode = 'plan';
        this.apply();
      });
    } else {
      this.mode = '3d';
      this.s.pitch = 89.99 * D2R;
      this.apply();
      const back = this.saved3d ?? { yaw: 35 * D2R, pitch: 42 * D2R };
      if (animate) this.animateTo({ yaw: back.yaw, pitch: back.pitch }, 320);
      else {
        this.s.yaw = back.yaw;
        this.s.pitch = back.pitch;
        this.apply();
      }
    }
  }

  frame(box: THREE.Box3, animate = true) {
    if (box.isEmpty()) box = new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 2, 10));
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z * (this.mode === 'plan' ? 1 : 0.8), size.y, 4) * 0.5;
    const fit = r / Math.tan((this.persp.fov * D2R) / 2) / Math.min(1, this.aspect) * 1.25;
    const to = { target: c, distance: THREE.MathUtils.clamp(fit, 3, 1200) };
    if (animate) this.animateTo(to, 380);
    else {
      this.s.target.copy(c);
      this.s.distance = to.distance;
      this.apply();
    }
  }
}
