// Animated, tileable caustic pattern rendered to a texture every frame.
// The same texture drives surface caustics, light shafts and the shimmer on the sand.
import * as THREE from 'three';
import { U } from './water.js';

export class Caustics {
  constructor(renderer, size = 512) {
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
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform float uTime;
        #define TAU 6.28318530718
        float layer(vec2 uv, float t, float inten) {
          vec2 p = mod(uv * TAU, TAU) - 250.0;
          vec2 i = p;
          float c = 1.0;
          for (int n = 0; n < 5; n++) {
            float tt = t * (1.0 - (3.5 / float(n + 1)));
            i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
            c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
          }
          c /= 5.0;
          c = 1.17 - pow(c, 1.4);
          return pow(abs(c), 7.0);
        }
        void main() {
          float t = uTime * 0.42 + 23.0;
          float a = layer(vUv, t, 0.005);
          float b = layer(fract(vUv * 2.0 + vec2(0.37, 0.11)), t * 1.31 + 7.0, 0.0065);
          float c = a * 0.72 + b * 0.38;
          gl_FragColor = vec4(vec3(clamp(c, 0.0, 3.5)), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.scene = new THREE.Scene();
    this.cam = new THREE.Camera();
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
    U.uCaustic.value = this.rt.texture;
  }

  update() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
  }
}
