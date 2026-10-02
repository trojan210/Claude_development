// Particles: marine snow (suspended plankton/detritus), exhaled bubble streams that
// expand as they rise (Boyle's law), and silt clouds kicked up by careless fin strokes.
import * as THREE from 'three';
import { U, UW_COMMON } from './water.js';
import { makeSpriteTexture } from './textures.js';

export class MarineSnow {
  constructor(count = 4000, box = 26) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * box; pos[i * 3 + 1] = Math.random() * box; pos[i * 3 + 2] = Math.random() * box;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...U, uBox: { value: box }, uCam: { value: new THREE.Vector3() }, uPx: { value: 1 }, uDensity: { value: 1 } },
      vertexShader: /* glsl */ `
        #define UW_NO_CAUSTICS
        ${UW_COMMON}
        uniform float uBox; uniform vec3 uCam; uniform float uPx; uniform float uDensity;
        uniform vec2 uCurrent;
        attribute float aSeed;
        varying float vA; varying vec3 vCol;
        void main() {
          vec3 drift = vec3(uCurrent.x, -0.012 - aSeed * 0.01, uCurrent.y) * uTime;
          drift += vec3(sin(uTime * 0.3 + aSeed * 40.0), sin(uTime * 0.23 + aSeed * 17.0), cos(uTime * 0.27 + aSeed * 29.0)) * 0.12;
          vec3 p = mod(position + drift - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          gl_Position = projectionMatrix * mv;
          float sz = (0.012 + aSeed * aSeed * 0.035);
          gl_PointSize = max(1.0, sz * uPx / max(d, 0.1));
          vec3 rel = p - uCam;
          float edge = 1.0 - smoothstep(uBox * 0.3, uBox * 0.5, length(rel));
          vA = edge * smoothstep(0.15, 0.8, d) * step(aSeed, uDensity) * step(p.y, -0.2);
          // lit by ambient sunlight at its depth and by the torch
          vec3 light = (uSkyColor * 0.35 + uSunColor * 0.12) * uwDiffTrans(p.y);
          if (uTorchOn > 0.5) {
            vec3 tv = p - uTorchPos; float tl = length(tv);
            float cone = smoothstep(0.88, 0.975, dot(tv / tl, uTorchDir));
            light += uTorchColor * uTorchPower * cone * exp(-(uAbs + uScat) * tl) / (tl * tl + 0.3) * 0.35;
          }
          vCol = light * mix(vec3(0.9, 0.95, 1.0), vec3(1.0, 0.95, 0.8), aSeed);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying vec3 vCol;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(c)) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vCol * a, a * 0.8);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  update(camera, pxScale) {
    this.material.uniforms.uCam.value.copy(camera.position);
    this.material.uniforms.uPx.value = pxScale;
  }
}

const BUBBLE_VS = /* glsl */ `
  attribute vec4 aB; // xyz pos, w radius (m)
  attribute float aLife;
  uniform float uPx;
  varying float vLife;
  void main() {
    vec4 mv = viewMatrix * vec4(aB.xyz, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aB.w * 2.0 * uPx / max(-mv.z, 0.05);
    vLife = aLife;
  }`;
const BUBBLE_FS = /* glsl */ `
  ${UW_COMMON}
  varying float vLife;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    c.y = -c.y;
    float r = length(c);
    if (r > 1.0 || vLife <= 0.0) discard;
    // bubbles look silvery: total internal reflection at the rim, transparent core
    float rim = smoothstep(0.55, 0.98, r) * smoothstep(1.0, 0.93, r);
    float hl = smoothstep(0.32, 0.0, length(c - vec2(-0.3, 0.38)));
    vec3 env = uSkyColor * 1.4 + uSunColor * 0.2;
    vec3 col = env * (rim * 0.9 + hl * 1.6);
    float a = clamp(rim * 0.85 + hl + 0.06, 0.0, 1.0) * min(vLife * 3.0, 1.0);
    gl_FragColor = vec4(col, a);
  }`;

export class Bubbles {
  constructor(max = 600) {
    this.max = max;
    this.b = new Float32Array(max * 4);
    this.life = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.seed = new Float32Array(max);
    this.r0 = new Float32Array(max);
    this.p0 = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.bAttr = new THREE.BufferAttribute(this.b, 4).setUsage(THREE.DynamicDrawUsage);
    this.lAttr = new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aB', this.bAttr);
    geo.setAttribute('aLife', this.lAttr);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...U, uPx: { value: 1 } },
      vertexShader: BUBBLE_VS,
      fragmentShader: BUBBLE_FS,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.next = 0;
  }

  emit(origin, n, spread = 0.05, big = 0.0) {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const r = 0.002 + Math.pow(Math.random(), 3) * 0.012 + (Math.random() < big ? 0.02 : 0);
      this.b[i * 4] = origin.x + (Math.random() - 0.5) * spread;
      this.b[i * 4 + 1] = origin.y + (Math.random() - 0.5) * spread;
      this.b[i * 4 + 2] = origin.z + (Math.random() - 0.5) * spread;
      this.b[i * 4 + 3] = r;
      this.r0[i] = r;
      this.p0[i] = 1 + Math.max(0, -origin.y) / 10;
      this.life[i] = 1;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.25;
      this.vel[i * 3 + 1] = 0.1 + Math.random() * 0.2;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.25;
      this.seed[i] = Math.random() * 100;
    }
  }

  update(dt, t, pxScale) {
    const { b, vel, life } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      const y = b[i * 4 + 1];
      // radius grows as ambient pressure drops; terminal velocity grows with size
      const p = 1 + Math.max(0, -y) / 10;
      const r = this.r0[i] * Math.cbrt(this.p0[i] / p);
      b[i * 4 + 3] = r;
      const vt = Math.min(0.35, 0.12 + r * 18);
      vel[i * 3 + 1] += (vt - vel[i * 3 + 1]) * Math.min(1, dt * 3);
      vel[i * 3] *= 1 - Math.min(1, dt * 2); vel[i * 3 + 2] *= 1 - Math.min(1, dt * 2);
      const s = this.seed[i];
      const wob = Math.min(1, r * 120);
      b[i * 4] += (vel[i * 3] + Math.sin(t * 9 + s) * 0.06 * wob) * dt;
      b[i * 4 + 1] += vel[i * 3 + 1] * dt;
      b[i * 4 + 2] += (vel[i * 3 + 2] + Math.cos(t * 7 + s) * 0.06 * wob) * dt;
      if (b[i * 4 + 1] > -0.05) life[i] -= dt * 4; else life[i] -= dt * 0.012;
    }
    this.bAttr.needsUpdate = true;
    this.lAttr.needsUpdate = true;
    this.material.uniforms.uPx.value = pxScale;
  }
}

export class Silt {
  constructor(max = 260) {
    this.max = max;
    this.p = new Float32Array(max * 4);
    this.life = new Float32Array(max);
    this.v = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    this.pAttr = new THREE.BufferAttribute(this.p, 4).setUsage(THREE.DynamicDrawUsage);
    this.lAttr = new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aB', this.pAttr);
    geo.setAttribute('aLife', this.lAttr);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...U, uPx: { value: 1 }, uMap: { value: makeSpriteTexture() }, uSiltColor: { value: new THREE.Color(0.25, 0.24, 0.22) } },
      vertexShader: BUBBLE_VS.replace('varying float vLife;', 'varying float vLife; varying float vY;').replace('vLife = aLife;', 'vLife = aLife; vY = aB.y;'),
      fragmentShader: /* glsl */ `
        ${UW_COMMON}
        uniform sampler2D uMap; uniform vec3 uSiltColor;
        varying float vLife; varying float vY;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * texture2D(uMap, gl_PointCoord).r;
          a *= smoothstep(0.0, 0.3, vLife) * 0.35;
          if (a < 0.003) discard;
          vec3 light = (uSkyColor * 0.6 + uSunColor * 0.2) * uwDiffTrans(vY);
          gl_FragColor = vec4(uSiltColor * light, a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.next = 0;
  }

  setColor(c) { this.material.uniforms.uSiltColor.value.set(c); }

  emit(pos, n, strength) {
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      this.p[i * 4] = pos.x + (Math.random() - 0.5) * 0.8;
      this.p[i * 4 + 1] = pos.y + Math.random() * 0.2;
      this.p[i * 4 + 2] = pos.z + (Math.random() - 0.5) * 0.8;
      this.p[i * 4 + 3] = 0.2 + Math.random() * 0.3;
      this.v[i * 3] = (Math.random() - 0.5) * strength;
      this.v[i * 3 + 1] = Math.random() * strength * 0.6;
      this.v[i * 3 + 2] = (Math.random() - 0.5) * strength;
      this.life[i] = 1;
    }
  }

  update(dt, pxScale) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * 0.06;
      this.p[i * 4] += this.v[i * 3] * dt; this.p[i * 4 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 4 + 2] += this.v[i * 3 + 2] * dt;
      this.v[i * 3] *= 1 - dt * 0.8; this.v[i * 3 + 1] = this.v[i * 3 + 1] * (1 - dt * 0.8) - dt * 0.004; this.v[i * 3 + 2] *= 1 - dt * 0.8;
      this.p[i * 4 + 3] += dt * 0.12; // cloud expands
    }
    this.pAttr.needsUpdate = true;
    this.lAttr.needsUpdate = true;
    this.material.uniforms.uPx.value = pxScale;
  }
}
