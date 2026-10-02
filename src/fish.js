// Reef fish: procedural bodies, per-species colour patterns, tail-beat animation in the
// vertex shader and several behaviours (boids schools, coral-head swarms, wanderers).
import * as THREE from 'three';
import { patchUW, U } from './water.js';
import { mulberry32, Simplex } from './noise.js';

// ---------------------------------------------------------------- species
export const SPECIES = {
  jack: { id: 0, name: 'ギンガメアジ', sci: 'Caranx sexfasciatus', len: 0.62, H: 0.30, W: 0.12, tail: 'fork', dorsal: 0.12, metal: 0.8, rough: 0.28, beat: 2.2 },
  anthias: { id: 1, name: 'キンギョハナダイ', sci: 'Pseudanthias squamipinnis', len: 0.09, H: 0.34, W: 0.12, tail: 'lyre', dorsal: 0.2, metal: 0.1, rough: 0.45, beat: 7.0 },
  fusilier: { id: 2, name: 'ササムロ', sci: 'Caesio teres', len: 0.3, H: 0.25, W: 0.1, tail: 'fork', dorsal: 0.08, metal: 0.25, rough: 0.35, beat: 3.6 },
  butterfly: { id: 3, name: 'トゲチョウチョウウオ', sci: 'Chaetodon auriga', len: 0.17, H: 0.66, W: 0.08, tail: 'round', dorsal: 0.3, metal: 0.05, rough: 0.5, beat: 3.0 },
  parrot: { id: 4, name: 'カンムリブダイ', sci: 'Bolbometopon muricatum', len: 1.15, H: 0.4, W: 0.2, tail: 'trunc', dorsal: 0.08, metal: 0.05, rough: 0.6, beat: 1.3 },
  surgeon: { id: 5, name: 'ニジハギ', sci: 'Acanthurus lineatus', len: 0.3, H: 0.5, W: 0.09, tail: 'lyre', dorsal: 0.16, metal: 0.1, rough: 0.4, beat: 2.8 },
  clown: { id: 6, name: 'カクレクマノミ', sci: 'Amphiprion ocellaris', len: 0.085, H: 0.4, W: 0.16, tail: 'round', dorsal: 0.18, metal: 0.05, rough: 0.4, beat: 6.5 },
};

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/** Unit-length fish (z: -0.5 tail .. +0.5 head). Attribute aBody = (t along body, rel height, fin id). */
function fishGeometry(sp) {
  // small fish are only ever a few pixels tall: fewer rings
  const nu = sp.len < 0.15 ? 10 : sp.len < 0.5 ? 14 : 18;
  const nv = sp.len < 0.15 ? 6 : sp.len < 0.5 ? 9 : 12;
  const pos = [], body = [], idx = [];
  const prof = (t) => {
    const e = smooth(0.0, 0.42, t) * (1 - Math.pow(smooth(0.5, 1.0, t), 2.4) * 0.88);
    return 0.09 + 0.91 * e;
  };
  for (let i = 0; i <= nu; i++) {
    const t = i / nu; // 0 tail .. 1 head
    const z = t - 0.5;
    let h = sp.H * 0.5 * prof(t);
    const w = sp.W * 0.5 * prof(t);
    let yOff = 0;
    if (sp.id === 4) { // bumphead
      h *= 1 + smooth(0.75, 0.95, t) * 0.25;
      yOff = smooth(0.8, 1.0, t) * 0.03;
    }
    if (sp.id === 3) yOff = -smooth(0.85, 1.0, t) * 0.08; // pointed snout of butterflyfish
    for (let j = 0; j <= nv; j++) {
      const th = (j / nv) * Math.PI * 2;
      const s = Math.sin(th), c = Math.cos(th);
      // slightly flattened belly, keeled back
      const yy = s > 0 ? s : s * 0.92;
      pos.push(c * w, yy * h + yOff, z);
      body.push(t, s, 0);
    }
  }
  const w1 = nv + 1;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * w1 + j, b = (i + 1) * w1 + j, c = (i + 1) * w1 + j + 1, d = i * w1 + j + 1;
      idx.push(a, d, b, b, d, c);
    }
  }
  // fins as flat fans (double sided material)
  const addTri = (p1, p2, p3, b1, b2, b3) => {
    const base = pos.length / 3;
    pos.push(...p1, ...p2, ...p3);
    body.push(...b1, ...b2, ...b3);
    idx.push(base, base + 1, base + 2);
  };
  const tailH = sp.H * (sp.tail === 'fork' ? 0.85 : 0.6);
  const tl = sp.tail === 'trunc' ? 0.16 : 0.2;
  const z0 = -0.5 + 0.02, z1 = -0.5 - tl;
  if (sp.tail === 'fork' || sp.tail === 'lyre') {
    const notch = sp.tail === 'fork' ? 0.55 : 0.75;
    addTri([0, 0.015, z0], [0, tailH * 0.5, z1 - (sp.tail === 'lyre' ? 0.06 : 0)], [0, 0, z0 - tl * notch], [0, 0.2, 1], [0, 1, 1], [0, 0, 1]);
    addTri([0, -0.015, z0], [0, 0, z0 - tl * notch], [0, -tailH * 0.5, z1 - (sp.tail === 'lyre' ? 0.06 : 0)], [0, -0.2, 1], [0, 0, 1], [0, -1, 1]);
  } else {
    const n = 6;
    for (let k = 0; k < n; k++) {
      const a0 = -0.9 + (1.8 * k) / n, a1 = -0.9 + (1.8 * (k + 1)) / n;
      const r = tl;
      addTri([0, 0, z0], [0, Math.sin(a0) * tailH * 0.55, z0 - Math.cos(a0) * r], [0, Math.sin(a1) * tailH * 0.55, z0 - Math.cos(a1) * r], [0, 0, 1], [0, Math.sin(a0), 1], [0, Math.sin(a1), 1]);
    }
  }
  // dorsal fin
  const dh = sp.dorsal * (sp.id === 3 ? 0.35 : 1);
  const topAt = (t) => sp.H * 0.5 * prof(t);
  const d0 = 0.2, d1 = 0.72;
  const steps = 6;
  for (let k = 0; k < steps; k++) {
    const ta = d0 + ((d1 - d0) * k) / steps, tb = d0 + ((d1 - d0) * (k + 1)) / steps;
    const ha = topAt(ta), hb = topAt(tb);
    const fa = Math.sin((k / steps) * Math.PI * 0.9 + 0.3) * dh, fb = Math.sin(((k + 1) / steps) * Math.PI * 0.9 + 0.3) * dh;
    addTri([0, ha * 0.95, ta - 0.5], [0, hb + fb, tb - 0.5 - 0.03], [0, ha + fa, ta - 0.5 - 0.03], [ta, 1, 2], [tb, 1.6, 2], [ta, 1.6, 2]);
    addTri([0, ha * 0.95, ta - 0.5], [0, hb * 0.95, tb - 0.5], [0, hb + fb, tb - 0.5 - 0.03], [ta, 1, 2], [tb, 1, 2], [tb, 1.6, 2]);
  }
  // anal fin
  for (let k = 0; k < 3; k++) {
    const ta = 0.18 + 0.08 * k, tb = ta + 0.08;
    const ha = -topAt(ta) * 0.92, hb = -topAt(tb) * 0.92;
    addTri([0, ha, ta - 0.5], [0, ha - dh * 0.5, ta - 0.5 - 0.03], [0, hb, tb - 0.5], [ta, -1, 2], [ta, -1.6, 2], [tb, -1, 2]);
  }
  // pectoral fins
  for (const side of [-1, 1]) {
    const t = 0.7, x = side * sp.W * 0.5 * prof(t) * 0.9;
    addTri([x, -0.01, t - 0.5], [x + side * 0.05, -0.04, t - 0.5 - 0.12], [x + side * 0.02, -0.07, t - 0.5 - 0.08], [t, 0, 3], [t - 0.1, 0, 3], [t - 0.1, 0, 3]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBody', new THREE.Float32BufferAttribute(body, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const COLOR_GLSL = /* glsl */ `
  varying vec3 vBody;
  varying vec3 vObj;
  vec3 fishPattern(vec3 b, vec3 o, vec3 tint) {
    float t = b.x, rel = b.y, fin = b.z;
    float belly = smoothstep(0.1, -0.7, rel);
    float back = smoothstep(0.15, 0.85, rel);
    vec3 col;
    #if SPECIES == 0
      col = mix(vec3(0.78, 0.8, 0.82), vec3(0.18, 0.25, 0.3), back);
      col = mix(col, vec3(0.9), belly * 0.5);
      if (fin > 0.5) col = vec3(0.22, 0.26, 0.28);
      if (fin > 0.5 && fin < 1.5) col = mix(col, vec3(0.75, 0.62, 0.25), smoothstep(0.4, 1.0, abs(rel)) * 0.4);
      float spot = smoothstep(0.03, 0.015, length(vec2(t - 0.76, rel - 0.5) * vec2(1.0, 0.35)));
      col = mix(col, vec3(0.02), spot);
    #elif SPECIES == 1
      col = mix(vec3(0.98, 0.45, 0.18), vec3(1.0, 0.72, 0.4), belly * 0.6) * tint;
      float stripe = smoothstep(0.03, 0.0, abs(rel + 0.1 - (t - 0.85) * 1.2)) * smoothstep(0.7, 0.85, t);
      col = mix(col, vec3(0.75, 0.45, 0.9), stripe);
      if (fin > 0.5) col = mix(col, vec3(1.0, 0.75, 0.2), 0.5);
    #elif SPECIES == 2
      col = mix(vec3(0.2, 0.42, 0.85), vec3(0.85, 0.9, 1.0), belly);
      float yel = smoothstep(0.35, 0.55, rel) * smoothstep(0.85, 0.2, t);
      col = mix(col, vec3(1.0, 0.82, 0.12), yel);
      if (fin > 0.5 && fin < 1.5) col = vec3(1.0, 0.82, 0.12);
    #elif SPECIES == 3
      col = mix(vec3(0.95, 0.95, 0.92), vec3(1.0, 0.85, 0.1), smoothstep(0.55, 0.25, t));
      float chevron = step(0.5, fract((t * 6.0 + rel * 2.5)));
      col *= mix(1.0, 0.82, chevron * smoothstep(0.75, 0.4, t) * step(-0.2, rel));
      float band = smoothstep(0.03, 0.0, abs(t - 0.86 + rel * 0.05));
      col = mix(col, vec3(0.03), band);
      if (fin > 1.5 && fin < 2.5) col = mix(vec3(1.0, 0.85, 0.1), vec3(0.03), smoothstep(0.25, 0.2, t));
      if (fin > 0.5 && fin < 1.5) col = vec3(1.0, 0.8, 0.15);
    #elif SPECIES == 4
      col = mix(vec3(0.33, 0.45, 0.42), vec3(0.42, 0.55, 0.5), belly);
      col = mix(col, vec3(0.75, 0.75, 0.6), smoothstep(0.88, 0.98, t) * 0.7);
      if (fin > 0.5) col *= 0.8;
    #elif SPECIES == 5
      float l = fract(rel * 4.5 + t * 0.4);
      col = mix(vec3(1.0, 0.82, 0.1), vec3(0.1, 0.35, 0.85), step(0.5, l));
      col = mix(col, vec3(0.03), smoothstep(0.06, 0.0, abs(l - 0.5)) + smoothstep(0.94, 1.0, l));
      col = mix(col, vec3(0.75, 0.75, 0.85), belly);
      if (fin > 0.5) col = vec3(0.12, 0.2, 0.45);
    #else
      col = vec3(1.0, 0.38, 0.05);
      float b1 = smoothstep(0.05, 0.03, abs(t - 0.82)) ;
      float b2 = smoothstep(0.07, 0.05, abs(t - 0.52 + rel * 0.06));
      float b3 = smoothstep(0.03, 0.02, abs(t - 0.13));
      float bands = max(b1, max(b2, b3));
      float edge = max(smoothstep(0.065, 0.045, abs(t - 0.82)), max(smoothstep(0.085, 0.065, abs(t - 0.52 + rel * 0.06)), smoothstep(0.045, 0.03, abs(t - 0.13))));
      col = mix(col, vec3(0.02), (edge - bands) * 0.9);
      col = mix(col, vec3(1.0), bands);
      if (fin > 0.5) col = mix(col, vec3(0.02), smoothstep(0.7, 1.0, abs(rel)) + (fin > 1.5 ? smoothstep(1.3, 1.6, abs(rel)) : 0.0));
    #endif
    // eye
    if (fin < 0.5) {
      float ed = length(vec2(t - 0.88, rel - 0.25) * vec2(1.0, 0.45));
      col = mix(col, vec3(0.75, 0.7, 0.4), smoothstep(0.03, 0.022, ed));
      col = mix(col, vec3(0.01), smoothstep(0.019, 0.013, ed));
    }
    return col;
  }
`;

function fishMaterial(sp, envMap) {
  const m = new THREE.MeshStandardMaterial({
    roughness: sp.rough,
    metalness: sp.metal,
    side: THREE.DoubleSide,
    envMap,
    envMapIntensity: 0.6,
  });
  m.defines = { SPECIES: sp.id };
  patchUW(m, {
    key: 'fish' + sp.id,
    ambient: 1.15,
    vertex: {
      pars: `attribute vec3 aBody; attribute vec3 aAnim; varying vec3 vBody; varying vec3 vObj;`,
      begin: `
        vBody = aBody; vObj = position;
        // travelling body wave, amplitude grows toward the tail (carangiform)
        float s = clamp(0.5 - position.z, 0.0, 1.3);
        float amp = 0.085 * s * s + 0.01;
        float wave = sin(aAnim.x - position.z * 7.0);
        transformed.x += wave * amp * aAnim.z + aAnim.y * position.z * position.z;
        if (aBody.z > 2.5) transformed.y += sin(aAnim.x * 1.3) * 0.02 * sign(position.x);
      `,
    },
    fragPars: COLOR_GLSL,
    fragColor: `
      vec3 fishTint = vec3(1.0);
      #ifdef USE_INSTANCING_COLOR
        fishTint = vColor;
      #endif
      diffuseColor.rgb = fishPattern(vBody, vObj, fishTint);
    `,
  });
  return m;
}

// ---------------------------------------------------------------- base instanced group
class FishSet {
  constructor(sp, count, envMap, rand) {
    this.sp = sp;
    this.count = count;
    const geo = fishGeometry(sp);
    this.anim = new Float32Array(count * 3);
    const animAttr = new THREE.InstancedBufferAttribute(this.anim, 3);
    animAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAnim', animAttr);
    this.animAttr = animAttr;
    this.mesh = new THREE.InstancedMesh(geo, fishMaterial(sp, envMap), count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = sp.len > 0.25;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.phase = new Float32Array(count);
    this.quat = [];
    for (let i = 0; i < count; i++) {
      this.size[i] = sp.len * (0.82 + rand() * 0.36);
      this.phase[i] = rand() * 100;
      this.quat.push(new THREE.Quaternion());
      this.anim[i * 3 + 2] = 1;
    }
    this.rand = rand;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._look = new THREE.Matrix4();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  // orient each fish along its velocity, bank into turns and push to GPU
  writeInstances(dt) {
    const { pos, vel, size } = this;
    for (let i = 0; i < this.count; i++) {
      const vx = vel[i * 3], vy = vel[i * 3 + 1], vz = vel[i * 3 + 2];
      const sp = Math.hypot(vx, vy, vz) + 1e-5;
      this._v.set(vx / sp, Math.max(-0.7, Math.min(0.7, vy / sp)), vz / sp).normalize();
      this._look.lookAt(this._v, this._p.set(0, 0, 0), this._up);
      this._q.setFromRotationMatrix(this._look);
      // slerp toward target heading (fish can't snap)
      const q = this.quat[i];
      const prevYaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
      q.slerp(this._q, Math.min(1, dt * 5));
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
      let dyaw = yaw - prevYaw;
      if (dyaw > Math.PI) dyaw -= Math.PI * 2; else if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const turn = dyaw / Math.max(dt, 1e-3);
      // tail beat: frequency rises with speed relative to body length
      const L = size[i];
      const freq = this.sp.beat * (0.6 + Math.min(3, sp / (L * 1.6)));
      this.phase[i] += dt * freq * Math.PI * 2;
      this.anim[i * 3] = this.phase[i];
      this.anim[i * 3 + 1] = Math.max(-0.4, Math.min(0.4, -turn * 0.08));
      this.anim[i * 3 + 2] = 0.6 + Math.min(1.4, sp / (L * 2.0));
      this._p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      this._s.setScalar(L);
      this._m.compose(this._p, q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.animAttr.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- boids school
class School extends FishSet {
  constructor(sp, count, envMap, rand, opts) {
    super(sp, count, envMap, rand);
    this.o = Object.assign({
      home: new THREE.Vector3(), homeR: 12, speed: 0.8, maxSpeed: 2.5, nr: 1.6, sep: 0.7,
      mill: 0, minAlt: 2, fleeR: 3.5, followDiver: false,
    }, opts);
    const h = this.o.home;
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * this.o.homeR * 0.5;
      this.pos[i * 3] = h.x + Math.cos(a) * r;
      this.pos[i * 3 + 1] = h.y + (rand() - 0.5) * 4;
      this.pos[i * 3 + 2] = h.z + Math.sin(a) * r;
      this.vel[i * 3] = -Math.sin(a) * this.o.speed;
      this.vel[i * 3 + 2] = Math.cos(a) * this.o.speed;
    }
    this.grid = new Map();
    this.noise = new Simplex(Math.floor(rand() * 1e6));
    this.time = rand() * 100;
  }

  update(dt, ctx) {
    const { pos, vel, count, o } = this;
    this.time += dt;
    const cell = o.nr;
    const grid = this.grid;
    grid.clear();
    for (let i = 0; i < count; i++) {
      const k = `${Math.floor(pos[i * 3] / cell)},${Math.floor(pos[i * 3 + 1] / cell)},${Math.floor(pos[i * 3 + 2] / cell)}`;
      let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(i);
    }
    const home = o.home;
    // the school's centre of attention drifts
    const tx = home.x + this.noise.noise2(this.time * 0.03, 0) * o.homeR * 0.5;
    const ty = home.y + this.noise.noise2(this.time * 0.04, 10) * 2.5;
    const tz = home.z + this.noise.noise2(0, this.time * 0.03) * o.homeR * 0.5;
    const dpx = ctx.diver.x, dpy = ctx.diver.y, dpz = ctx.diver.z;
    const diverSpeed = ctx.diverSpeed;
    for (let i = 0; i < count; i++) {
      const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      let vx = vel[i * 3], vy = vel[i * 3 + 1], vz = vel[i * 3 + 2];
      let sx = 0, sy = 0, sz = 0, ax = 0, ay = 0, az = 0, cx = 0, cy = 0, cz = 0, n = 0;
      const gx = Math.floor(px / cell), gy = Math.floor(py / cell), gz = Math.floor(pz / cell);
      for (let ix = -1; ix <= 1; ix++) for (let iy = -1; iy <= 1; iy++) for (let iz = -1; iz <= 1; iz++) {
        const a = grid.get(`${gx + ix},${gy + iy},${gz + iz}`);
        if (!a) continue;
        for (const j of a) {
          if (j === i) continue;
          const dx = px - pos[j * 3], dy = py - pos[j * 3 + 1], dz = pz - pos[j * 3 + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > o.nr * o.nr) continue;
          n++;
          ax += vel[j * 3]; ay += vel[j * 3 + 1]; az += vel[j * 3 + 2];
          cx += pos[j * 3]; cy += pos[j * 3 + 1]; cz += pos[j * 3 + 2];
          if (d2 < o.sep * o.sep) { const f = 1 / (d2 + 0.01); sx += dx * f; sy += dy * f; sz += dz * f; }
        }
      }
      let fx = 0, fy = 0, fz = 0;
      if (n > 0) {
        fx += (ax / n - vx) * 1.2; fy += (ay / n - vy) * 1.2; fz += (az / n - vz) * 1.2;
        fx += (cx / n - px) * 0.6; fy += (cy / n - py) * 0.6; fz += (cz / n - pz) * 0.6;
        fx += sx * 0.35; fy += sy * 0.35; fz += sz * 0.35;
      }
      // home attraction (soft boundary)
      const hx = tx - px, hy = ty - py, hz = tz - pz;
      const hd = Math.hypot(hx, hz);
      const pull = Math.max(0, hd - o.homeR * 0.4) / o.homeR;
      fx += hx / (hd + 1e-3) * pull * 1.6; fz += hz / (hd + 1e-3) * pull * 1.6; fy += hy * 0.25;
      // milling: circulation around the school's axis (jack tornado)
      if (o.mill) { fx += (-hz / (hd + 1)) * o.mill; fz += (hx / (hd + 1)) * o.mill; }
      // seabed / surface
      const ground = ctx.terrain.heightAt(px, pz);
      if (py < ground + o.minAlt) fy += (ground + o.minAlt - py) * 2.5;
      if (py > -1.0) fy -= (py + 1.0) * 3;
      // obstacles (coral heads / wreck spheres)
      for (const c of ctx.obstacles) {
        const dx = px - c.c.x, dy = py - c.c.y, dz = pz - c.c.z;
        const d2 = dx * dx + dy * dy + dz * dz, rr = c.r + 1.0;
        if (d2 < rr * rr) { const d = Math.sqrt(d2) + 1e-3; const f = (rr - d) * 3 / d; fx += dx * f; fy += dy * f; fz += dz * f; }
      }
      // diver avoidance: a flash of escape, stronger if the diver is fast
      const ddx = px - dpx, ddy = py - dpy, ddz = pz - dpz;
      const dd = Math.hypot(ddx, ddy, ddz);
      const fr = o.fleeR * (1 + diverSpeed * 0.8);
      if (dd < fr) { const f = ((fr - dd) / fr) * 9 / (dd + 0.1); fx += ddx * f; fy += ddy * f * 0.6; fz += ddz * f; }
      vx += fx * dt; vy += fy * dt; vz += fz * dt;
      let sp = Math.hypot(vx, vy, vz);
      const minS = o.speed * 0.6, maxS = o.maxSpeed;
      if (sp < minS) { const k = minS / (sp + 1e-4); vx *= k; vy *= k; vz *= k; sp = minS; }
      if (sp > maxS) { const k = maxS / sp; vx *= k; vy *= k; vz *= k; }
      // relax back toward cruise speed
      const relax = 1 + (o.speed / Math.max(sp, 1e-3) - 1) * Math.min(1, dt * 0.5);
      vx *= relax; vy *= relax * 0.98; vz *= relax;
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
      pos[i * 3] = px + vx * dt; pos[i * 3 + 1] = py + vy * dt; pos[i * 3 + 2] = pz + vz * dt;
    }
    if (o.followDiver) {
      // pelagic schools patrol around the diver's area
      home.lerp(this._p.set(dpx + 12, Math.min(dpy, -4), dpz + 10), Math.min(1, dt * 0.02));
    }
    this.writeInstances(dt);
  }
}

// ---------------------------------------------------------------- swarms hovering over coral heads
class Swarms extends FishSet {
  constructor(sp, perSwarm, swarms, envMap, rand, anchors, opts = {}) {
    super(sp, perSwarm * swarms, envMap, rand);
    this.per = perSwarm;
    this.anchors = anchors;
    this.o = Object.assign({ radius: 1.2, height: 1.0, speed: 0.25, flee: 1.5 }, opts);
    this.centers = [];
    this.off = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      this.off[i * 4] = rand() * Math.PI * 2;
      this.off[i * 4 + 1] = 0.3 + rand() * 0.7;
      this.off[i * 4 + 2] = rand();
      this.off[i * 4 + 3] = 0.5 + rand();
    }
    for (let s = 0; s < swarms; s++) this.centers.push(null);
    this.t = 0;
    this.reassignTimer = 0;
    this.scatter = new Float32Array(this.count * 3);
  }

  assign(diver) {
    // keep swarms on the coral heads nearest to the diver
    const near = this.anchors
      .map((a) => ({ a, d: (a.x - diver.x) ** 2 + (a.z - diver.z) ** 2 }))
      .filter((o) => o.d < 70 * 70)
      .sort((x, y) => x.d - y.d);
    const used = new Set(this.centers.filter(Boolean));
    for (let s = 0; s < this.centers.length; s++) {
      const c = this.centers[s];
      if (c && (c.x - diver.x) ** 2 + (c.z - diver.z) ** 2 < 75 * 75) continue;
      const cand = near.find((o) => !used.has(o.a));
      if (!cand) { this.centers[s] = null; continue; }
      this.centers[s] = cand.a;
      used.add(cand.a);
      for (let k = 0; k < this.per; k++) {
        const i = s * this.per + k;
        this.pos[i * 3] = cand.a.x; this.pos[i * 3 + 1] = cand.a.y + 0.5; this.pos[i * 3 + 2] = cand.a.z;
      }
    }
  }

  update(dt, ctx) {
    this.t += dt;
    this.reassignTimer -= dt;
    if (this.reassignTimer <= 0) { this.assign(ctx.diver); this.reassignTimer = 2; }
    const { pos, vel, off, o } = this;
    for (let s = 0; s < this.centers.length; s++) {
      const c = this.centers[s];
      for (let k = 0; k < this.per; k++) {
        const i = s * this.per + k;
        if (!c) { pos[i * 3 + 1] = -500; continue; }
        const a = off[i * 4] + this.t * o.speed * off[i * 4 + 3] * (k % 2 ? 1 : -1);
        const r = o.radius * off[i * 4 + 1];
        let tx = c.x + Math.cos(a) * r;
        let ty = c.y + 0.3 + off[i * 4 + 2] * o.height + Math.sin(this.t * 0.7 + i) * 0.15;
        let tz = c.z + Math.sin(a) * r;
        // dive into the coral when the diver approaches
        const dx = tx - ctx.diver.x, dy = ty - ctx.diver.y, dz = tz - ctx.diver.z;
        const dd = Math.hypot(dx, dy, dz);
        const hide = Math.max(0, 1 - (dd - 0.6) / o.flee);
        tx += (c.x - tx) * hide * 0.8; ty += (c.y - 0.2 - ty) * hide * 0.9; tz += (c.z - tz) * hide * 0.8;
        const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
        const k2 = Math.min(1, dt * (1.5 + hide * 4));
        const nx = px + (tx - px) * k2, ny = py + (ty - py) * k2, nz = pz + (tz - pz) * k2;
        // velocity follows the orbit tangent so the fish face where they swim
        let vx = (nx - px) / Math.max(dt, 1e-3), vy = (ny - py) / Math.max(dt, 1e-3), vz = (nz - pz) / Math.max(dt, 1e-3);
        const tang = 0.15;
        vx += -Math.sin(a) * tang * (k % 2 ? 1 : -1); vz += Math.cos(a) * tang * (k % 2 ? 1 : -1);
        vel[i * 3] = vel[i * 3] * 0.85 + vx * 0.15; vel[i * 3 + 1] = vel[i * 3 + 1] * 0.85 + vy * 0.15; vel[i * 3 + 2] = vel[i * 3 + 2] * 0.85 + vz * 0.15;
        pos[i * 3] = nx; pos[i * 3 + 1] = ny; pos[i * 3 + 2] = nz;
      }
    }
    this.writeInstances(dt);
  }
}

// ---------------------------------------------------------------- solitary / small-group reef wanderers
class Wanderers extends FishSet {
  constructor(sp, count, envMap, rand, opts) {
    super(sp, count, envMap, rand);
    this.o = Object.assign({ speed: 0.4, alt: [0.4, 2.5], range: 60, pair: false, flee: 2.5 }, opts);
    this.target = new Float32Array(count * 3);
    this.timer = new Float32Array(count);
    this.placed = false;
  }

  relocate(i, ctx, near) {
    const r = this.rand;
    const d = ctx.diver;
    let x, z;
    if (this.o.pair && i % 2 === 1) {
      x = this.pos[(i - 1) * 3] + 0.5; z = this.pos[(i - 1) * 3 + 2] + 0.3;
    } else {
      const a = r() * Math.PI * 2;
      const rad = near ? 6 + r() * 40 : 45 + r() * 20;
      x = d.x + Math.cos(a) * rad; z = d.z + Math.sin(a) * rad;
    }
    const g = ctx.terrain.heightAt(x, z);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = Math.min(g + this.o.alt[0] + r() * (this.o.alt[1] - this.o.alt[0]), -1.5); this.pos[i * 3 + 2] = z;
    this.timer[i] = 0;
  }

  update(dt, ctx) {
    const { pos, vel, target, timer, o, rand } = this;
    if (!this.placed) { for (let i = 0; i < this.count; i++) this.relocate(i, ctx, true); this.placed = true; }
    const d = ctx.diver;
    for (let i = 0; i < this.count; i++) {
      let px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      const dx0 = px - d.x, dz0 = pz - d.z;
      if (dx0 * dx0 + dz0 * dz0 > o.range * o.range * 1.4) { this.relocate(i, ctx, false); continue; }
      timer[i] -= dt;
      if (timer[i] <= 0) {
        if (o.pair && i % 2 === 1) {
          target[i * 3] = pos[(i - 1) * 3] + 0.4; target[i * 3 + 1] = pos[(i - 1) * 3 + 1]; target[i * 3 + 2] = pos[(i - 1) * 3 + 2] + 0.2;
          timer[i] = 0.5;
        } else {
          const a = rand() * Math.PI * 2, r = 2 + rand() * 7;
          const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
          const g = ctx.terrain.heightAt(x, z);
          target[i * 3] = x; target[i * 3 + 1] = Math.min(g + o.alt[0] + rand() * (o.alt[1] - o.alt[0]), -1.5); target[i * 3 + 2] = z;
          timer[i] = 4 + rand() * 6;
        }
      }
      let fx = target[i * 3] - px, fy = target[i * 3 + 1] - py, fz = target[i * 3 + 2] - pz;
      const fl = Math.hypot(fx, fy, fz) + 1e-3;
      let desired = o.speed * Math.min(1, fl / 1.5);
      fx /= fl; fy /= fl; fz /= fl;
      const ddx = px - d.x, ddy = py - d.y, ddz = pz - d.z;
      const dd = Math.hypot(ddx, ddy, ddz);
      if (dd < o.flee) { const k = (o.flee - dd) / o.flee; fx += ddx / dd * k * 3; fy += ddy / dd * k; fz += ddz / dd * k * 3; desired = o.speed * (1 + k * 3); }
      const g = ctx.terrain.heightAt(px, pz);
      if (py < g + 0.25) fy += 2;
      const k = Math.min(1, dt * 1.2);
      vel[i * 3] += (fx * desired - vel[i * 3]) * k;
      vel[i * 3 + 1] += (fy * desired * 0.5 - vel[i * 3 + 1]) * k;
      vel[i * 3 + 2] += (fz * desired - vel[i * 3 + 2]) * k;
      // fish hovering in place still need a facing direction
      const sp = Math.hypot(vel[i * 3], vel[i * 3 + 2]);
      if (sp < 0.03) { vel[i * 3] += Math.sin(this.phase[i]) * 0.01; vel[i * 3 + 2] += 0.02; }
      pos[i * 3] = px + vel[i * 3] * dt; pos[i * 3 + 1] = py + vel[i * 3 + 1] * dt; pos[i * 3 + 2] = pz + vel[i * 3 + 2] * dt;
    }
    this.writeInstances(dt);
  }
}

// ---------------------------------------------------------------- environment map for silvery reflections
export function makeWaterEnv(renderer) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vD; void main(){
      float y = vD.y;
      vec3 up = vec3(0.55, 0.95, 1.1) * 1.6;
      vec3 hor = vec3(0.05, 0.28, 0.38);
      vec3 dn = vec3(0.01, 0.05, 0.08);
      vec3 c = y > 0.0 ? mix(hor, up, pow(y, 0.7)) : mix(hor, dn, pow(-y, 0.5));
      c += vec3(2.5, 2.6, 2.4) * pow(max(y, 0.0), 24.0);
      gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.02);
  pm.dispose();
  return rt.texture;
}

// ---------------------------------------------------------------- manager
export class FishManager {
  constructor(site, terrain, reef, wreck, quality, renderer) {
    this.group = new THREE.Group();
    this.sets = [];
    const env = makeWaterEnv(renderer);
    this.env = env;
    const rand = mulberry32(777);
    const q = quality.fishDensity;
    const has = (k) => site.species.includes(k);
    const s = site.start;
    this.obstacles = reef.colliders;

    if (has('jack')) {
      const home = wreck ? wreck.center.clone().add(new THREE.Vector3(8, 3, 24)) : new THREE.Vector3(s.x + 25, -12, s.z + 50);
      this.add(new School(SPECIES.jack, Math.floor(260 * q), env, rand, { home, homeR: 10, speed: 0.9, maxSpeed: 3.2, nr: 1.8, sep: 0.75, mill: 1.3, minAlt: 3, fleeR: 3.2 }), 'jack', home);
    }
    if (has('fusilier')) {
      const home = new THREE.Vector3(s.x + 10, -8, s.z + 25);
      this.add(new School(SPECIES.fusilier, Math.floor(220 * q), env, rand, { home, homeR: 18, speed: 1.4, maxSpeed: 3.5, nr: 1.2, sep: 0.45, mill: 0.0, minAlt: 3, fleeR: 3.5, followDiver: true }), 'fusilier', home);
    }
    if (has('anthias')) {
      const anchors = reef.heads.length ? reef.heads : [new THREE.Vector3(s.x, -10, s.z + 10)];
      this.add(new Swarms(SPECIES.anthias, Math.floor(28 * q) + 6, 34, env, rand, anchors, { radius: 1.6, height: 1.4, speed: 0.22, flee: 1.8 }), 'anthias');
      // males are magenta, females orange
      const set = this.sets[this.sets.length - 1].set;
      for (let i = 0; i < set.count; i++) set.mesh.setColorAt(i, rand() < 0.12 ? new THREE.Color(0.85, 0.35, 0.95) : new THREE.Color(1, 1, 1));
    }
    if (reef.anemones.length) {
      this.add(new Swarms(SPECIES.clown, 3, Math.min(30, reef.anemones.length), env, rand, reef.anemones, { radius: 0.3, height: 0.25, speed: 0.3, flee: 0.9 }), 'clown');
    }
    if (has('butterfly')) this.add(new Wanderers(SPECIES.butterfly, Math.floor(36 * q), env, rand, { speed: 0.35, alt: [0.3, 1.5], pair: true }), 'butterfly');
    if (has('surgeon')) this.add(new Wanderers(SPECIES.surgeon, Math.floor(30 * q), env, rand, { speed: 0.45, alt: [0.3, 1.5] }), 'surgeon');
    if (has('parrot')) this.add(new Wanderers(SPECIES.parrot, 7, env, rand, { speed: 0.5, alt: [0.8, 3.0], range: 55, flee: 4 }), 'parrot');
  }

  add(set, key, home) {
    this.sets.push({ set, key, home });
    this.group.add(set.mesh);
  }

  update(dt, ctx) {
    ctx.obstacles = this.obstacles.length > 400 ? [] : this.obstacles;
    const lum = ctx.envScale;
    for (const { set } of this.sets) {
      set.mesh.material.envMapIntensity = 0.7 * lum;
      set.update(dt, ctx);
    }
  }

  /** nearest instance of each species within range (used for the fish log) */
  sighted(diver, range) {
    const out = [];
    for (const { set, key } of this.sets) {
      for (let i = 0; i < set.count; i++) {
        const dx = set.pos[i * 3] - diver.x, dy = set.pos[i * 3 + 1] - diver.y, dz = set.pos[i * 3 + 2] - diver.z;
        if (dx * dx + dy * dy + dz * dz < range * range) { out.push(key); break; }
      }
    }
    return out;
  }
}

export { U };
