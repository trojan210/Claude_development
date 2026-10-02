// Seabed heightfield: sand ripples, lava rock / limestone, height queries for physics.
import * as THREE from 'three';
import { patchUW } from './water.js';
import { makeSandTextures, makeRockTextures } from './textures.js';

export const WORLD_HALF = 220;

export class Terrain {
  constructor(site, quality) {
    this.site = site;
    const seg = quality.terrainSeg;
    this.seg = seg;
    this.size = WORLD_HALF * 2;
    const geo = new THREE.PlaneGeometry(this.size, this.size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const rock = new Float32Array(pos.count);
    this.heights = new Float32Array((seg + 1) * (seg + 1));
    this.rocks = new Float32Array((seg + 1) * (seg + 1));
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const { h, rock: r } = site.height(x, z);
      pos.setY(i, h);
      rock[i] = r;
      uv.setXY(i, x / 4, z / 4);
    }
    // PlaneGeometry vertex order: rows along z (from -half to +half after rotation), cols along x
    for (let iz = 0; iz <= seg; iz++) {
      for (let ix = 0; ix <= seg; ix++) {
        const vi = iz * (seg + 1) + ix;
        this.heights[iz * (seg + 1) + ix] = pos.getY(vi);
        this.rocks[iz * (seg + 1) + ix] = rock[vi];
      }
    }
    // verify orientation of rows (rotateX(-PI/2) maps plane +y to -z)
    this.zFlip = pos.getZ(0) > pos.getZ(pos.count - 1);
    geo.setAttribute('aRock', new THREE.BufferAttribute(rock, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const sand = makeSandTextures(site.sand, quality.texSize);
    const rockT = makeRockTextures(site.sand === 'volcanic' ? 'volcanic' : 'lime', quality.texSize);
    this.rockTex = rockT;
    const mat = new THREE.MeshStandardMaterial({
      map: sand.map,
      normalMap: sand.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.95,
      metalness: 0,
    });
    patchUW(mat, {
      key: 'terrain',
      uniforms: {
        uRockMap: { value: rockT.map },
        uRockNormal: { value: rockT.normalMap },
        uSandMap: { value: sand.map },
      },
      vertex: {
        pars: 'attribute float aRock; varying float vRock; varying vec2 vWUv;',
        begin: 'vRock = aRock; vWUv = position.xz;',
      },
      fragPars: `uniform sampler2D uRockMap; uniform sampler2D uRockNormal; uniform sampler2D uSandMap;
        varying float vRock; varying vec2 vWUv;
        float tHash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float tNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(tHash(i),tHash(i+vec2(1,0)),f.x), mix(tHash(i+vec2(0,1)),tHash(i+vec2(1,1)),f.x), f.y); }`,
      fragColor: `
        // break up tiling with a second, rotated scale and large-scale tone variation
        vec2 ruv = mat2(0.8, -0.6, 0.6, 0.8) * vWUv / 11.0;
        vec3 sand2 = texture2D(uSandMap, ruv).rgb;
        float large = tNoise(vWUv * 0.05) * 0.6 + tNoise(vWUv * 0.17) * 0.4;
        diffuseColor.rgb = mix(diffuseColor.rgb, sand2, 0.45) * (0.8 + large * 0.45);
        float rockMask = smoothstep(0.15, 0.6, vRock + (tNoise(vWUv * 0.6) - 0.5) * 0.35);
        // triplanar on rock so steep boulder faces are not stretched
        vec3 tWp = (vec4(-vViewPosition, 0.0) * viewMatrix).xyz + cameraPosition;
        vec3 tNw = inverseTransformDirection(normalize(vNormal), viewMatrix);
        vec3 tw = pow(abs(tNw), vec3(4.0)); tw /= tw.x + tw.y + tw.z;
        vec3 rockCol = (texture2D(uRockMap, tWp.zy / 5.0).rgb * tw.x + texture2D(uRockMap, tWp.xz / 5.0).rgb * tw.y + texture2D(uRockMap, tWp.xy / 5.0).rgb * tw.z)
          * (0.85 + tNoise(vWUv * 0.3) * 0.3);
        diffuseColor.rgb = mix(diffuseColor.rgb, rockCol, rockMask);
      `,
      fragNormal: `
        {
          vec3 nWr = inverseTransformDirection(normal, viewMatrix);
          vec3 nR = uwTriplanarNormal(uRockNormal, tWp, nWr, 0.2, 1.4);
          normal = normalize(mix(normal, (viewMatrix * vec4(nR, 0.0)).xyz, rockMask));
        }
      `,
    });
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
  }

  _sample(arr, x, z) {
    const seg = this.seg;
    let fx = ((x + WORLD_HALF) / this.size) * seg;
    let fz = ((z + WORLD_HALF) / this.size) * seg;
    if (this.zFlip) fz = seg - fz;
    fx = Math.min(Math.max(fx, 0), seg - 0.0001);
    fz = Math.min(Math.max(fz, 0), seg - 0.0001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const w = seg + 1;
    const a = arr[iz * w + ix], b = arr[iz * w + ix + 1];
    const c = arr[(iz + 1) * w + ix], d = arr[(iz + 1) * w + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  heightAt(x, z) { return this._sample(this.heights, x, z); }
  rockAt(x, z) { return this._sample(this.rocks, x, z); }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.5;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }
}
