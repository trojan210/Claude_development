// Reef population: scatters coral, sponges, fans and anemones over the seabed in
// spatial chunks of instanced meshes (frustum + distance culled).
import * as THREE from 'three';
import { patchUW } from './water.js';
import * as G from './reefgeo.js';
import { makeFanTexture, makePolypTextures } from './textures.js';
import { mulberry32, Simplex, smoothstep } from './noise.js';
import { WORLD_HALF } from './terrain.js';

const CHUNK = 55;

const hex = (h) => new THREE.Color(h);
const PALETTES = {
  boulder: ['#b59a6a', '#8f7a4f', '#7d8a5a', '#8a6a86', '#9aa08a', '#c0a070', '#6f8f6a'],
  branch: ['#c8b38a', '#9a7fb5', '#7fa4c9', '#9ab07a', '#c99a9a', '#b8a580', '#d4c49a'],
  table: ['#a89c78', '#8a9a8a', '#b2a07a', '#9a8f9f'],
  soft: ['#e0507a', '#ff6a3c', '#c04ad0', '#f2d6dc', '#b5a77d', '#d88a3a', '#a7b07d'],
  fan: ['#c0302a', '#e07028', '#e0c040', '#d0507a', '#b02a3a'],
  barrel: ['#8a4a3a', '#6a5a4a', '#7a4636'],
  tube: ['#7a3aa0', '#e0b030', '#3a6ab0', '#c06a30'],
  anemone: ['#d8c08a', '#c8b07a', '#9ac080'],
  crinoid: ['#e8c030', '#202020', '#c03020', '#f0f0e0', '#40a060'],
  rock: ['#5a5650', '#4a4844', '#6a645a'],
};

function makeMat(opts) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: opts.roughness ?? 0.85,
    metalness: 0,
    side: opts.side ?? THREE.FrontSide,
    map: opts.map || null,
    alphaTest: opts.alphaTest || 0,
  });
  const sway = opts.sway || 0;
  const det = opts.detail;
  patchUW(m, {
    uniforms: det ? { uDetailN: { value: det.tex.normalMap }, uDetailAO: { value: det.tex.aoMap } } : undefined,
    fragPars: det ? 'uniform sampler2D uDetailN; uniform sampler2D uDetailAO;' : '',
    fragColor: det ? `
      vec3 dWp = (vec4(-vViewPosition, 0.0) * viewMatrix).xyz + cameraPosition;
      vec3 dNw = inverseTransformDirection(normalize(vNormal), viewMatrix);
      float dAO = uwTriplanarScalar(uDetailAO, dWp, dNw, ${(1 / det.scale).toFixed(3)});
      diffuseColor.rgb *= mix(1.0, 0.55 + dAO * 0.6, ${det.ao.toFixed(2)});` : '',
    fragNormal: det ? `
      {
        vec3 nWd = inverseTransformDirection(normal, viewMatrix);
        nWd = uwTriplanarNormal(uDetailN, dWp, nWd, ${(1 / det.scale).toFixed(3)}, ${det.strength.toFixed(2)});
        normal = normalize((viewMatrix * vec4(nWd, 0.0)).xyz);
      }` : '',
    key: 'reef-' + opts.key,
    vertex: sway
      ? {
        pars: '',
        begin: `
          vec3 ip = vec3(instanceMatrix[3]);
          float sw = sin(uTime * 0.9 + ip.x * 0.31 + ip.z * 0.17) + 0.45 * sin(uTime * 2.1 + ip.x * 1.7);
          float hh = max(transformed.y, 0.0);
          transformed.x += sw * ${sway.toFixed(3)} * hh * hh;
          transformed.z += sw * ${(sway * 0.5).toFixed(3)} * hh * hh;`,
      }
      : null,
    ambient: opts.ambient ?? 1,
    fragEnd: opts.fragEnd,
  });
  return m;
}

export class Reef {
  constructor(site, terrain, quality, exclude) {
    this.group = new THREE.Group();
    this.chunks = [];
    this.anemones = [];
    this.heads = [];
    this.colliders = [];
    const fanTex = makeFanTexture(quality.texSize);
    const polyp = makePolypTextures(256, 14, 3);
    const brainTex = makePolypTextures(256, 6, 8);
    const fine = makePolypTextures(256, 22, 5);
    const D = (tex, scale, strength, ao) => ({ tex, scale, strength, ao });
    const dens = site.reefDensity * quality.reefDensity;

    const types = [
      { key: 'boulder', geo: G.boulderCoral(quality.high ? 4 : 3), mat: makeMat({ key: 'boulder', detail: D(polyp, 0.32, 1.0, 0.7) }), n: 2600, s: [0.35, 1.6], shadow: true },
      { key: 'brain', geo: G.boulderCoral(quality.high ? 4 : 3, true), mat: makeMat({ key: 'brain', detail: D(brainTex, 0.25, 1.6, 0.9) }), n: 900, s: [0.3, 0.9], pal: 'boulder', shadow: true },
      { key: 'branch', geo: G.branchingCoral(7), mat: makeMat({ key: 'branch', detail: D(fine, 0.12, 0.7, 0.5) }), n: 1500, s: [0.5, 1.3], shadow: true },
      { key: 'branch2', geo: G.branchingCoral(19), mat: makeMat({ key: 'branch2', detail: D(fine, 0.12, 0.7, 0.5) }), n: 1100, s: [0.4, 1.0], pal: 'branch', shadow: true },
      { key: 'table', geo: G.tableCoral(), mat: makeMat({ key: 'table', detail: D(fine, 0.2, 0.9, 0.6) }), n: 520, s: [0.5, 1.5], shadow: true },
      { key: 'soft', geo: G.softCoral(3), mat: makeMat({ key: 'soft', sway: 0.12, roughness: 0.7, ambient: 1.25, detail: D(fine, 0.1, 0.5, 0.35) }), n: 1800, s: [0.4, 1.0] },
      { key: 'fan', geo: G.seaFan(), mat: makeMat({ key: 'fan', map: fanTex, alphaTest: 0.45, side: THREE.DoubleSide, sway: 0.035, ambient: 1.2 }), n: 650, s: [0.5, 1.4] },
      { key: 'barrel', geo: G.barrelSponge(), mat: makeMat({ key: 'barrel', detail: D(polyp, 0.5, 1.2, 0.6) }), n: 300, s: [0.6, 1.5], shadow: true },
      { key: 'tube', geo: G.tubeSponges(9), mat: makeMat({ key: 'tube' }), n: 700, s: [0.6, 1.3] },
      { key: 'anemone', geo: G.anemone(4), mat: makeMat({ key: 'anemone', sway: 0.9, roughness: 0.6, ambient: 1.3 }), n: 170, s: [0.8, 1.5] },
      { key: 'crinoid', geo: G.crinoid(6), mat: makeMat({ key: 'crinoid', sway: 0.6 }), n: 600, s: [0.7, 1.4] },
      { key: 'rock', geo: G.reefRock(5), mat: makeMat({ key: 'rock', roughness: 0.95, detail: D(polyp, 0.9, 1.4, 0.8) }), n: 900, s: [0.5, 2.2], shadow: true },
    ];
    this.types = types;

    const rand = mulberry32(site.id === 'tulamben' ? 31337 : 4711);
    const patch = new Simplex(site.id === 'tulamben' ? 99 : 98);
    const nChunks = Math.ceil((WORLD_HALF * 2) / CHUNK);
    const buckets = types.map(() => new Map());
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const lim = WORLD_HALF - 25;

    types.forEach((t, ti) => {
      const pal = PALETTES[t.pal || t.key];
      const target = Math.floor(t.n * dens);
      let placed = 0, tries = 0;
      while (placed < target && tries < target * 12) {
        tries++;
        const x = (rand() * 2 - 1) * lim, z = (rand() * 2 - 1) * lim;
        if (exclude && exclude(x, z)) continue;
        const h = terrain.heightAt(x, z);
        const depth = -h;
        if (depth < 1.8 || depth > 42) continue;
        const rock = terrain.rockAt(x, z);
        terrain.normalAt(x, z, nrm);
        const reefy = smoothstep(-0.1, 0.45, patch.fbm2(x * 0.03, z * 0.03, 3)) * 0.7 + rock * 0.8;
        let prob;
        switch (t.key) {
          case 'rock': prob = 0.15 + rock * 0.5; break;
          case 'fan': prob = reefy * smoothstep(6, 14, depth) * (0.4 + (1 - nrm.y) * 2.5); break;
          case 'table': case 'branch': case 'branch2': prob = reefy * smoothstep(30, 10, depth); break;
          case 'barrel': prob = reefy * smoothstep(8, 16, depth); break;
          case 'anemone': prob = reefy * smoothstep(20, 6, depth) * 0.8; break;
          default: prob = reefy;
        }
        if (rand() > prob) continue;
        placed++;
        const s = t.s[0] + Math.pow(rand(), 1.6) * (t.s[1] - t.s[0]);
        const tiltToNormal = t.key === 'fan' ? 0.2 : 0.65;
        q.setFromUnitVectors(up, nrm.clone().lerp(up, 1 - tiltToNormal).normalize());
        qy.setFromAxisAngle(up, rand() * Math.PI * 2);
        if (t.key === 'fan') {
          // fans grow perpendicular to the prevailing current
          qy.setFromAxisAngle(up, 0.3 + (rand() - 0.5) * 0.6);
        }
        q.multiply(qy);
        const sink = t.key === 'rock' ? 0.35 * s : t.key === 'boulder' || t.key === 'brain' ? 0.08 * s : 0.03;
        p.set(x, h - sink, z);
        sc.set(s * (0.85 + rand() * 0.3), s * (0.8 + rand() * 0.4), s * (0.85 + rand() * 0.3));
        m4.compose(p, q, sc);
        const col = hex(pal[Math.floor(rand() * pal.length)]);
        col.offsetHSL((rand() - 0.5) * 0.03, (rand() - 0.5) * 0.15, (rand() - 0.5) * 0.08);
        col.multiplyScalar(1.5);
        const cx = Math.min(nChunks - 1, Math.floor((x + WORLD_HALF) / CHUNK));
        const cz = Math.min(nChunks - 1, Math.floor((z + WORLD_HALF) / CHUNK));
        const key = cz * nChunks + cx;
        let b = buckets[ti].get(key);
        if (!b) { b = { m: [], c: [] }; buckets[ti].set(key, b); }
        b.m.push(m4.clone()); b.c.push(col);
        if (t.key === 'anemone') this.anemones.push(new THREE.Vector3(x, h + 0.2 * s, z));
        if ((t.key === 'boulder' || t.key === 'branch' || t.key === 'table') && s > 0.8) this.heads.push(new THREE.Vector3(x, h + s * 0.7, z));
        if ((t.key === 'boulder' || t.key === 'rock' || t.key === 'barrel') && s > 0.7) {
          this.colliders.push({ c: new THREE.Vector3(x, h + s * 0.25, z), r: s * 0.8 });
        }
      }
    });

    // build chunk groups
    const chunkMap = new Map();
    types.forEach((t, ti) => {
      for (const [key, b] of buckets[ti]) {
        let ch = chunkMap.get(key);
        if (!ch) {
          const cx = key % nChunks, cz = Math.floor(key / nChunks);
          ch = { group: new THREE.Group(), center: new THREE.Vector2(-WORLD_HALF + (cx + 0.5) * CHUNK, -WORLD_HALF + (cz + 0.5) * CHUNK) };
          chunkMap.set(key, ch);
          this.group.add(ch.group);
          this.chunks.push(ch);
        }
        const im = new THREE.InstancedMesh(t.geo, t.mat, b.m.length);
        for (let i = 0; i < b.m.length; i++) { im.setMatrixAt(i, b.m[i]); im.setColorAt(i, b.c[i]); }
        im.instanceMatrix.needsUpdate = true;
        im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = !!t.shadow && quality.reefShadows;
        im.receiveShadow = true;
        ch.group.add(im);
      }
    });
  }

  update(camPos, viewDist) {
    const r = viewDist + CHUNK * 0.75;
    for (const ch of this.chunks) {
      const dx = ch.center.x - camPos.x, dz = ch.center.y - camPos.z;
      ch.group.visible = dx * dx + dz * dz < r * r;
    }
  }
}
