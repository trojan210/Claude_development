// Fully synthesized underwater soundscape (Web Audio): regulator inhale, exhaled bubble
// bursts, snapping-shrimp reef crackle, low ocean rumble, BCD inflator hiss.
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    this.noise = this.makeNoise(4);
    this.brown = this.makeBrown(6);

    // ocean rumble
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.brown; rumble.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0.25;
    rumble.connect(lp).connect(this.rumbleGain).connect(this.master);
    rumble.start();
    // slow surge modulation
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.08;
    lfo.connect(lfoG).connect(this.rumbleGain.gain); lfo.start();

    // surface wash (audible in the shallows)
    const wash = ctx.createBufferSource(); wash.buffer = this.noise; wash.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    this.washGain = ctx.createGain(); this.washGain.gain.value = 0;
    wash.connect(bp).connect(this.washGain).connect(this.master); wash.start();

    // snapping shrimp: two decorrelated crackle loops panned apart
    this.reefGain = ctx.createGain(); this.reefGain.gain.value = 0.18;
    this.reefGain.connect(this.master);
    for (const [len, pan] of [[5.3, -0.7], [7.1, 0.7]]) {
      const src = ctx.createBufferSource();
      src.buffer = this.makeCrackle(len);
      src.loop = true;
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      src.connect(p).connect(this.reefGain);
      src.start();
    }

    // BCD hiss channel
    const hiss = ctx.createBufferSource(); hiss.buffer = this.noise; hiss.loop = true;
    const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 2600; hf.Q.value = 1.2;
    this.hissGain = ctx.createGain(); this.hissGain.gain.value = 0;
    hiss.connect(hf).connect(this.hissGain).connect(this.master); hiss.start();
    const dump = ctx.createBufferSource(); dump.buffer = this.brown; dump.loop = true;
    const df = ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 700;
    this.dumpGain = ctx.createGain(); this.dumpGain.gain.value = 0;
    dump.connect(df).connect(this.dumpGain).connect(this.master); dump.start();
  }

  makeNoise(sec) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(2, ctx.sampleRate * sec, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    return b;
  }

  makeBrown(sec) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(2, ctx.sampleRate * sec, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let last = 0;
      for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    }
    return b;
  }

  makeCrackle(sec) {
    const ctx = this.ctx, sr = ctx.sampleRate;
    const b = ctx.createBuffer(1, sr * sec, sr);
    const d = b.getChannelData(0);
    const clicks = sec * 45;
    for (let k = 0; k < clicks; k++) {
      const at = Math.floor(Math.random() * (d.length - 400));
      const amp = Math.pow(Math.random(), 2.5) * 0.9 + 0.05;
      const len = 30 + Math.random() * 120;
      for (let i = 0; i < len; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (len * 0.25));
    }
    return b;
  }

  // regulator second stage: demand valve "crack" then a resonant hiss
  inhale(depth, strength = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500 + Math.random() * 300; bp.Q.value = 2.5;
    const bp2 = ctx.createBiquadFilter(); bp2.type = 'peaking'; bp2.frequency.value = 3400; bp2.gain.value = 8; bp2.Q.value = 3;
    const g = ctx.createGain();
    const dur = 1.9 / strength;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.08);
    g.gain.linearRampToValueAtTime(0.22, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    bp.frequency.linearRampToValueAtTime(1200, t + dur);
    src.connect(bp).connect(bp2).connect(g).connect(this.master);
    src.start(t, Math.random() * 2, dur + 0.1);
    this.click(t, 0.12);
  }

  click(t, a) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 2400;
    const g = ctx.createGain(); g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.04);
  }

  // exhalation: exhaust valve rumble + a train of bubble "blups"
  exhale(depth) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const dur = 2.3;
    const src = ctx.createBufferSource(); src.buffer = this.brown;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.75, t + 0.15);
    g.gain.linearRampToValueAtTime(0.45, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    // amplitude flutter of the exhaust tee
    const fl = ctx.createOscillator(); fl.frequency.value = 18 + Math.random() * 6;
    const flg = ctx.createGain(); flg.gain.value = 0.25;
    fl.connect(flg).connect(g.gain); fl.start(t); fl.stop(t + dur);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random() * 3, dur + 0.1);
    const n = 26;
    for (let i = 0; i < n; i++) {
      const at = t + 0.1 + Math.pow(Math.random(), 0.8) * (dur - 0.2);
      this.blup(at, 180 + Math.random() * 520, 0.05 + Math.random() * 0.1);
    }
  }

  blup(t, f, a) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    const p = ctx.createStereoPanner(); p.pan.value = (Math.random() - 0.5) * 0.6;
    o.connect(g).connect(p).connect(this.master); o.start(t); o.stop(t + 0.09);
  }

  shutter() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.click(t, 0.25); this.click(t + 0.07, 0.18);
  }

  kick(power) {
    if (!this.ctx || !this.enabled || power < 0.1) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.brown;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25 * power, t + 0.2); g.gain.linearRampToValueAtTime(0, t + 0.7);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random() * 4, 0.8);
  }

  update(state) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const shallow = Math.exp(-state.depth / 4);
    this.washGain.gain.setTargetAtTime(0.12 * shallow, t, 0.3);
    this.reefGain.gain.setTargetAtTime(0.06 + 0.16 * state.reefNear, t, 0.5);
    this.hissGain.gain.setTargetAtTime(state.inflating ? 0.35 : 0, t, 0.04);
    this.dumpGain.gain.setTargetAtTime(state.deflating ? 0.6 : 0, t, 0.05);
    this.master.gain.setTargetAtTime(state.muted ? 0 : 0.9, t, 0.1);
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}
