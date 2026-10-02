// Sea surface seen from below: Gerstner swell, refraction through Snell's window,
// total internal reflection outside it, sun glitter and drifting clouds.
import * as THREE from 'three';
import { U, UW_COMMON } from './water.js';

const WAVES = [
  // dirX, dirZ, wavelength, amplitude, speedMul
  [1.0, 0.25, 34, 0.32, 1.0],
  [0.6, 0.8, 19, 0.18, 1.0],
  [-0.3, 1.0, 11, 0.09, 1.0],
  [0.9, -0.45, 7.5, 0.05, 1.0],
  [-0.8, 0.5, 4.2, 0.025, 1.0],
];

export function waveHeight(x, z, t) {
  let h = 0;
  for (const [dx, dz, L, A] of WAVES) {
    const l = Math.hypot(dx, dz);
    const k = (Math.PI * 2) / L;
    const c = Math.sqrt(9.81 / k);
    h += A * Math.sin(k * ((dx / l) * x + (dz / l) * z) - k * c * t);
  }
  return h;
}

export class Surface {
  constructor(quality) {
    const seg = quality.surfaceSeg;
    this.seg = seg;
    const geo = new THREE.PlaneGeometry(700, 700, seg, seg);
    geo.rotateX(Math.PI / 2); // face down
    const waveDefs = WAVES.map(([dx, dz, L, A]) => {
      const l = Math.hypot(dx, dz);
      const k = (Math.PI * 2) / L;
      return new THREE.Vector4(dx / l, dz / l, k, A);
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...pick(U, ['uTime', 'uSunDirW', 'uSunColor', 'uSkyColor', 'uKd', 'uAbs', 'uScat', 'uCaustic',
          'uCausticScale', 'uCausticStrength', 'uTorchOn', 'uTorchPos', 'uTorchDir', 'uTorchColor', 'uTorchPower', 'uSunDirAir']),
        uWaves: { value: waveDefs },
        uOffset: { value: new THREE.Vector2() },
        uCWaves: { value: [] },
        uCTile: { value: 7 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec4 uWaves[5];
        uniform vec2 uOffset;
        varying vec3 vWorld;
        varying vec3 vN;
        void main() {
          vec3 p = position + vec3(uOffset.x, 0.0, uOffset.y);
          float h = 0.0; vec2 grad = vec2(0.0);
          for (int i = 0; i < 5; i++) {
            vec4 w = uWaves[i];
            float c = sqrt(9.81 / w.z);
            float ph = w.z * dot(w.xy, p.xz) - w.z * c * uTime;
            h += w.w * sin(ph);
            grad += w.w * w.z * cos(ph) * w.xy;
          }
          p.y = h;
          vN = normalize(vec3(-grad.x, 1.0, -grad.y));
          vWorld = p;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${UW_COMMON}
        uniform vec3 uSunDirAir;
        uniform vec4 uCWaves[14];
        uniform float uCTile;
        varying vec3 vWorld;
        varying vec3 vN;
        float sHash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float sNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(sHash(i),sHash(i+vec2(1,0)),f.x), mix(sHash(i+vec2(0,1)),sHash(i+vec2(1,1)),f.x), f.y); }
        float clouds(vec2 p) {
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { s += a * sNoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
          return smoothstep(0.48, 0.85, s);
        }
        vec3 skyColor(vec3 d) {
          float up = clamp(d.y, 0.0, 1.0);
          // sky radiance (irradiance / pi scale)
          vec3 zen = vec3(0.1, 0.24, 0.6);
          vec3 hor = vec3(0.42, 0.52, 0.62);
          vec3 c = mix(hor, zen, pow(up, 0.6)) * 0.55;
          vec2 cp = d.xz / max(d.y, 0.08) * 0.6 + uTime * 0.004;
          float cl = clouds(cp);
          c = mix(c, vec3(0.75), cl * 0.75 * smoothstep(0.02, 0.25, d.y));
          float sd = max(dot(d, uSunDirAir), 0.0);
          c += uSunColor * (pow(sd, 1600.0) * 160.0 + pow(sd, 64.0) * 0.9 + pow(sd, 6.0) * 0.06);
          return c;
        }
        float hgPhase(float cosT, float g) {
          float g2 = g * g;
          return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * cosT, 1.5));
        }
        void main() {
          vec3 I = normalize(vWorld - cameraPosition);
          // small-scale waves: exactly the field that focuses the caustics below
          vec2 grad = vec2(0.0);
          for (int i = 0; i < 14; i++) {
            vec4 w = uCWaves[i];
            float ph = dot(w.xy, vWorld.xz) - w.w * uTime * 0.85 + float(i) * 1.7;
            grad += w.z * w.xy * cos(ph);
          }
          vec3 detail = vec3(-grad.x, 0.0, -grad.y) * 0.9;
          float dist = length(vWorld - cameraPosition);
          detail *= exp(-dist * 0.02);
          vec3 nUp = normalize(vN + detail);
          vec3 nDown = -nUp;
          vec3 T = refract(I, nDown, 1.333);
          vec3 R = reflect(I, nDown);
          // radiance of the water body seen in the reflection (looking down)
          vec3 c = uAbs + uScat;
          float dy = R.y;
          vec3 sunIn = uSunColor * hgPhase(dot(R, uSunDirW), 0.75) + uSkyColor * 0.09;
          vec3 deep = sunIn * uScat / max(c - uKd * dy, vec3(0.01));
          vec3 col;
          if (dot(T, T) < 0.001) {
            col = deep; // total internal reflection
          } else {
            float cosI = abs(dot(I, nDown));
            // Fresnel from the water side, rises sharply toward the critical angle (48.6 deg)
            float cosCrit = 0.6615;
            float x = clamp((cosI - cosCrit) / (1.0 - cosCrit), 0.0, 1.0);
            float F = 0.02 + 0.98 * pow(1.0 - x, 5.0);
            col = mix(skyColor(T), deep, F);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  update(camera) {
    // follow the camera on a snapped grid to avoid swimming vertices
    const step = 700 / this.seg;
    this.material.uniforms.uOffset.value.set(
      Math.round(camera.position.x / step) * step,
      Math.round(camera.position.z / step) * step,
    );
  }
}

function pick(obj, keys) {
  const o = {};
  for (const k of keys) o[k] = obj[k];
  return o;
}
