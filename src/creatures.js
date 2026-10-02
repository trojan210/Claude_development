// Larger animals: green sea turtles and reef manta rays, with procedural bodies and
// vertex-shader locomotion (flipper strokes, wing flaps).
import * as THREE from 'three';
import { patchUW } from './water.js';
import { mulberry32, Simplex } from './noise.js';

// ------------------------------------------------------------------ turtle
function turtleGeometry() {
  // shell (carapace) + plastron
  const shell = new THREE.SphereGeometry(0.5, 40, 20);
  const p = shell.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    z *= 1.25; x *= 0.95;
    y = y > 0 ? y * 0.5 : y * 0.18;
    // taper toward the tail
    const t = (z + 0.62) / 1.24;
    x *= 0.75 + 0.25 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5);
    p.setXYZ(i, x, y, z);
  }
  shell.computeVertexNormals();
  const part = (g, id) => {
    const n = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(id), 1));
    const o = g.index ? g.toNonIndexed() : g;
    const r = new THREE.BufferGeometry();
    r.setAttribute('position', o.attributes.position);
    r.setAttribute('normal', o.attributes.normal);
    r.setAttribute('aPart', o.attributes.aPart);
    return r;
  };
  const head = new THREE.SphereGeometry(0.12, 18, 12);
  head.scale(1, 0.85, 1.35);
  head.translate(0, 0.02, 0.75);
  const neck = new THREE.CylinderGeometry(0.08, 0.1, 0.2, 10);
  neck.rotateX(Math.PI / 2);
  neck.translate(0, 0.0, 0.62);
  const flipper = (side, front) => {
    const shape = new THREE.Shape();
    const len = front ? 0.62 : 0.26, w = front ? 0.17 : 0.13;
    shape.moveTo(0, -w * 0.4);
    shape.quadraticCurveTo(len * 0.5, -w * 0.7, len, -w * 0.05);
    shape.quadraticCurveTo(len * 0.6, w * 0.5, 0, w * 0.5);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false, curveSegments: 8 });
    g.rotateX(Math.PI / 2);
    if (side < 0) g.scale(-1, 1, 1);
    g.rotateY(side * (front ? -0.35 : -0.9) + (side < 0 ? 0 : 0));
    g.translate(side * 0.38, -0.02, front ? 0.32 : -0.42);
    return g;
  };
  const parts = [
    part(shell, 0), part(head, 1), part(neck, 1),
    part(flipper(1, true), 2), part(flipper(-1, true), 3), part(flipper(1, false), 4), part(flipper(-1, false), 5),
  ];
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), pid = new Float32Array(total);
  let off = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    pid.set(g.attributes.aPart.array, off);
    off += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(pid, 1));
  return g;
}

function turtleMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.0, side: THREE.DoubleSide });
  const uniforms = { uStroke: { value: 0 } };
  patchUW(m, {
    key: 'turtle',
    uniforms,
    vertex: {
      pars: 'attribute float aPart; uniform float uStroke; varying float vPart; varying vec3 vObj;',
      begin: `
        vPart = aPart; vObj = position;
        // front flippers: wing-like power stroke; rear flippers: steering paddles
        if (aPart > 1.5 && aPart < 3.5) {
          float side = aPart < 2.5 ? 1.0 : -1.0;
          float r = abs(position.x) - 0.3;
          float a = sin(uStroke) * 0.75 * side;
          float c = cos(a), s = sin(a);
          vec2 xy = vec2(position.x - side * 0.3, position.y);
          xy = vec2(c * xy.x - s * xy.y, s * xy.x + c * xy.y);
          transformed.x = xy.x + side * 0.3;
          transformed.y = xy.y;
          transformed.z += sin(uStroke - 1.2) * 0.08 * max(r, 0.0) * 3.0;
        }
        if (aPart > 3.5) transformed.y += sin(uStroke * 0.5) * 0.03;
        if (aPart > 0.5 && aPart < 1.5) transformed.x += sin(uStroke * 0.5) * 0.02;
      `,
    },
    fragPars: `varying float vPart; varying vec3 vObj;
      vec2 th2(vec2 p){ return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453); }
      float voro(vec2 p, out float id){ vec2 i=floor(p), f=fract(p); float d=8.0; id=0.0;
        for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y); vec2 o=th2(i+g); vec2 r=g+o-f; float dd=dot(r,r); if(dd<d){d=dd; id=o.x;} }
        return sqrt(d); }`,
    fragColor: `
      vec3 c;
      if (vPart < 0.5) {
        if (vObj.y > -0.01) {
          float id; float d = voro(vObj.xz * vec2(4.0, 3.2), id);
          // scutes with radiating tortoiseshell streaks
          vec3 a = vec3(0.32, 0.22, 0.1), b = vec3(0.55, 0.4, 0.18);
          c = mix(a, b, id);
          float ray = sin(atan(vObj.z, vObj.x) * 18.0 + id * 20.0) * 0.5 + 0.5;
          c = mix(c, vec3(0.15, 0.1, 0.05), ray * 0.35);
          c *= smoothstep(0.0, 0.08, d) * 0.4 + 0.6;
        } else c = vec3(0.85, 0.8, 0.6);
      } else {
        float id; float d = voro(vObj.xz * 14.0 + vObj.y * 5.0, id);
        c = mix(vec3(0.4, 0.3, 0.15), vec3(0.85, 0.8, 0.65), smoothstep(0.05, 0.25, d));
      }
      diffuseColor.rgb = c;
    `,
  });
  return { m, uniforms };
}

export class Turtles {
  constructor(site, terrain, count, rand) {
    this.group = new THREE.Group();
    this.list = [];
    const geo = turtleGeometry();
    this.terrain = terrain;
    for (let i = 0; i < count; i++) {
      const { m: mat, uniforms } = turtleMaterial();
      const mesh = new THREE.Mesh(geo, mat);
      const s = 0.9 + rand() * 0.4;
      mesh.scale.setScalar(s);
      mesh.castShadow = true;
      const a = rand() * Math.PI * 2;
      const x = site.start.x + Math.cos(a) * (20 + rand() * 30), z = site.start.z + 30 + Math.sin(a) * 30;
      mesh.position.set(x, terrain.heightAt(x, z) + 3, z);
      this.group.add(mesh);
      this.list.push({ mesh, mat, stroke: rand() * 10, vel: new THREE.Vector3(0, 0, 0.3), target: mesh.position.clone(), timer: 0, mode: 'cruise', uniforms, rand });
    }
  }

  update(dt, ctx) {
    for (const t of this.list) {
      const m = t.mesh;
      t.timer -= dt;
      const ground = this.terrain.heightAt(m.position.x, m.position.z);
      if (t.timer <= 0) {
        const r = t.rand;
        const dist = Math.hypot(m.position.x - ctx.diver.x, m.position.z - ctx.diver.z);
        if (dist > 80) {
          // re-enter the scene from the blue, out of sight
          const a = r() * Math.PI * 2;
          m.position.set(ctx.diver.x + Math.cos(a) * 45, 0, ctx.diver.z + Math.sin(a) * 45);
          m.position.y = this.terrain.heightAt(m.position.x, m.position.z) + 4;
        }
        const roll = r();
        if (roll < 0.15) { t.mode = 'breathe'; t.timer = 40; }
        else if (roll < 0.35) { t.mode = 'rest'; t.timer = 15 + r() * 15; }
        else { t.mode = 'cruise'; t.timer = 8 + r() * 10; }
        const a = r() * Math.PI * 2, d = 8 + r() * 15;
        const tx = m.position.x + Math.cos(a) * d, tz = m.position.z + Math.sin(a) * d;
        const g = this.terrain.heightAt(tx, tz);
        t.target.set(tx, t.mode === 'breathe' ? -0.4 : t.mode === 'rest' ? g + 0.35 : g + 1.5 + r() * 4, tz);
      }
      const to = t.target.clone().sub(m.position);
      const dist = to.length();
      let speed = t.mode === 'rest' ? Math.min(0.25, dist * 0.3) : 0.42;
      if (t.mode === 'breathe' && m.position.y > -0.8) { t.timer = Math.min(t.timer, 3); }
      // shy of divers who chase them
      const dd = m.position.distanceTo(ctx.diver);
      if (dd < 2.5) { to.add(m.position.clone().sub(ctx.diver).multiplyScalar(2)); speed = 0.8; }
      to.normalize().multiplyScalar(speed);
      t.vel.lerp(to, Math.min(1, dt * 0.4));
      m.position.addScaledVector(t.vel, dt);
      if (m.position.y < ground + 0.3) m.position.y = ground + 0.3;
      const hs = Math.hypot(t.vel.x, t.vel.z);
      if (hs > 0.03) {
        const yaw = Math.atan2(t.vel.x, t.vel.z);
        const pitch = -Math.atan2(t.vel.y, hs) * 0.7;
        let dy = yaw - m.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        m.rotation.order = 'YXZ';
        m.rotation.y += dy * Math.min(1, dt * 0.8);
        m.rotation.x += (pitch - m.rotation.x) * Math.min(1, dt);
        m.rotation.z = -dy * 0.4;
      }
      const resting = t.mode === 'rest' && dist < 0.5;
      // slow powerful strokes with a glide
      const strokeRate = resting ? 0.05 : 0.55 + hs * 0.8;
      t.stroke += dt * strokeRate * Math.PI * 2 * (Math.sin(t.stroke * 0.5) > -0.3 ? 1 : 0.35);
      t.uniforms.uStroke.value = t.stroke;
    }
  }
}

// ------------------------------------------------------------------ manta
function mantaGeometry() {
  // planform: wide triangular pectoral fins, body disc, cephalic lobes; y = thickness profile
  const nx = 48, nz = 24;
  const pos = [], idx = [], uv = [];
  const span = 1.0; // half span (scaled later)
  const outline = (x) => {
    // front and back edge z (z+ forward) for |x| along span
    const a = Math.abs(x) / span;
    const front = 0.42 - a * 0.62 + Math.pow(a, 3) * 0.05;
    const back = -0.32 + Math.pow(a, 1.6) * 0.42 - (1 - a) * 0.05;
    return [front, Math.min(back, front - 0.02)];
  };
  for (let s = 0; s < 2; s++) {
    const base = pos.length / 3;
    for (let i = 0; i <= nx; i++) {
      const x = -span + (2 * span * i) / nx;
      const [f, b] = outline(x);
      for (let j = 0; j <= nz; j++) {
        const t = j / nz;
        const z = b + (f - b) * t;
        const a = Math.abs(x) / span;
        const thick = 0.09 * Math.pow(1 - a, 1.6) * Math.sin(t * Math.PI) + 0.005;
        const y = (s === 0 ? 1 : -1) * thick + (1 - a) * 0.02;
        pos.push(x, y, z);
        uv.push(x, z);
      }
    }
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const a = base + i * (nz + 1) + j, b = base + (i + 1) * (nz + 1) + j, c = b + 1, d = a + 1;
        if (s === 0) idx.push(a, d, b, b, d, c); else idx.push(a, b, d, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // cephalic fins + tail as separate thin pieces
  const extra = [];
  for (const side of [-1, 1]) {
    const c = new THREE.BoxGeometry(0.035, 0.03, 0.2, 1, 1, 4);
    c.translate(side * 0.11, 0.0, 0.5);
    extra.push(c);
  }
  const tail = new THREE.CylinderGeometry(0.004, 0.018, 0.55, 6, 6);
  tail.rotateX(Math.PI / 2);
  tail.translate(0, 0.0, -0.55);
  extra.push(tail);
  const merged = [g, ...extra].map((x) => {
    const o = x.index ? x.toNonIndexed() : x;
    const r = new THREE.BufferGeometry();
    r.setAttribute('position', o.attributes.position);
    r.setAttribute('normal', o.attributes.normal);
    r.setAttribute('uv', o.attributes.uv || new THREE.Float32BufferAttribute(new Float32Array(o.attributes.position.count * 2), 2));
    return r;
  });
  let total = 0; merged.forEach((m) => { total += m.attributes.position.count; });
  const P = new Float32Array(total * 3), Nn = new Float32Array(total * 3), UVa = new Float32Array(total * 2);
  let off = 0;
  for (const m of merged) {
    P.set(m.attributes.position.array, off * 3); Nn.set(m.attributes.normal.array, off * 3); UVa.set(m.attributes.uv.array, off * 2);
    off += m.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(UVa, 2));
  return out;
}

function mantaMaterial(seed) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.0, side: THREE.DoubleSide });
  const uniforms = { uFlap: { value: 0 }, uSeed: { value: seed } };
  patchUW(m, {
    key: 'manta',
    uniforms,
    vertex: {
      pars: 'uniform float uFlap; varying vec3 vObj; varying float vTop;',
      begin: `
        vObj = position;
        vTop = normal.y;
        float ax = abs(position.x);
        // wave travels from leading to trailing edge, amplitude grows toward the wingtips
        float w = sin(uFlap - position.z * 2.2 - ax * 0.6);
        transformed.y += w * pow(ax, 1.6) * 0.32;
        transformed.y += sin(uFlap - 1.5) * 0.02 * (1.0 - ax);
        if (position.z < -0.4) transformed.x += sin(uFlap * 0.5 + position.z * 5.0) * 0.04 * (-position.z - 0.4);
      `,
    },
    fragPars: `uniform float uSeed; varying vec3 vObj; varying float vTop;
      float mh(vec2 p){ return fract(sin(dot(p, vec2(12.99,78.23)) + uSeed) * 43758.5); }`,
    fragColor: `
      vec3 c;
      if (gl_FrontFacing == (vTop > 0.0)) {
        // dorsal: black with pale chevron shoulder patches (M. alfredi)
        c = vec3(0.025, 0.028, 0.032);
        float patchL = smoothstep(0.16, 0.1, length((vObj.xz - vec2(-0.32, 0.12)) * vec2(1.0, 2.0)));
        float patchR = smoothstep(0.16, 0.1, length((vObj.xz - vec2(0.32, 0.12)) * vec2(1.0, 2.0)));
        c = mix(c, vec3(0.75, 0.75, 0.72), max(patchL, patchR) * 0.85);
      } else {
        // ventral: white with the individual's unique spot pattern, dark trailing edge
        c = vec3(0.85, 0.86, 0.85);
        vec2 g = floor(vObj.xz * 14.0);
        float sp = step(0.86, mh(g)) * smoothstep(0.35, 0.05, length(fract(vObj.xz * 14.0) - 0.5));
        c = mix(c, vec3(0.08), sp * smoothstep(0.5, 0.1, abs(vObj.x)));
        float edge = smoothstep(0.55, 0.95, abs(vObj.x)) * 0.7;
        c = mix(c, vec3(0.08), edge);
      }
      diffuseColor.rgb = c;
    `,
  });
  return { m, uniforms };
}

export class Mantas {
  constructor(site, terrain, count, rand) {
    this.group = new THREE.Group();
    this.list = [];
    const geo = mantaGeometry();
    this.terrain = terrain;
    this.station = new THREE.Vector3(site.start.x + 4, 0, site.start.z + 32);
    this.station.y = terrain.heightAt(this.station.x, this.station.z);
    const noise = new Simplex(55);
    for (let i = 0; i < count; i++) {
      const { m, uniforms } = mantaMaterial(rand() * 100);
      const mesh = new THREE.Mesh(geo, m);
      const span = 1.6 + rand() * 0.6; // half span (wingspan 3.2–4.4 m)
      mesh.scale.setScalar(span);
      mesh.castShadow = true;
      mesh.rotation.order = 'YXZ';
      this.group.add(mesh);
      this.list.push({ mesh, uniforms, flap: rand() * 10, ang: rand() * Math.PI * 2, r: 7 + rand() * 9, h: 3 + rand() * 5, speed: 0.12 + rand() * 0.06, dir: rand() < 0.5 ? 1 : -1, noise, k: i * 13.1 });
    }
  }

  update(dt, ctx) {
    const st = this.station;
    for (const t of this.list) {
      const time = ctx.time;
      t.ang += dt * t.speed * t.dir * (1 + 0.3 * t.noise.noise2(time * 0.05, t.k));
      const r = t.r * (1 + 0.35 * t.noise.noise2(time * 0.03, t.k + 5));
      const x = st.x + Math.cos(t.ang) * r;
      const z = st.z + Math.sin(t.ang) * r;
      const g = this.terrain.heightAt(x, z);
      let y = Math.max(g + 2.2, st.y + t.h + t.noise.noise2(time * 0.04, t.k + 9) * 3.5);
      y = Math.min(y, -2.5);
      const m = t.mesh;
      const prev = m.position.clone();
      // mantas veer away from divers who get too close (and above them)
      const away = new THREE.Vector3(x, y, z).sub(ctx.diver);
      const dd = away.length();
      const target = new THREE.Vector3(x, y, z);
      if (dd < 4) target.addScaledVector(away.normalize(), (4 - dd) * 1.2).y += (4 - dd) * 0.5;
      if (!t.init) { m.position.copy(target); t.init = true; }
      m.position.lerp(target, Math.min(1, dt * 1.5));
      const v = m.position.clone().sub(prev);
      const hs = Math.hypot(v.x, v.z);
      if (hs > 1e-4) {
        const yaw = Math.atan2(v.x, v.z);
        let dy = yaw - m.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        m.rotation.y += dy * Math.min(1, dt * 2);
        m.rotation.x = -Math.atan2(v.y, hs) * 0.8;
        m.rotation.z = THREE.MathUtils.lerp(m.rotation.z, -t.dir * 0.35, dt);
      }
      // flap with glide phases
      const glide = t.noise.noise2(time * 0.1, t.k + 20) > 0.35;
      t.flap += dt * (glide ? 0.4 : 2.3);
      t.uniforms.uFlap.value = t.flap;
    }
  }
}

export function makeCreatures(site, terrain, quality) {
  const rand = mulberry32(9001);
  const out = [];
  if (site.species.includes('turtle')) out.push(new Turtles(site, terrain, 3, rand));
  if (site.species.includes('manta')) out.push(new Mantas(site, terrain, quality.high ? 6 : 4, rand));
  return out;
}
