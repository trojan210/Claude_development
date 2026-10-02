// USAT Liberty: a 120 m cargo ship lying on its side on the volcanic sand slope at
// Tulamben, broken into sections, plating rusted through and densely encrusted.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { patchUW } from './water.js';
import { Simplex, mulberry32, smoothstep } from './noise.js';

const L = 120, B = 8.6, H = 10.5;
const N = new Simplex(1942);

// half-beam along the length (u: 0 = stern, 1 = bow)
function beamAt(u) {
  const stern = smoothstep(0.0, 0.12, u);
  const bow = 1 - Math.pow(smoothstep(0.72, 1.0, u), 1.6);
  return B * (0.35 + 0.65 * stern) * bow + 0.05;
}
// hull section point; v: -1 (port deck edge) .. 0 (keel) .. 1 (starboard deck edge)
function hullPoint(u, v, out) {
  const b = beamAt(u);
  const th = v * Math.PI / 2;
  const s = Math.sin(th), c = Math.cos(th);
  const e = 0.28; // boxy superellipse
  const z = b * Math.sign(s) * Math.pow(Math.abs(s), e);
  // sheer: bow rises
  const sheer = Math.pow(smoothstep(0.75, 1, u), 2) * 2.2 + Math.pow(1 - smoothstep(0, 0.1, u), 2) * 0.8;
  const keelRise = Math.pow(smoothstep(0.85, 1.0, u), 2) * 3.0 + Math.pow(1 - smoothstep(0, 0.06, u), 2) * 2.0;
  const y = keelRise + (H + sheer - keelRise) * (1 - Math.pow(Math.abs(c), e));
  return out.set((u - 0.5) * L, y, z);
}

function encrustColor(p, rand) {
  const n1 = N.fbm3(p.x * 0.15, p.y * 0.15, p.z * 0.15, 3);
  const n2 = N.noise3(p.x * 0.7 + 10, p.y * 0.7, p.z * 0.7);
  let c = new THREE.Color('#4b3427'); // rust
  if (n1 > 0.15) c.lerp(new THREE.Color('#9a6276'), smoothstep(0.15, 0.4, n1)); // coralline algae
  if (n1 < -0.2) c.lerp(new THREE.Color('#56603a'), smoothstep(-0.2, -0.45, n1)); // turf algae
  if (n2 > 0.45) c.lerp(new THREE.Color('#c0682e'), 0.7); // orange encrusting sponge
  if (n2 < -0.55) c.lerp(new THREE.Color('#d8d0b8'), 0.5); // pale hydroids
  const v = 0.8 + rand() * 0.25;
  return [c.r * v, c.g * v, c.b * v];
}

function hullSection(u0, u1, rand, holeSeed) {
  const nu = Math.max(4, Math.round((u1 - u0) * 110));
  const nv = 44;
  const pos = [], col = [], uv = [], idx = [];
  const p = new THREE.Vector3();
  const hs = new Simplex(holeSeed);
  for (let i = 0; i <= nu; i++) {
    const u = u0 + (u1 - u0) * (i / nu);
    for (let j = 0; j <= nv; j++) {
      const v = -1 + 2 * (j / nv);
      hullPoint(u, v, p);
      // dents and buckled plates
      const dent = N.fbm3(p.x * 0.12, p.y * 0.12, p.z * 0.12, 3) * 0.35;
      p.z += Math.sign(p.z || 1) * dent;
      // broken ends: jagged and sagging
      const endDist = Math.min(i, nu - i) / nu;
      if (endDist < 0.06) p.y -= (0.06 - endDist) * 25 * (0.5 + hs.noise2(j * 0.3, i) * 0.5);
      pos.push(p.x, p.y, p.z);
      col.push(...encrustColor(p, rand));
      uv.push(p.x / 5, (p.y + Math.abs(p.z)) / 5);
    }
  }
  const w = nv + 1;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const u = u0 + (u1 - u0) * ((i + 0.5) / nu), v = -1 + 2 * ((j + 0.5) / nv);
      // corrosion holes and missing plates
      const hole = hs.fbm2(u * 40, v * 6, 2);
      const edgeBreak = (Math.min(i, nu - i) < 2 && hs.noise2(i, j * 0.5) > 0.1);
      if (hole > 0.42 - (Math.abs(v) > 0.7 ? 0.15 : 0) || edgeBreak) continue;
      const a = i * w + j, b = (i + 1) * w + j, c = (i + 1) * w + j + 1, d = i * w + j + 1;
      idx.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function colorize(g, rand, tint) {
  const pos = g.attributes.position;
  const col = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const c = encrustColor(p, rand);
    col.push(c[0] * tint, c[1] * tint, c[2] * tint);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2));
  return g;
}

function prep(g) {
  const o = new THREE.BufferGeometry();
  const ng = g.index ? g.toNonIndexed() : g;
  o.setAttribute('position', ng.attributes.position);
  o.setAttribute('normal', ng.attributes.normal);
  o.setAttribute('uv', ng.attributes.uv);
  o.setAttribute('color', ng.attributes.color);
  return o;
}

function ribs(u0, u1, rand) {
  const parts = [];
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  for (let x = Math.ceil(((u0 - 0.5) * L) / 2.4) * 2.4; x < (u1 - 0.5) * L - 1; x += 2.4) {
    const u = x / L + 0.5;
    if (rand() < 0.25) continue; // some frames gone
    for (let j = 0; j < 16; j++) {
      const v0 = -1 + 2 * (j / 16), v1 = -1 + 2 * ((j + 1) / 16);
      hullPoint(u, v0, p); hullPoint(u, v1, q);
      const len = p.distanceTo(q);
      const box = new THREE.BoxGeometry(0.22, len, 0.5);
      box.translate(0, len / 2, 0);
      const dir = q.clone().sub(p).normalize();
      box.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      // pull inward from the plating
      const inward = new THREE.Vector3(0, H * 0.5, 0).sub(p).setX(0).normalize().multiplyScalar(0.25);
      box.translate(p.x + inward.x, p.y + inward.y, p.z + inward.z);
      parts.push(prep(colorize(box, rand, 0.9)));
    }
  }
  return parts;
}

function deckRemnants(u0, u1, rand) {
  const parts = [];
  for (let x = (u0 - 0.5) * L + 2; x < (u1 - 0.5) * L - 2; x += 3) {
    if (rand() < 0.45) continue;
    const u = x / L + 0.5;
    const b = beamAt(u);
    const w = b * (0.4 + rand() * 0.5);
    const plate = new THREE.BoxGeometry(2.6, 0.15, w, 3, 1, 3);
    const side = rand() < 0.5 ? -1 : 1;
    const y = hullPoint(u, side, new THREE.Vector3()).y - 0.1;
    plate.rotateX((rand() - 0.5) * 0.25);
    plate.translate(x, y, side * (b - w / 2));
    parts.push(prep(colorize(plate, rand, 1)));
  }
  return parts;
}

function cylinderPart(r, len, x, y, z, rotZ, rotX, rand, open = false) {
  const g = new THREE.CylinderGeometry(r, r, len, 20, 4, open);
  g.rotateZ(rotZ);
  if (rotX) g.rotateX(rotX);
  g.translate(x, y, z);
  return prep(colorize(g, rand, 1));
}

export class Wreck {
  constructor(site, terrain, reef, quality) {
    const rand = mulberry32(1963);
    const W = site.wreck;
    this.group = new THREE.Group();
    const sections = [
      { u0: 0.0, u1: 0.33, roll: 1.2, dy: 0, twist: 0.0 },
      { u0: 0.36, u1: 0.66, roll: 1.32, dy: 0, twist: 0.04 },
      { u0: 0.69, u1: 1.0, roll: 1.18, dy: 0, twist: -0.05 },
    ];
    const world = [];
    const tmp = new THREE.Vector3();
    const base = new THREE.Matrix4().makeRotationY(W.rotY).setPosition(W.x, 0, W.z);
    this.surfacePoints = [];

    for (const [si, s] of sections.entries()) {
      const parts = [prep(hullSection(s.u0, s.u1, rand, 100 + si))];
      parts.push(...ribs(s.u0, s.u1, rand));
      parts.push(...deckRemnants(s.u0, s.u1, rand));
      // bulkheads at section ends
      if (si === 1) {
        // boilers and engine block spilled in the mid section
        parts.push(cylinderPart(2.1, 5.5, 2, 3.2, -2.5, Math.PI / 2, 0, rand));
        parts.push(cylinderPart(2.1, 5.5, 2, 3.2, 2.5, Math.PI / 2, 0, rand));
        const eng = new THREE.BoxGeometry(6, 4, 5, 3, 2, 3);
        eng.translate(-8, 2.5, 0);
        parts.push(prep(colorize(eng, rand, 0.85)));
        // fallen funnel
        parts.push(cylinderPart(1.6, 7, 6, 9.5, 5, 0.2, 1.3, rand, true));
      }
      if (si === 0) {
        // stern gun on its mount and the rudder
        parts.push(cylinderPart(0.55, 1.2, -52, H + 0.6, 0, 0, 0, rand));
        parts.push(cylinderPart(0.18, 4.2, -52 + 2.1, H + 1.1, 0, Math.PI / 2, 0, rand));
        const rud = new THREE.BoxGeometry(2.4, 4.2, 0.3);
        rud.translate(-60.5, 2.6, 0);
        parts.push(prep(colorize(rud, rand, 0.9)));
        parts.push(cylinderPart(0.3, 6, -57, 2.2, 0, Math.PI / 2, 0, rand));
      }
      if (si === 2) {
        // anchor windlass and bow mast stump
        parts.push(cylinderPart(0.7, 3.2, 48, H + 1.2, 0, 0, Math.PI / 2, rand));
        parts.push(cylinderPart(0.35, 9, 38, H + 3.5, 0, 0.0, 0.5, rand));
      }
      // cargo hold coaming
      if (si !== 1) {
        const cx = si === 0 ? -30 : 30;
        const coam = new THREE.BoxGeometry(10, 1.2, 0.3);
        coam.translate(cx, H + 0.4, 3.5);
        parts.push(prep(colorize(coam, rand, 1)));
        const coam2 = coam.clone(); coam2.translate(0, 0, -7);
        parts.push(prep(colorize(coam2, rand, 1)));
      }
      const g = mergeGeometries(parts);
      // place: roll onto its side, then rest on the slope
      const mid = ((s.u0 + s.u1) / 2 - 0.5) * L;
      const m = new THREE.Matrix4()
        .makeTranslation(mid, 0, 0)
        .multiply(new THREE.Matrix4().makeRotationY(s.twist))
        .multiply(new THREE.Matrix4().makeRotationX(s.roll))
        .multiply(new THREE.Matrix4().makeTranslation(-mid, 0, 0));
      g.applyMatrix4(m);
      g.applyMatrix4(base);
      // drop onto seabed: the lower side is partly buried in the sand
      const pos = g.attributes.position;
      let minGap = Infinity;
      for (let i = 0; i < pos.count; i += 3) {
        tmp.fromBufferAttribute(pos, i);
        minGap = Math.min(minGap, tmp.y - terrain.heightAt(tmp.x, tmp.z));
      }
      g.translate(0, -minGap - 2.6, 0);
      g.computeBoundingSphere();
      world.push(g);
    }

    const rockTex = terrain.rockTex;
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.05,
      side: THREE.DoubleSide,
      normalMap: rockTex.normalMap,
      normalScale: new THREE.Vector2(1.3, 1.3),
    });
    patchUW(mat, { key: 'wreck' });
    this.meshes = world.map((g) => {
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    });

    // collision BVH over the whole wreck
    const merged = mergeGeometries(world.map((g) => {
      const o = new THREE.BufferGeometry();
      o.setAttribute('position', g.attributes.position);
      return o;
    }));
    merged.boundsTree = new MeshBVH(merged);
    this.collider = merged;

    // encrusting life on the hull: sample visible, upward-ish facing triangles
    this.encrust(world, reef, quality, rand);

    this.center = new THREE.Vector3(W.x, terrain.heightAt(W.x, W.z) + 6, W.z);
    this.footprint = (x, z) => {
      const dx = x - W.x, dz = z - W.z;
      const c = Math.cos(-W.rotY), s = Math.sin(-W.rotY);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      return Math.abs(lx) < L / 2 + 3 && Math.abs(lz) < 14;
    };
  }

  encrust(world, reef, quality, rand) {
    const want = { soft: 900, fan: 260, crinoid: 420, tube: 260, branch2: 120, boulder: 160, anemone: 30 };
    const types = Object.fromEntries(reef.types.map((t) => [t.key, t]));
    const pal = {
      soft: ['#e0507a', '#ff6a3c', '#c04ad0', '#f2d6dc', '#ff8a5a', '#e070b0'],
      fan: ['#c0302a', '#e07028', '#d0507a', '#b02a3a'],
      crinoid: ['#e8c030', '#202020', '#c03020', '#f0f0e0'],
      tube: ['#7a3aa0', '#e0b030', '#3a6ab0'],
      branch2: ['#c8b38a', '#9a7fb5'],
      boulder: ['#b59a6a', '#8a6a86', '#c0a070'],
      anemone: ['#d8c08a'],
    };
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const n = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion(), qy = new THREE.Quaternion(), m = new THREE.Matrix4(), sc = new THREE.Vector3();
    const totalTris = world.map((g) => g.attributes.position.count / 3);
    const total = totalTris.reduce((x, y) => x + y, 0);
    for (const [key, count0] of Object.entries(want)) {
      const count = Math.floor(count0 * quality.reefDensity);
      const t = types[key];
      if (!t) continue;
      const mats = [], cols = [];
      let tries = 0;
      while (mats.length < count && tries++ < count * 20) {
        let r = Math.floor(rand() * total), gi = 0;
        while (r >= totalTris[gi]) { r -= totalTris[gi]; gi++; }
        const pos = world[gi].attributes.position;
        a.fromBufferAttribute(pos, r * 3); b.fromBufferAttribute(pos, r * 3 + 1); c.fromBufferAttribute(pos, r * 3 + 2);
        n.subVectors(b, a).cross(c.clone().sub(a));
        const area = n.length();
        if (area < 0.05) continue;
        n.normalize();
        if (n.y < 0) n.negate(); // either face of the plating can host growth if it faces up
        if (n.y < (key === 'fan' ? -0.1 : 0.25)) continue;
        let u = rand(), v = rand();
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        p.copy(a).addScaledVector(b.clone().sub(a), u).addScaledVector(c.clone().sub(a), v);
        q.setFromUnitVectors(up, n.clone().lerp(up, 0.3).normalize());
        qy.setFromAxisAngle(up, rand() * Math.PI * 2);
        q.multiply(qy);
        const s = (t.s[0] + rand() * (t.s[1] - t.s[0])) * (key === 'boulder' ? 0.6 : 0.9);
        sc.set(s, s * (0.8 + rand() * 0.4), s);
        m.compose(p, q, sc);
        mats.push(m.clone());
        const col = new THREE.Color(pal[key][Math.floor(rand() * pal[key].length)]);
        col.offsetHSL((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.1);
        cols.push(col);
      }
      const im = new THREE.InstancedMesh(t.geo, t.mat, mats.length);
      mats.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, cols[i]); });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.receiveShadow = true;
      this.group.add(im);
    }
  }
}
