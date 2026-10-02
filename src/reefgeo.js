// Procedural geometry for reef organisms. All geometries carry a 'color' attribute
// (baked ambient occlusion + tip colouring) that is multiplied with the per-instance colour.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Simplex, mulberry32 } from './noise.js';

const N = new Simplex(4242);

function setColor(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const c = fn(v, i);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function weldedSphere(detail) {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', ico.attributes.position);
  const w = mergeVertices(g);
  w.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(w.attributes.position.count * 2), 2));
  w.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(w.attributes.position.count * 3), 3));
  return w;
}

function clean(geo) {
  // strip to the attributes shared by all reef geometries so they can be merged
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position);
  g.setAttribute('normal', geo.attributes.normal);
  g.setAttribute('uv', geo.attributes.uv || new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  if (geo.attributes.color) g.setAttribute('color', geo.attributes.color);
  if (geo.index) g.setIndex(geo.index);
  return g;
}

/** Massive / brain coral (Porites, Platygyra): lumpy dome with meandering grooves. */
export function boulderCoral(detail = 4, brain = false) {
  let g = weldedSphere(detail);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    let r = 1 + N.fbm3(n.x * 1.6, n.y * 1.6, n.z * 1.6, 3) * 0.28;
    if (brain) r += Math.abs(N.noise3(n.x * 7, n.y * 7, n.z * 7)) * -0.07;
    else r += N.noise3(n.x * 9, n.y * 9, n.z * 9) * 0.035;
    v.copy(n).multiplyScalar(r);
    v.y = v.y < 0 ? v.y * 0.15 : v.y * 0.78; // flat base sitting on the reef
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  setColor(g, (p) => {
    const ao = THREE.MathUtils.clamp(0.6 + p.y * 0.6, 0.5, 1.0);
    return [ao, ao, ao];
  });
  return g;
}

function branchTree(rand, opts) {
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const grow = (start, dir, len, rad, depth) => {
    const end = start.clone().addScaledVector(dir, len);
    const cyl = new THREE.CylinderGeometry(rad * opts.taper, rad, len, opts.radial, 1, depth < opts.depth);
    cyl.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    cyl.applyQuaternion(q);
    cyl.translate(start.x, start.y, start.z);
    const tip = 1 - depth / (opts.depth + 1);
    setColor(cyl, (p) => {
      const ao = THREE.MathUtils.clamp(0.6 + p.y / opts.height * 0.5, 0.55, 1);
      const t = depth >= opts.depth ? 1 : 0;
      return [ao * (1 + t * opts.tipBoost[0]), ao * (1 + t * opts.tipBoost[1]), ao * (1 + t * opts.tipBoost[2])];
    });
    parts.push(clean(cyl).toNonIndexed());
    void tip;
    if (depth >= opts.depth) {
      if (opts.tipSphere) {
        const s = new THREE.SphereGeometry(rad * opts.taper * 1.25, 4, 3);
        s.translate(end.x, end.y, end.z);
        setColor(s, () => [1 + opts.tipBoost[0], 1 + opts.tipBoost[1], 1 + opts.tipBoost[2]]);
        parts.push(clean(s).toNonIndexed());
      }
      return;
    }
    const n = opts.children(rand, depth);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const tilt = opts.spread * (0.5 + rand() * 0.7);
      const nd = dir.clone()
        .applyAxisAngle(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), tilt)
        .lerp(up, opts.upBias).normalize();
      grow(end, nd, len * (0.68 + rand() * 0.2), rad * opts.taper, depth + 1);
    }
  };
  for (let k = 0; k < opts.trunks; k++) {
    const a = (k / opts.trunks) * Math.PI * 2 + rand();
    const d = new THREE.Vector3(Math.cos(a) * opts.trunkTilt, 1, Math.sin(a) * opts.trunkTilt).normalize();
    grow(new THREE.Vector3(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05), d, opts.len, opts.rad, 0);
  }
  const g = mergeGeometries(parts);
  return g;
}

/** Staghorn / bushy Acropora. */
export function branchingCoral(seed = 1) {
  return branchTree(mulberry32(seed), {
    trunks: 4, len: 0.38, rad: 0.055, taper: 0.75, radial: 4, depth: 3, height: 1.1,
    spread: 0.75, upBias: 0.25, trunkTilt: 0.8, tipSphere: false,
    tipBoost: [0.5, 0.45, 0.6],
    children: (r, d) => (d < 1 ? 3 : 2),
  });
}

/** Soft coral (Sinularia / Dendronephthya): thick fleshy lobes. */
export function softCoral(seed = 2) {
  return branchTree(mulberry32(seed), {
    trunks: 3, len: 0.3, rad: 0.09, taper: 0.72, radial: 5, depth: 2, height: 0.8,
    spread: 0.9, upBias: 0.35, trunkTilt: 0.5, tipSphere: true,
    tipBoost: [0.25, 0.2, 0.25],
    children: (r) => 2 + (r() > 0.5 ? 1 : 0),
  });
}

/** Table coral (Acropora hyacinthus): plate on a short stalk. */
export function tableCoral() {
  const shape = new THREE.Shape();
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 1 + N.noise2(Math.cos(a) * 1.5, Math.sin(a) * 1.5) * 0.18 + (i % 2 ? 0.03 : 0);
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  let plate = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.02, bevelSegments: 1, steps: 1, curveSegments: 1 });
  plate.rotateX(-Math.PI / 2);
  const pos = plate.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    pos.setY(i, pos.getY(i) + r * r * 0.12 + 0.55 + N.noise2(x * 3, z * 3) * 0.02);
  }
  plate.computeVertexNormals();
  plate = clean(plate).toNonIndexed();
  setColor(plate, (p) => {
    const r = Math.hypot(p.x, p.z);
    const top = p.y > 0.6 + r * r * 0.12 ? 1 : 0.65;
    const edge = 1 + Math.max(0, r - 0.85) * 2.2;
    return [top * edge, top * edge * 0.98, top * edge];
  });
  const stalk = new THREE.CylinderGeometry(0.1, 0.18, 0.6, 7);
  stalk.translate(0, 0.3, 0);
  setColor(stalk, (p) => [0.6 + p.y * 0.4, 0.6 + p.y * 0.4, 0.6 + p.y * 0.4]);
  return mergeGeometries([plate, clean(stalk).toNonIndexed()]);
}

/** Giant barrel sponge (Xestospongia). */
export function barrelSponge() {
  const pts = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = 0.45 + Math.sin(t * Math.PI * 0.9) * 0.25 + t * 0.15;
    pts.push(new THREE.Vector2(r, t * 1.4));
  }
  // lip and inner wall
  pts.push(new THREE.Vector2(0.62, 1.42), new THREE.Vector2(0.55, 1.35), new THREE.Vector2(0.45, 0.5));
  let g = new THREE.LatheGeometry(pts, 24);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    const a = Math.atan2(z, x);
    const ridge = 1 + Math.pow(Math.abs(Math.sin(a * 9)), 3) * 0.07 + N.noise3(x * 4, y * 4, z * 4) * 0.03;
    pos.setX(i, x * ridge); pos.setZ(i, z * ridge);
  }
  g.computeVertexNormals();
  g = clean(g);
  setColor(g, (p) => {
    const rr = Math.hypot(p.x, p.z);
    const inner = rr < 0.5 && p.y > 0.5 ? 0.5 : 1;
    const ao = THREE.MathUtils.clamp(0.6 + p.y * 0.3, 0.55, 1) * inner;
    return [ao, ao, ao];
  });
  return g;
}

/** Cluster of tube sponges. */
export function tubeSponges(seed = 3) {
  const rand = mulberry32(seed);
  const parts = [];
  const k = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < k; i++) {
    const h = 0.3 + rand() * 0.6;
    const r = 0.05 + rand() * 0.05;
    const c = new THREE.CylinderGeometry(r * 1.1, r, h, 7, 1, true);
    c.translate(0, h / 2, 0);
    c.rotateZ((rand() - 0.5) * 0.5);
    c.rotateX((rand() - 0.5) * 0.5);
    const a = rand() * Math.PI * 2, d = rand() * 0.15;
    c.translate(Math.cos(a) * d, 0, Math.sin(a) * d);
    setColor(c, (p) => { const ao = Math.min(1, 0.6 + p.y * 0.6); return [ao, ao, ao]; });
    parts.push(clean(c).toNonIndexed());
  }
  return mergeGeometries(parts);
}

/** Sea anemone (Heteractis magnifica): column + many swaying tentacles. */
export function anemone(seed = 4) {
  const rand = mulberry32(seed);
  const parts = [];
  const base = new THREE.CylinderGeometry(0.28, 0.3, 0.14, 16, 1);
  base.translate(0, 0.07, 0);
  setColor(base, () => [0.55, 0.5, 0.5]);
  parts.push(clean(base).toNonIndexed());
  const count = 80;
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 0.33;
    const h = 0.12 + rand() * 0.12;
    const t = new THREE.ConeGeometry(0.022, h, 3, 1);
    t.translate(0, h / 2, 0);
    const out = new THREE.Vector3(Math.cos(a), 1.4 - r * 2, Math.sin(a)).normalize();
    t.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), out));
    t.translate(Math.cos(a) * r, 0.13, Math.sin(a) * r);
    setColor(t, (p) => { const k = 0.8 + (p.y - 0.13) * 2.5; return [k * 1.1, k, k * 0.85]; });
    parts.push(clean(t).toNonIndexed());
  }
  return mergeGeometries(parts);
}

/** Gorgonian sea fan: bent quad carrying the fractal fan texture. */
export function seaFan() {
  const g = new THREE.PlaneGeometry(2, 2, 6, 6);
  g.translate(0, 1, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, Math.sin(x * 1.3) * 0.12 + y * y * 0.03);
  }
  g.computeVertexNormals();
  setColor(g, (p) => { const ao = 0.6 + p.y * 0.25; return [ao, ao, ao]; });
  return clean(g);
}

/** Generic reef rock / rubble. */
export function reefRock(seed = 5) {
  let g = weldedSphere(3);
  const s = new Simplex(seed);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const r = 1 + s.fbm3(n.x * 1.2, n.y * 1.2, n.z * 1.2, 4) * 0.45;
    v.copy(n).multiplyScalar(r);
    v.y *= 0.6;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  setColor(g, (p) => { const ao = THREE.MathUtils.clamp(0.6 + p.y * 0.6, 0.5, 1); return [ao, ao, ao]; });
  return g;
}

/** Feather-duster-like crinoid cluster sitting on tops of rocks: thin radiating arms. */
export function crinoid(seed = 6) {
  const rand = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rand() * 0.2;
    const len = 0.25 + rand() * 0.12;
    const c = new THREE.CylinderGeometry(0.004, 0.009, len, 3, 1);
    c.translate(0, len / 2, 0);
    const dir = new THREE.Vector3(Math.cos(a), 0.55 + rand() * 0.4, Math.sin(a)).normalize();
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    setColor(c, () => [1, 1, 1]);
    parts.push(clean(c).toNonIndexed());
  }
  return mergeGeometries(parts);
}
