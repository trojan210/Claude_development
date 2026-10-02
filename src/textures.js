// Procedurally generated, tileable textures (no external image assets needed).
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

// Tileable value noise on a wrapped lattice
function makeTileNoise(period, seed) {
  const rand = mulberry32(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return (x, y) => {
    // x,y in [0,1)
    const fx = x * period, fy = y * period;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const x0 = ((ix % period) + period) % period, y0 = ((iy % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const a = g[y0 * period + x0], b = g[y0 * period + x1];
    const c = g[y1 * period + x0], d = g[y1 * period + x1];
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
}

function fbmTile(noises, x, y) {
  let s = 0, a = 1, n = 0;
  for (const f of noises) { s += f(x, y) * a; n += a; a *= 0.5; }
  return s / n;
}

function heightToNormal(h, size, strength) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = h[y * size + ((x - 1 + size) % size)];
      const xr = h[y * size + ((x + 1) % size)];
      const yu = h[((y - 1 + size) % size) * size + x];
      const yd = h[((y + 1) % size) * size + x];
      let nx = (xl - xr) * strength, ny = (yu - yd) * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

function dataTex(data, size, srgb) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Sand with wave-formed ripples. kind: 'volcanic' (Tulamben black sand) | 'coral' (white) */
export function makeSandTextures(kind, size = 512) {
  const n1 = makeTileNoise(8, 11), n2 = makeTileNoise(16, 12), n3 = makeTileNoise(32, 13);
  const n4 = makeTileNoise(128, 14), n5 = makeTileNoise(256, 15);
  const h = new Float32Array(size * size);
  const alb = new Uint8Array(size * size * 4);
  const rand = mulberry32(kind === 'volcanic' ? 77 : 99);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const warp = fbmTile([n1, n2, n3], u, v);
      // ripples: integer frequency keeps it tileable
      const ph = (u * 6 + v * 2) * Math.PI * 2 + warp * 9.0;
      let rip = Math.sin(ph);
      rip = rip > 0 ? Math.pow(rip, 0.7) : -Math.pow(-rip, 1.6) * 0.8; // asymmetric crest
      const grain = n5(u, v) * 0.6 + n4(u, v) * 0.4;
      const height = rip * 0.55 + grain * 0.35 + warp * 0.6;
      h[y * size + x] = height;
      // albedo
      const speck = rand();
      let r, g, b;
      if (kind === 'volcanic') {
        const base = 0.2 + grain * 0.1 + (rip * 0.5 + 0.5) * 0.05;
        r = base * 1.0; g = base * 0.96; b = base * 0.92;
        if (speck > 0.985) { r += 0.35; g += 0.33; b += 0.3; } // quartz / shell fragments
        else if (speck > 0.96) { r += 0.08; g += 0.06; b += 0.04; }
      } else {
        const base = 0.62 + grain * 0.18 + (rip * 0.5 + 0.5) * 0.06;
        r = base * 1.0; g = base * 0.95; b = base * 0.84;
        if (speck > 0.985) { r *= 0.55; g *= 0.5; b *= 0.45; } // dark grains
        else if (speck > 0.97) { r += 0.12; g += 0.1; b += 0.12; }
      }
      const i = (y * size + x) * 4;
      alb[i] = Math.min(255, r * 255); alb[i + 1] = Math.min(255, g * 255); alb[i + 2] = Math.min(255, b * 255); alb[i + 3] = 255;
    }
  }
  return {
    map: dataTex(alb, size, true),
    normalMap: dataTex(heightToNormal(h, size, 3.5), size, false),
  };
}

/** Rock / reef-substrate texture (encrusted limestone or lava rock). */
export function makeRockTextures(kind, size = 512) {
  const ns = [4, 8, 16, 32, 64, 128].map((p, i) => makeTileNoise(p, 200 + i + (kind === 'volcanic' ? 0 : 50)));
  const h = new Float32Array(size * size);
  const alb = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const f = fbmTile(ns, u, v);
      const pits = Math.pow(ns[4](u, v), 3.0);
      const height = f - pits * 0.6;
      h[y * size + x] = height;
      const enc = ns[2](u, v); // encrusting algae / sponge patches
      let r, g, b;
      if (kind === 'volcanic') {
        r = 0.12 + f * 0.12; g = 0.11 + f * 0.11; b = 0.1 + f * 0.1;
      } else {
        r = 0.45 + f * 0.25; g = 0.42 + f * 0.22; b = 0.36 + f * 0.2;
      }
      // coralline algae (pink/purple) and turf algae (olive)
      if (enc > 0.62) { const t = Math.min(1, (enc - 0.62) * 5); r += t * 0.35; g += t * 0.08; b += t * 0.2; }
      else if (enc < 0.32) { const t = Math.min(1, (0.32 - enc) * 5); r += t * 0.06; g += t * 0.12; b -= t * 0.02; }
      const ao = 1 - pits * 0.7;
      const i = (y * size + x) * 4;
      alb[i] = Math.min(255, r * ao * 255); alb[i + 1] = Math.min(255, g * ao * 255); alb[i + 2] = Math.min(255, Math.max(0, b * ao) * 255); alb[i + 3] = 255;
    }
  }
  return {
    map: dataTex(alb, size, true),
    normalMap: dataTex(heightToNormal(h, size, 9.0), size, false),
  };
}

/** Gorgonian sea fan: a fractal lattice drawn on a canvas, used with alphaTest. */
export function makeFanTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const rand = mulberry32(5);
  g.clearRect(0, 0, size, size);
  g.lineCap = 'round';
  g.strokeStyle = '#fff';
  const branch = (x, y, ang, len, w, depth) => {
    if (depth <= 0 || len < 4) return;
    const x2 = x + Math.sin(ang) * len, y2 = y - Math.cos(ang) * len;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    const mx = (x + x2) / 2 + (rand() - 0.5) * len * 0.3, my = (y + y2) / 2;
    g.quadraticCurveTo(mx, my, x2, y2);
    g.stroke();
    const n = depth > 5 ? 2 : 2 + (rand() > 0.6 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const spread = 0.35 + rand() * 0.45;
      branch(x2, y2, ang + (i - (n - 1) / 2) * spread + (rand() - 0.5) * 0.2, len * (0.72 + rand() * 0.12), Math.max(1.0, w * 0.72), depth - 1);
    }
  };
  for (let k = 0; k < 3; k++) branch(size / 2 + (k - 1) * 8, size, (k - 1) * 0.5, size * 0.2, 9, 9);
  // cross-links (anastomoses) give the net-like look
  g.globalAlpha = 0.85;
  g.lineWidth = 1.4;
  const img = g.getImageData(0, 0, size, size).data;
  for (let i = 0; i < 2600; i++) {
    const x = rand() * size, y = rand() * size * 0.9;
    const idx = ((y | 0) * size + (x | 0)) * 4 + 3;
    if (img[idx] > 0) {
      const a = rand() * Math.PI * 2, l = 4 + rand() * 9;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Soft round sprite for particles. */
export function makeSpriteTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

/** Coral polyp / corallite texture: tileable Voronoi cells (height -> normal map, cavity -> AO). */
export function makePolypTextures(size = 256, cells = 14, seed = 3) {
  const rand = mulberry32(seed);
  const pts = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + rand()) / cells, (j + rand()) / cells]);
  const h = new Float32Array(size * size);
  const ao = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const ci = Math.floor(u * cells), cj = Math.floor(v * cells);
      let d1 = 9, d2 = 9;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (ci + di + cells) % cells, jj = (cj + dj + cells) % cells;
        const p = pts[jj * cells + ii];
        const px = p[0] + Math.floor((ci + di) / cells) * 1 + (ci + di < 0 ? 0 : 0);
        let dx = u - (p[0] + (ci + di - ii) / cells), dy = v - (p[1] + (cj + dj - jj) / cells);
        void px;
        const d = Math.hypot(dx, dy) * cells;
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      // cup-shaped corallite with a raised wall between cells
      const wall = Math.min(1, (d2 - d1) * 2.2);
      const cup = Math.max(0, 1 - d1 * 1.6);
      const height = (1 - Math.pow(1 - wall, 3)) * 0.8 - cup * 0.6;
      h[y * size + x] = height;
      const a = Math.max(0, Math.min(1, 0.55 + height * 0.6));
      const i = (y * size + x) * 4;
      ao[i] = ao[i + 1] = ao[i + 2] = a * 255; ao[i + 3] = 255;
    }
  }
  return { normalMap: dataTex(heightToNormal(h, size, 2.2), size, false), aoMap: dataTex(ao, size, false) };
}
