import * as THREE from 'three';

export const COLORS = {
  solid: '#c9ced6',
  cut: '#ff5a5f',
  accent: '#4da3ff',
  hover: '#9ccaff',
  edge: '#3b4048',
  added: '#4caf50',
  removed: '#ff5252',
  changed: '#ffb300',
  ghost: '#9aa4b2'
};

const cache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}

/** Standard material with a world-space 1 m grid + subtle checker for scale reading. */
export function solidMaterial(color: string, opts: { opacity?: number } = {}) {
  return cached(`solid:${color}:${opts.opacity ?? 1}`, () => {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.92,
      metalness: 0,
      transparent: (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGridPos;\nvarying vec3 vGridNormal;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvGridPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGridNormal = normalize(mat3(modelMatrix) * objectNormal);'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGridPos;\nvarying vec3 vGridNormal;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec3 an = abs(vGridNormal);
            vec2 guv = an.y > 0.6 ? vGridPos.xz : (an.x > an.z ? vGridPos.zy : vGridPos.xy);
            vec2 gw = fwidth(guv);
            vec2 gg = abs(fract(guv - 0.5) - 0.5) / max(gw, vec2(1e-4));
            float gl = 1.0 - min(min(gg.x, gg.y), 1.0);
            float fade = 1.0 - smoothstep(0.08, 0.35, max(gw.x, gw.y));
            float ck = mod(floor(guv.x) + floor(guv.y), 2.0);
            diffuseColor.rgb *= 1.0 - 0.035 * ck * fade;
            diffuseColor.rgb *= 1.0 - 0.16 * gl * fade;
          }`
        );
    };
    m.customProgramCacheKey = () => 'blockout-grid';
    return m;
  });
}

export function translucentMaterial(color: string, opacity: number) {
  return cached(`tr:${color}:${opacity}`, () => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color).multiplyScalar(0.25),
      roughness: 1,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2
    });
  });
}

export function flatMaterial(color: string, opacity = 1) {
  return cached(`flat:${color}:${opacity}`, () => {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4
    });
  });
}

export function lineMaterial(color: string, opacity = 1, depthTest = true) {
  return cached(`line:${color}:${opacity}:${depthTest}`, () => {
    return new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: opacity < 1, opacity, depthTest });
  });
}

export function dashedMaterial(color: string, dash = 0.4, gap = 0.25, depthTest = true) {
  return cached(`dash:${color}:${dash}:${gap}:${depthTest}`, () => {
    return new THREE.LineDashedMaterial({ color: new THREE.Color(color), dashSize: dash, gapSize: gap, depthTest, transparent: true });
  });
}

export function mix(a: string, b: string, t: number) {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}
