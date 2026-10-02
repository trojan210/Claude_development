import * as THREE from 'three';
import { SITES } from './sites.js';
import { U, setWaterProfile, setSun } from './water.js';
import { Caustics } from './caustics.js';
import { Post } from './post.js';
import { Surface } from './surface.js';
import { Terrain, WORLD_HALF } from './terrain.js';
import { Reef } from './reef.js';
import { Wreck } from './wreck.js';
import { FishManager } from './fish.js';
import { makeCreatures, Mantas, Turtles } from './creatures.js';
import { MarineSnow, Bubbles, Silt } from './particles.js';
import { Diver } from './diver.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { HUD, LOGBOOK } from './hud.js';
import { ambient } from './deco.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

function qualityPreset(name) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (name === 'auto') name = isTouch ? 'low' : 'high';
  const presets = {
    high: { pixelRatio: Math.min(dpr, 1.5), msaa: 4, shaftSteps: 22, terrainSeg: 300, surfaceSeg: 128, texSize: 512, reefDensity: 1, fishDensity: 1, bloom: true, shadowSize: 2048, reefShadows: true, high: true, snow: 5000, viewDist: 75 },
    medium: { pixelRatio: Math.min(dpr, 1.25), msaa: 2, shaftSteps: 14, terrainSeg: 220, surfaceSeg: 96, texSize: 512, reefDensity: 0.7, fishDensity: 0.7, bloom: true, shadowSize: 1024, reefShadows: false, high: false, snow: 3500, viewDist: 62 },
    low: { pixelRatio: Math.min(dpr, 1.0), msaa: 0, shaftSteps: 8, terrainSeg: 160, surfaceSeg: 64, texSize: 256, reefDensity: 0.32, fishDensity: 0.4, bloom: false, shadowSize: 0, reefShadows: false, high: false, snow: 2000, viewDist: 48 },
  };
  return { name, ...presets[name] };
}

// ------------------------------------------------------------------ title screen
let selectedSite = 'tulamben';
function buildSiteCards() {
  const wrap = $('sites');
  wrap.innerHTML = Object.values(SITES).map((s) => `
    <div class="site ${s.id === selectedSite ? 'sel' : ''}" data-id="${s.id}">
      <h3>${s.name}</h3><div class="area">${s.area}</div>
      <p>${s.blurb}</p>
      <dl><dt>水深</dt><dd>${s.depthRange}</dd><dt>水温</dt><dd>${s.temp}°C</dd><dt>透明度</dt><dd>${s.visibility}</dd></dl>
    </div>`).join('');
  wrap.querySelectorAll('.site').forEach((el) => el.addEventListener('click', () => {
    selectedSite = el.dataset.id;
    buildSiteCards();
  }));
}
buildSiteCards();
if (isTouch) $('opt-mode').value = 'easy';

const audio = new Audio();
let game = null;

$('btn-start').addEventListener('click', async () => {
  const opts = {
    site: SITES[selectedSite],
    mode: $('opt-mode').value,
    quality: qualityPreset($('opt-quality').value),
    sound: $('opt-sound').checked,
  };
  if (opts.sound) audio.start();
  audio.enabled = opts.sound;
  $('title').classList.remove('show');
  $('loading').classList.add('show');
  try {
    if (game) game.dispose();
    game = new Game(opts);
    await game.build((t) => { $('load-text').textContent = t; });
    $('loading').classList.remove('show');
    game.start();
  } catch (err) {
    console.error(err);
    $('load-text').textContent = 'エラー: ' + err.message;
  }
});

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// ------------------------------------------------------------------ game
class Game {
  constructor(opts) {
    this.opts = opts;
    this.site = opts.site;
    this.q = opts.quality;
    this.frame = 0;
    this.paused = false;
    this.ended = false;
  }

  async build(progress) {
    const { site, q } = this;
    progress('レンダラーを初期化…'); await nextFrame();
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false }));
    renderer.setPixelRatio(q.pixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 1);
    if (q.shadowSize) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    $('app').innerHTML = '';
    $('app').appendChild(renderer.domElement);

    setWaterProfile(site);
    setSun(site.sun.elevation, site.sun.azimuth);
    U.uSkyColor.value.setRGB(...site.sky);

    const scene = (this.scene = new THREE.Scene());
    const camera = (this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 260));

    // sunlight (attenuated per fragment by depth inside the patched materials)
    const sun = (this.sun = new THREE.DirectionalLight(0xffffff, 1));
    sun.color.copy(U.uSunColor.value);
    sun.intensity = 1;
    if (q.shadowSize) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      const s = sun.shadow.camera;
      s.left = -34; s.right = 34; s.top = 34; s.bottom = -34; s.near = 1; s.far = 140;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.04;
      sun.shadow.radius = 4;
    }
    scene.add(sun, sun.target);

    // dive torch
    const torch = (this.torch = new THREE.SpotLight(0xfff4e0, 0, 40, THREE.MathUtils.degToRad(17), 0.45, 1.2));
    torch.castShadow = false;
    scene.add(torch, torch.target);
    this.torchOn = false;

    progress('カスティクスを生成…'); await nextFrame();
    this.caustics = new Caustics(renderer, q.high ? 512 : 256, q.high ? 192 : q.name === 'medium' ? 128 : 96);
    this.caustics.update();

    progress('海底地形を生成…'); await nextFrame();
    const terrain = (this.terrain = new Terrain(site, q));
    scene.add(terrain.mesh);

    let footprint = null;
    if (site.wreck) {
      const W = site.wreck;
      footprint = (x, z) => {
        const dx = x - W.x, dz = z - W.z;
        const c = Math.cos(W.rotY), s = Math.sin(W.rotY);
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        return Math.abs(lx) < 64 && Math.abs(lz) < 15;
      };
    }

    progress('サンゴ礁を育成…'); await nextFrame();
    const reef = (this.reef = new Reef(site, terrain, q, footprint));
    scene.add(reef.group);

    if (site.wreck) {
      progress('リバティ号を沈めています…'); await nextFrame();
      this.wreck = new Wreck(site, terrain, reef, q);
      scene.add(this.wreck.group);
    }

    progress('魚たちを放流…'); await nextFrame();
    this.fish = new FishManager(site, terrain, reef, this.wreck, q, renderer);
    scene.add(this.fish.group);
    this.creatures = makeCreatures(site, terrain, q);
    for (const c of this.creatures) scene.add(c.group);

    this.surface = new Surface(q);
    this.surface.material.uniforms.uCWaves.value = this.caustics.mat.uniforms.uWaves.value;
    scene.add(this.surface.mesh);
    this.snow = new MarineSnow(q.snow, 24);
    scene.add(this.snow.points);
    this.bubbles = new Bubbles(700);
    scene.add(this.bubbles.points);
    this.silt = new Silt(q.high ? 320 : 180);
    this.silt.setColor(site.sand === 'volcanic' ? 0x2f2c29 : 0x9a9488);
    scene.add(this.silt.points);

    progress('ポストエフェクトを構築…'); await nextFrame();
    this.post = new Post(renderer, q);

    // collider spatial hash for coral heads
    this.colGrid = new Map();
    for (const c of reef.colliders) {
      const k = `${Math.floor(c.c.x / 4)},${Math.floor(c.c.z / 4)}`;
      if (!this.colGrid.has(k)) this.colGrid.set(k, []);
      this.colGrid.get(k).push(c);
    }

    this.input = new Input(renderer.domElement);
    this.hud = new HUD();
    this.diver = new Diver(site, camera, { mode: this.opts.mode });
    this.hud.setMode(this.opts.mode, isTouch);
    const keys = ['jack', 'anthias', 'fusilier', 'butterfly', 'parrot', 'surgeon', 'clown', 'turtle', 'manta']
      .filter((k) => site.species.includes(k) || (k === 'clown' && reef.anemones.length));
    if (site.wreck) keys.unshift('wreck');
    this.hud.renderLog(keys);

    progress('シェーダーをコンパイル…'); await nextFrame();
    this.diver.update(0.001, this.input, this.worldCtx());
    this.updateLights();
    renderer.compile(scene, camera);
    this.post.render(scene, camera, 0);

    addEventListener('resize', (this.onResize = () => this.resize()));
    this.bindUI();
  }

  worldCtx() {
    return {
      terrain: this.terrain,
      wreck: this.wreck,
      current: U.uCurrent.value,
      limit: WORLD_HALF - 40,
      silt: (p, n, s) => this.silt.emit(p, n, s),
      colliders: (p) => {
        const out = [];
        const cx = Math.floor(p.x / 4), cz = Math.floor(p.z / 4);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
          const a = this.colGrid.get(`${cx + i},${cz + j}`);
          if (a) out.push(...a);
        }
        return out;
      },
    };
  }

  bindUI() {
    const ui = {
      stick: $('stick'), knob: $('knob'), btnUp: $('tb-up'), btnDown: $('tb-down'), btnFast: $('tb-fast'),
      btnLight: $('tb-light'), btnPhoto: $('tb-photo'), btnLog: $('tb-log'), btnPause: $('tb-pause'),
    };
    if (isTouch) this.input.bindTouch(ui);
    $('btn-resume').onclick = () => this.setPaused(false);
    $('btn-surface').onclick = () => this.endDive('surface');
    $('btn-again').onclick = () => {
      $('summary').classList.remove('show');
      $('title').classList.add('show');
      $('hud').classList.add('hidden');
      $('touch').classList.add('hidden');
    };
    document.addEventListener('pointerlockchange', (this.onLock = () => {
      if (!document.pointerLockElement && !this.paused && !this.ended && !isTouch && this.started && !this.logOpen) this.setPaused(true);
    }));
    document.addEventListener('visibilitychange', (this.onVis = () => { if (document.hidden && !this.ended) this.setPaused(true); }));
  }

  start() {
    $('hud').classList.remove('hidden');
    if (isTouch) $('touch').classList.remove('hidden');
    this.input.enabled = true;
    this.started = true;
    this.clock = new THREE.Timer();
    this.clock.connect?.(document);
    this.hud.message(this.site.wreck ? 'エントリー完了。沖へ向かうとリバティ号が見えてきます' : 'エントリー完了。台地の先でマンタが待っています', 5);
    if (!isTouch) this.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
    this.audioNear = 0;
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  setPaused(p) {
    if (this.ended) return;
    this.paused = p;
    $('pause').classList.toggle('show', p);
    if (p) { audio.suspend(); document.exitPointerLock?.(); } else {
      audio.resume();
      this.clock.update();
      if (!isTouch) this.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
    }
  }

  resize() {
    const r = this.renderer;
    r.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    const s = r.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(s.x, s.y);
  }

  updateLights() {
    const cam = this.camera;
    // shadow frustum follows the diver, snapped to texels to avoid shimmering
    const sd = U.uSunDirW.value;
    const tgt = cam.position.clone();
    tgt.y = Math.min(tgt.y, this.terrain.heightAt(tgt.x, tgt.z) + 6);
    const snap = 68 / (this.q.shadowSize || 1024);
    tgt.x = Math.round(tgt.x / snap) * snap; tgt.z = Math.round(tgt.z / snap) * snap;
    this.sun.target.position.copy(tgt);
    this.sun.position.copy(tgt).addScaledVector(sd, 70);
    // torch is held in the right hand slightly below the eyes
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    this.torch.position.copy(cam.position).addScaledVector(right, 0.25).addScaledVector(up, -0.22).addScaledVector(fwd, 0.3);
    this.torch.target.position.copy(cam.position).addScaledVector(fwd, 10);
    this.torch.intensity = this.torchOn ? 60 : 0;
    U.uTorchOn.value = this.torchOn ? 1 : 0;
    U.uTorchPos.value.copy(this.torch.position);
    U.uTorchDir.value.copy(this.torch.target.position).sub(this.torch.position).normalize();
  }

  tick() {
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    const input = this.input;
    if (input.wasPressed('Escape') && isTouch) this.setPaused(!this.paused);
    if (this.paused || this.ended) { input.clearPressed(); input.consumeLook(); return; }
    this.frame++;
    U.uTime.value += dt;
    const t = U.uTime.value;

    if (input.wasPressed('KeyF')) { this.torchOn = !this.torchOn; audio.click?.(audio.ctx?.currentTime ?? 0, 0.1); }
    if (input.wasPressed('Tab')) { this.logOpen = !this.logOpen; this.hud.toggleLog(this.logOpen); if (this.logOpen) document.exitPointerLock?.(); else if (!isTouch) this.renderer.domElement.requestPointerLock?.()?.catch?.(() => {}); }
    const photo = input.wasPressed('KeyP');

    const d = this.diver;
    const ctx = this.worldCtx();
    d.update(dt, input, ctx);
    for (const e of d.drainEvents()) {
      if (e === 'exhale') {
        audio.exhale(d.depth);
        // exhaust tee sits beside the mouth, below the mask: bubbles rise past the face
        const fwd = new THREE.Vector3(-Math.sin(d.yaw), 0, -Math.cos(d.yaw));
        const side = new THREE.Vector3(Math.cos(d.yaw), 0, -Math.sin(d.yaw));
        const o = d.pos.clone().addScaledVector(fwd, 0.12).addScaledVector(side, 0.12 * (Math.random() < 0.5 ? -1 : 1));
        o.y -= 0.18;
        this.exhaleBurst = { o, t: 1.6 };
      } else if (e === 'inhale') audio.inhale(d.depth, 1 + d.exertion * 0.5);
      else if (e === 'safety-done') this.hud.message('安全停止完了。ゆっくり浮上しましょう', 4);
    }
    if (this.exhaleBurst) {
      const b = this.exhaleBurst;
      b.t -= dt;
      const fwd = new THREE.Vector3(-Math.sin(d.yaw), 0, -Math.cos(d.yaw));
      b.o.copy(d.pos).addScaledVector(fwd, 0.1); b.o.y -= 0.2;
      this.bubbles.emit(b.o, Math.floor(dt * 260 * Math.min(1, b.t)), 0.08, 0.06);
      if (b.t <= 0) this.exhaleBurst = null;
    }
    // fin kick sounds
    if (d.kickPower > 0.15 && Math.sin(d.kickPhase) > 0.98 && !this.kicked) { audio.kick(d.kickPower); this.kicked = true; }
    if (Math.sin(d.kickPhase) < 0.5) this.kicked = false;

    this.updateLights();
    this.caustics.update();
    this.surface.update(this.camera);
    this.reef.update(this.camera.position, this.q.viewDist);
    const env = Math.exp(-0.06 * d.depth);
    const fctx = { diver: d.pos, diverSpeed: d.speed, terrain: this.terrain, time: t, envScale: env };
    this.fish.update(dt, fctx);
    for (const c of this.creatures) c.update(dt, fctx);
    const pxScale = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.snow.update(this.camera, pxScale);
    this.bubbles.update(dt, t, pxScale);
    this.silt.update(dt, pxScale);

    // eye adaptation: partially compensate for the light lost with depth
    const kd = U.uKd.value;
    const lum = 0.2126 * Math.exp(-kd.x * d.depth) + 0.7152 * Math.exp(-kd.y * d.depth) + 0.0722 * Math.exp(-kd.z * d.depth);
    // looking up toward Snell's window the eye stops down
    const lookUp = THREE.MathUtils.smoothstep(d.pitch, 0.1, 1.2);
    const targetExp = 3.0 * Math.pow(1 / Math.max(lum, 0.02), 0.55) * (1 - 0.72 * lookUp);
    this.exposure = this.exposure ? this.exposure + (targetExp - this.exposure) * Math.min(1, dt * 1.2) : targetExp;
    this.post.final.uniforms.uExposure.value = this.exposure;
    // partial chromatic adaptation (von Kries): the eye re-balances the blue-green ambient light
    const amb = [Math.exp(-kd.x * (d.depth + 4)), Math.exp(-kd.y * (d.depth + 4)), Math.exp(-kd.z * (d.depth + 4))];
    const ka = 0.32;
    const wb = amb.map((a) => Math.pow(1 / Math.max(a, 1e-3), ka));
    const wl = (wb[1] + wb[2]) * 0.5; // keep blue-green brightness, lift the depleted reds
    this.post.final.uniforms.uWB.value.set(wb[0] / wl, wb[1] / wl, wb[2] / wl);
    this.post.final.uniforms.uFlash.value = Math.max(0, (this.post.final.uniforms.uFlash.value || 0) - dt * 4);

    this.camera.updateMatrixWorld();
    this.post.render(this.scene, this.camera, this.frame);
    if (photo) this.takePhoto();

    // discoveries
    if (this.frame % 15 === 0) {
      for (const k of this.fish.sighted(d.pos, 7)) if (this.hud.discover(k)) audio.click?.(audio.ctx?.currentTime ?? 0, 0.06);
      if (this.wreck && d.pos.distanceTo(this.wreck.center) < 30) this.hud.discover('wreck');
      for (const c of this.creatures) {
        for (const a of c.list) {
          if (a.mesh.position.distanceTo(d.pos) < 9) this.hud.discover(c instanceof Mantas ? 'manta' : c instanceof Turtles ? 'turtle' : '');
        }
      }
    }

    // warnings
    this.warnTimer = (this.warnTimer || 0) - dt;
    if (this.warnTimer <= 0) {
      if (d.ascentRate > 10) { this.hud.message('浮上速度が速すぎます！ ゆっくり', 1.5, 'alarm'); this.warnTimer = 1.5; }
      else if (d.pressure < 50 && !this.lowAirWarned) { this.hud.message('残圧 50 bar — 浮上を開始してください', 4, 'warn'); this.lowAirWarned = true; this.warnTimer = 4; }
      else if (d.deco.ceiling() > 0 && !this.decoWarned) { this.hud.message('減圧停止義務が発生しました', 4, 'alarm'); this.decoWarned = true; this.warnTimer = 4; }
      else if (d.groundDist < 0.9 && d.kickPower > 0.3 && !this.siltWarned) { this.hud.message('砂を巻き上げています。中性浮力を保ちましょう', 3, 'warn'); this.siltWarned = true; this.warnTimer = 3; }
    }
    if (d.time > 4 && this.diver.depth < 0.45 && d.maxDepth > 3) {
      this.surfaceTimer = (this.surfaceTimer || 0) + dt;
      if (this.surfaceTimer > 2.5) this.endDive('surface');
    } else this.surfaceTimer = 0;
    if (d.pressure <= 0) this.endDive('air');
    if (d.time > 12) $('hint').style.opacity = 0.0;

    // audio
    const near = this.reef.heads.length ? 1 - Math.min(1, Math.max(0, d.groundDist - 1) / 12) : 0.3;
    audio.update({ depth: d.depth, reefNear: near, inflating: this.opts.mode === 'real' && input.axis().inflate, deflating: this.opts.mode === 'real' && input.axis().deflate && d.bcd > 0, muted: !this.opts.sound });
    this.hud.update(dt, d, this.site, this.torchOn);
  }

  takePhoto() {
    const url = this.renderer.domElement.toDataURL('image/jpeg', 0.92);
    this.hud.addPhoto(url);
    this.post.final.uniforms.uFlash.value = 0.6;
    audio.shutter();
    this.photos = (this.photos || 0) + 1;
  }

  endDive(reason) {
    if (this.ended) return;
    this.ended = true;
    document.exitPointerLock?.();
    $('pause').classList.remove('show');
    const d = this.diver;
    const m = Math.floor(d.time / 60), s = Math.floor(d.time % 60);
    const found = [...this.hud.found].map((k) => LOGBOOK[k].name);
    const issues = [];
    if (d.safety.required && !d.safety.done) issues.push('安全停止を省略');
    if (this.decoWarned) issues.push('減圧限界を超過');
    if (reason === 'air') issues.push('エア切れ（緊急浮上）');
    const grade = issues.length ? `要注意：${issues.join('・')}` : 'パーフェクトダイブ！ 安全手順を守れました';
    $('summary-body').innerHTML = `
      <table>
        <tr><td>ポイント</td><td>${this.site.name}</td></tr>
        <tr><td>潜水時間</td><td>${m}分${String(s).padStart(2, '0')}秒</td></tr>
        <tr><td>最大水深</td><td>${d.maxDepth.toFixed(1)} m</td></tr>
        <tr><td>水温</td><td>${this.site.temp} °C</td></tr>
        <tr><td>残圧</td><td>${Math.round(d.pressure)} bar（開始 200 bar）</td></tr>
        <tr><td>平均消費</td><td>${(((200 - d.pressure) * d.tankL) / Math.max(d.time / 60, 0.1) / ambient(d.maxDepth * 0.6)).toFixed(1)} L/分 (SAC)</td></tr>
        <tr><td>撮影</td><td>${this.photos || 0} 枚</td></tr>
      </table>
      <div class="species"><b>出会った生き物 (${found.length})</b><br>${found.join('、') || '—'}</div>
      <div class="grade">${grade}</div>`;
    $('summary').classList.add('show');
    $('hud').classList.add('hidden');
    $('touch').classList.add('hidden');
    audio.suspend();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onLock);
    document.removeEventListener('visibilitychange', this.onVis);
    this.renderer?.dispose();
    this.renderer?.forceContextLoss?.();
  }
}

// expose for automated visual testing
window.__bali = { get game() { return game; }, SITES, THREE };
