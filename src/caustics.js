// Physically based caustics. A fine grid representing one tile of the sea surface is
// displaced by a periodic wave field; each vertex's light ray is refracted (Snell) and
// carried down to a focal depth. The fragment shader compares the area of each grid
// cell before and after refraction (dFdx/dFdy): where rays converge the light is
// concentrated, which produces the sharp, dancing light network seen on the reef.
// The result is tileable and has a mean of ~1.
import * as THREE from 'three';
import { U } from './water.js';

// integer wave vectors keep the field periodic over the tile
const WAVES = [
  // kx, kz (cycles per tile), amplitude (m). Spectrum falls off ~k^-1.3 like short wind waves.
  [1, 0, 0.06], [0, 1, 0.05], [1, 1, 0.035], [2, -1, 0.028], [-1, 2, 0.026],
  [3, 1, 0.02], [1, -3, 0.019], [4, 2, 0.014], [-3, 4, 0.012], [5, -2, 0.011],
  [2, 6, 0.008], [-6, 3, 0.0075], [7, 4, 0.006], [-4, -8, 0.005],
];

export class Caustics {
  constructor(renderer, size = 512, grid = 160) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
    });
    this.rt.texture.wrapS = this.rt.texture.wrapT = THREE.RepeatWrapping;

    const tile = U.uCausticScale.value;
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1, grid, grid);
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    // 3x3 copies so rays that leave the tile wrap around seamlessly
    const offs = [];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) offs.push(i, j);
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(offs), 2));
    geo.instanceCount = 9;

    const waveVecs = WAVES.map(([kx, kz, a]) => {
      const k = new THREE.Vector2(kx, kz).multiplyScalar((Math.PI * 2) / tile);
      const w = Math.sqrt(9.81 * k.length());
      return new THREE.Vector4(k.x, k.y, a, w);
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: U.uTime,
        uTile: { value: tile },
        uFocal: { value: 6.5 },
        uWaves: { value: waveVecs },
      },
      vertexShader: /* glsl */ `
        uniform float uTime, uTile, uFocal;
        uniform vec4 uWaves[${WAVES.length}];
        attribute vec2 aOff;
        varying vec2 vOld;
        varying vec2 vNew;
        void main() {
          vec2 p = (position.xy + 0.5) * uTile;  // metres within the tile
          vec2 grad = vec2(0.0);
          for (int i = 0; i < ${WAVES.length}; i++) {
            vec4 w = uWaves[i];
            float ph = dot(w.xy, p) - w.w * uTime * 0.85 + float(i) * 1.7;
            grad += w.z * w.xy * cos(ph);
          }
          vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));
          vec3 r = refract(vec3(0.0, -1.0, 0.0), n, 1.0 / 1.333);
          vec2 q = p + r.xz / max(-r.y, 0.2) * uFocal;
          vOld = p;
          vNew = q;
          vec2 uv = q / uTile + aOff;
          gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vOld;
        varying vec2 vNew;
        void main() {
          float oldA = abs(dFdx(vOld).x * dFdy(vOld).y - dFdx(vOld).y * dFdy(vOld).x);
          float newA = abs(dFdx(vNew).x * dFdy(vNew).y - dFdx(vNew).y * dFdy(vNew).x);
          float I = oldA / max(newA, oldA * 0.02);
          gl_FragColor = vec4(vec3(I), 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // the grid maps 1:1 to the target, so each texel receives ~one cell's energy
    this.scene = new THREE.Scene();
    this.cam = new THREE.Camera();
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.gridToTexel = (size / grid) ** 2;
    U.uCaustic.value = this.rt.texture;
  }

  update() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
    r.setClearColor(prevClear, prevAlpha);
  }
}
