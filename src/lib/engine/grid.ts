import * as THREE from 'three';

/** Infinite-looking shader grid lying on the work plane. */
export class Grid {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uMinor: { value: 1 },
        uMajor: { value: 10 },
        uSub: { value: 0.5 },
        uFade: { value: 120 },
        uCenter: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color('#aab3c2') },
        uAxisX: { value: new THREE.Color('#e5534b') },
        uAxisZ: { value: new THREE.Color('#4d8ef7') },
        uStrength: { value: 1 }
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vPos = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vPos;
        uniform float uMinor, uMajor, uSub, uFade, uStrength;
        uniform vec3 uCenter, uColor, uAxisX, uAxisZ;
        float line(vec2 p, float s) {
          vec2 c = p / s;
          vec2 w = fwidth(c);
          vec2 g = abs(fract(c - 0.5) - 0.5) / max(w, vec2(1e-5));
          return 1.0 - min(min(g.x, g.y), 1.0);
        }
        void main() {
          vec2 p = vPos.xz;
          float sub = line(p, uSub) * 0.22;
          float minor = line(p, uMinor) * 0.45;
          float major = line(p, uMajor) * 0.8;
          float a = max(max(sub, minor), major);
          vec3 col = uColor;
          // axes
          float ax = 1.0 - min(abs(p.y) / max(fwidth(p.y) * 1.5, 1e-5), 1.0);
          float az = 1.0 - min(abs(p.x) / max(fwidth(p.x) * 1.5, 1e-5), 1.0);
          if (ax > 0.01) { col = mix(col, uAxisX, ax); a = max(a, ax * 0.9); }
          if (az > 0.01) { col = mix(col, uAxisZ, az); a = max(a, az * 0.9); }
          float d = length(vPos.xz - uCenter.xz);
          a *= 1.0 - smoothstep(uFade * 0.55, uFade, d);
          // sub lines vanish when too dense
          gl_FragColor = vec4(col, a * uStrength);
          if (gl_FragColor.a < 0.004) discard;
        }`
    });
    const geom = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.renderOrder = -1;
    this.mesh.raycast = () => {};
    this.mesh.frustumCulled = false;
  }

  update(center: THREE.Vector3, y: number, distance: number, step: number, size: number) {
    const fade = THREE.MathUtils.clamp(distance * 3, 40, 3000);
    this.mesh.scale.set(fade * 2.2, 1, fade * 2.2);
    this.mesh.position.set(center.x, y + 0.002, center.z);
    const u = this.material.uniforms;
    u.uFade.value = fade;
    u.uCenter.value.set(center.x, y, center.z);
    u.uSub.value = distance > 70 ? size : step;
    u.uMinor.value = distance > 250 ? size * 10 : size;
    u.uMajor.value = distance > 250 ? size * 100 : size * 10;
  }
}
