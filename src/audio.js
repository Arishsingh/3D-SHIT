// Web Audio synthesis: no audio files. Everything runs through a "bodycam mic"
// chain (soft clip -> compressor -> band limiting) so it sounds like a cheap
// recorder with automatic gain control.

export class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = (this.ctx = new C());

    this.master = ctx.createGain(); this.master.gain.value = 0.85;
    const shaper = ctx.createWaveShaper(); shaper.curve = softClip(2.2); shaper.oversample = '2x';
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 8; comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.3;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 85;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 8000;
    const out = ctx.createGain(); out.gain.value = 0.9;
    this.master.connect(shaper).connect(comp).connect(hp).connect(lp).connect(out).connect(ctx.destination);

    this.reverb = ctx.createConvolver(); this.reverb.buffer = this.corridorIR(2.6);
    this.revIn = ctx.createGain(); this.revIn.gain.value = 1;
    const revOut = (this.revOut = ctx.createGain()); revOut.gain.value = 0.14;        // outdoors: mostly dry, a little slap off the house
    this.revIn.connect(this.reverb).connect(revOut).connect(this.master);
    // everything outside (wind, whistle) goes through this, so walls can muffle it
    this.outsideLP = this.filt('lowpass', 8000, 0.5);
    this.outside = ctx.createGain(); this.outside.gain.value = 1;
    this.outsideLP.connect(this.outside).connect(this.master);
    this.indoor = 0;

    this.noiseBuf = this.makeNoise(2, 'white');
    this.brownBuf = this.makeNoise(4, 'brown');
    this.startAmbience();
    this.ready = true;
    if (this.indoor) this.setIndoor(this.indoor);
  }

  makeNoise(sec, kind) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  corridorIR(sec) {
    const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sr * sec);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / sec, 3.2) * Math.exp(-t * 2.2) * 0.6;
      }
      // flutter echoes between parallel walls (3 m apart ~ 17 ms round trip)
      for (let k = 1; k < 26; k++) {
        const idx = Math.floor((0.0175 * k + (ch ? 0.0013 : 0)) * sr);
        if (idx < len) d[idx] += (ch ? -1 : 1) * 0.55 * Math.exp(-k * 0.16);
      }
      // long-axis slap from the far wall
      const s = Math.floor(0.19 * sr); if (s < len) d[s] += 0.35;
    }
    return buf;
  }

  src(buf, t, dur, offset = Math.random()) {
    const s = this.ctx.createBufferSource(); s.buffer = buf;
    s.start(t, offset * Math.max(0, buf.duration - dur - 0.01)); s.stop(t + dur + 0.05);
    return s;
  }
  env(t, peak, attack, decay, node) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    if (node) node.connect(g);
    return g;
  }
  filt(type, f, q = 0.8) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

  startAmbience() {
    const ctx = this.ctx, t = ctx.currentTime;
    // room tone
    const room = ctx.createBufferSource(); room.buffer = this.brownBuf; room.loop = true;
    const rl = this.filt('lowpass', 380); const rg = ctx.createGain(); rg.gain.value = 0.16;
    room.connect(rl).connect(rg).connect(this.master); room.start(t);
    // mic hiss
    const hiss = ctx.createBufferSource(); hiss.buffer = this.noiseBuf; hiss.loop = true;
    const hh = this.filt('highpass', 5200); const hg = ctx.createGain(); hg.gain.value = 0.012;
    hiss.connect(hh).connect(hg).connect(this.master); hiss.start(t);
    // mains hum of ballasts
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0.02;
    const h1 = ctx.createOscillator(); h1.type = 'sawtooth'; h1.frequency.value = 60;
    const h2 = ctx.createOscillator(); h2.type = 'sine'; h2.frequency.value = 120;
    const hl = this.filt('lowpass', 420);
    const h2g = ctx.createGain(); h2g.gain.value = 0.7;
    h1.connect(hl).connect(this.humGain); h2.connect(h2g).connect(this.humGain);
    this.humGain.connect(this.master); h1.start(t); h2.start(t);
    // flicker buzz
    this.buzzGain = ctx.createGain(); this.buzzGain.gain.value = 0;
    const bz = ctx.createOscillator(); bz.type = 'sawtooth'; bz.frequency.value = 120;
    const bf = this.filt('bandpass', 1900, 1.2);
    bz.connect(bf).connect(this.buzzGain).connect(this.master); bz.start(t);
    // clothing rustle while moving
    const rus = ctx.createBufferSource(); rus.buffer = this.noiseBuf; rus.loop = true;
    const rf = this.filt('bandpass', 1100, 0.6);
    this.rustleGain = ctx.createGain(); this.rustleGain.gain.value = 0;
    rus.connect(rf).connect(this.rustleGain).connect(this.master); rus.start(t);
    // wind: band-passed noise with slow, irregular gusts
    const wind = ctx.createBufferSource(); wind.buffer = this.brownBuf; wind.loop = true;
    const wf = this.filt('bandpass', 420, 0.5);
    const wg = ctx.createGain(); wg.gain.value = 0.22;
    for (const [f, d] of [[0.07, 0.12], [0.19, 0.06], [0.031, 0.08]]) { const l = ctx.createOscillator(); l.frequency.value = f; const lg = ctx.createGain(); lg.gain.value = d; l.connect(lg).connect(wg.gain); l.start(t); }
    const wfl = ctx.createOscillator(); wfl.frequency.value = 0.05; const wfg = ctx.createGain(); wfg.gain.value = 180; wfl.connect(wfg).connect(wf.frequency); wfl.start(t);
    wind.connect(wf).connect(wg).connect(this.outsideLP); wind.start(t);
    const whistle = ctx.createBufferSource(); whistle.buffer = this.noiseBuf; whistle.loop = true;
    const wh = this.filt('bandpass', 1900, 9); const whg = ctx.createGain(); whg.gain.value = 0.006;
    whistle.connect(wh).connect(whg).connect(this.outsideLP); whistle.start(t);
    // low, slowly beating dread drone
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0.0;
    this.droneGain.gain.setTargetAtTime(0.03, t, 4);
    const dl = this.filt('lowpass', 240, 0.5);
    for (const [f, type] of [[43.65, 'sawtooth'], [46.25, 'sawtooth'], [65.4, 'sine'], [92.5, 'triangle']]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03 + Math.random() * 0.07;
      const lg = ctx.createGain(); lg.gain.value = f * 0.004; lfo.connect(lg).connect(o.frequency);
      o.connect(dl); o.start(t); lfo.start(t);
    }
    const swell = ctx.createOscillator(); swell.frequency.value = 0.05;
    const sg = ctx.createGain(); sg.gain.value = 0.025; swell.connect(sg).connect(this.droneGain.gain); swell.start(t);
    dl.connect(this.droneGain).connect(this.master);
    const ds = ctx.createGain(); ds.gain.value = 0.4; this.droneGain.connect(ds).connect(this.revIn);
  }

  // ---- distant, unexplained sounds
  distantThud() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.src(this.noiseBuf, t, 0.5);
    const lp = this.filt('lowpass', 260, 0.7);
    const e = this.env(t, 0.5, 0.01, 0.4, n.connect(lp));
    const g = ctx.createGain(); g.gain.value = 0.25; e.connect(g).connect(this.master);
    const s = ctx.createGain(); s.gain.value = 1.4; e.connect(s).connect(this.revIn);
    if (Math.random() < 0.5) setTimeout(() => this.distantThud2(), 350 + Math.random() * 500);
  }
  distantThud2() {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.src(this.noiseBuf, t, 0.4);
    const e = this.env(t, 0.3, 0.01, 0.3, n.connect(this.filt('lowpass', 200, 0.7)));
    const s = ctx.createGain(); s.gain.value = 1.2; e.connect(s).connect(this.revIn);
  }
  creak() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 1.2 + Math.random() * 1.6;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = 70 + Math.random() * 60;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * (1.3 + Math.random() * 0.8), t + dur * 0.6);
    o.frequency.linearRampToValueAtTime(f0 * 0.9, t + dur);
    const am = ctx.createOscillator(); am.frequency.value = 18 + Math.random() * 20;
    const amg = ctx.createGain(); amg.gain.value = 0.5;
    const vca = ctx.createGain(); vca.gain.value = 0.5; am.connect(amg).connect(vca.gain);
    const bp = this.filt('bandpass', 900 + Math.random() * 900, 6);
    const e = this.ctx.createGain();
    e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(0.05, t + 0.3); e.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(vca).connect(bp).connect(e);
    e.connect(this.master); const s = ctx.createGain(); s.gain.value = 0.9; e.connect(s).connect(this.revIn);
    o.start(t); am.start(t); o.stop(t + dur + 0.1); am.stop(t + dur + 0.1);
  }
  drips(n = 5) {
    if (!this.ready) return;
    const ctx = this.ctx; let t = ctx.currentTime;
    for (let i = 0; i < n; i++) {
      t += 0.5 + Math.random() * 0.9;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(1800 + Math.random() * 600, t); o.frequency.exponentialRampToValueAtTime(700, t + 0.05);
      const e = this.env(t, 0.05, 0.002, 0.07, o);
      e.connect(this.master); const s = ctx.createGain(); s.gain.value = 0.6; e.connect(s).connect(this.revIn);
      o.start(t); o.stop(t + 0.12);
    }
  }
  crow() {
    if (!this.ready) return;
    const ctx = this.ctx; let t = ctx.currentTime;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pan.pan) pan.pan.value = (Math.random() - 0.5) * 1.6;
    pan.connect(this.master);
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++, t += 0.38 + Math.random() * 0.15) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(560, t); o.frequency.linearRampToValueAtTime(470, t + 0.22);
      const bp = this.filt('bandpass', 1350, 3.5), bp2 = this.filt('bandpass', 2600, 4);
      const e = this.env(t, 0.05, 0.02, 0.24, null);
      o.connect(bp).connect(e); o.connect(bp2).connect(e); e.connect(pan);
      const s = ctx.createGain(); s.gain.value = 0.25; e.connect(s).connect(this.revIn);
      o.start(t); o.stop(t + 0.3);
    }
  }
  whisper() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 1.4 + Math.random();
    const n = this.src(this.noiseBuf, t, dur);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.05, t + 0.4); out.gain.linearRampToValueAtTime(0.0001, t + dur);
    const syl = ctx.createOscillator(); syl.frequency.value = 3 + Math.random() * 3;
    const sg = ctx.createGain(); sg.gain.value = 0.5; const vca = ctx.createGain(); vca.gain.value = 0.5;
    syl.connect(sg).connect(vca.gain);
    for (const f of [700, 1200, 2600]) { const b = this.filt('bandpass', f * (0.9 + Math.random() * 0.2), 9); n.connect(b).connect(vca); }
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pan.pan) pan.pan.value = Math.random() < 0.5 ? -0.8 : 0.8;
    vca.connect(out).connect(pan).connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.7; out.connect(s).connect(this.revIn);
    syl.start(t); syl.stop(t + dur + 0.1);
  }
  ghostSteps(n = 3) {
    if (!this.ready) return;
    const ctx = this.ctx; let t = ctx.currentTime + 0.35;
    for (let i = 0; i < n; i++, t += 0.52 + Math.random() * 0.06) {
      const s = this.src(this.noiseBuf, t, 0.14);
      const e = this.env(t, 0.16, 0.004, 0.1, s.connect(this.filt('bandpass', 320, 0.9)));
      const g = ctx.createGain(); g.gain.value = 0.35; e.connect(g).connect(this.master);
      const r = ctx.createGain(); r.gain.value = 0.8; e.connect(r).connect(this.revIn);
    }
  }
  sting() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const f of [61.7, 65.4, 207.6, 220]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = this.filt('lowpass', 600, 1);
      const e = this.env(t, 0.06, 0.05, 1.6, o.connect(lp));
      e.connect(this.master); const s = ctx.createGain(); s.gain.value = 0.8; e.connect(s).connect(this.revIn);
      o.start(t); o.stop(t + 1.8);
    }
    const n = this.src(this.noiseBuf, t, 0.6);
    this.env(t, 0.15, 0.005, 0.5, n.connect(this.filt('lowpass', 400, 0.7))).connect(this.revIn);
  }
  ambientEvent() {
    const r = Math.random();
    if (r < 0.25) this.distantThud();
    else if (r < 0.45) this.creak();
    else if (r < 0.65) this.crow();
    else if (r < 0.8) this.whisper();
    else this.ghostSteps(2 + Math.floor(Math.random() * 3));
  }

  // 0 = out in the yard, 1 = inside the house, 2 = down in the cellar
  setIndoor(level) {
    this.indoor = level;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.outside.gain.setTargetAtTime([1, 0.4, 0.12][level], t, 0.25);
    this.outsideLP.frequency.setTargetAtTime([8000, 650, 280][level], t, 0.25);
    this.revOut.gain.setTargetAtTime([0.14, 0.32, 0.5][level], t, 0.25);
    this.droneGain.gain.setTargetAtTime([0.03, 0.04, 0.06][level], t, 2);
  }

  // latch, a long hinge groan, then the door swinging shut behind you
  door(opening = true) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const latch = this.src(this.noiseBuf, t, 0.05);
    this.env(t, 0.35, 0.002, 0.04, latch.connect(this.filt('bandpass', 3200, 2))).connect(this.master);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = opening ? 110 : 140, dur = 0.9;
    o.frequency.setValueAtTime(f0, t + 0.08); o.frequency.linearRampToValueAtTime(f0 * 1.9, t + 0.08 + dur * 0.7); o.frequency.linearRampToValueAtTime(f0 * 1.4, t + 0.08 + dur);
    const am = ctx.createOscillator(); am.frequency.value = 26; const amg = ctx.createGain(); amg.gain.value = 0.5;
    const vca = ctx.createGain(); vca.gain.value = 0.5; am.connect(amg).connect(vca.gain);
    const bp = this.filt('bandpass', 1300, 5);
    const e = ctx.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(0.09, t + 0.25); e.gain.linearRampToValueAtTime(0.0001, t + 0.08 + dur);
    o.connect(vca).connect(bp).connect(e); e.connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.8; e.connect(s).connect(this.revIn);
    o.start(t + 0.08); am.start(t + 0.08); o.stop(t + dur + 0.2); am.stop(t + dur + 0.2);
    // slam
    const tc = t + 1.05;
    const n = this.src(this.noiseBuf, tc, 0.3);
    const thud = this.env(tc, 0.7, 0.003, 0.25, n.connect(this.filt('lowpass', 420, 0.8)));
    thud.connect(this.master); const s2 = ctx.createGain(); s2.gain.value = 1; thud.connect(s2).connect(this.revIn);
    const k = ctx.createOscillator(); k.frequency.setValueAtTime(80, tc); k.frequency.exponentialRampToValueAtTime(40, tc + 0.15);
    this.env(tc, 0.5, 0.003, 0.18, k).connect(this.master); k.start(tc); k.stop(tc + 0.25);
  }

  update(hum, buzz, moving) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.humGain.gain.setTargetAtTime(0.008 + hum * 0.03, t, 0.1);
    this.buzzGain.gain.setTargetAtTime(buzz * 0.035, t, 0.015);
    this.rustleGain.gain.setTargetAtTime(moving * 0.035, t, 0.08);
  }

  footstep(v = 0.6) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + 0.005;
    const n = this.src(this.noiseBuf, t, 0.16);
    const bp = this.filt('bandpass', 280 + Math.random() * 260, 0.9);
    const e = this.env(t, 0.55 * v, 0.004, 0.11, n.connect(bp));
    e.connect(this.master);
    const s = this.ctx.createGain(); s.gain.value = 0.25; e.connect(s).connect(this.revIn);
    if (!this.indoor) {
      // grit crunch on debris
      const n2 = this.src(this.noiseBuf, t + 0.012, 0.08);
      const hpf = this.filt('highpass', 2600 + Math.random() * 1500, 0.7);
      this.env(t + 0.012, 0.2 * v, 0.003, 0.09, n2.connect(hpf)).connect(this.master);     // gravel crunch
    } else if (Math.random() < 0.22) {
      // old floorboards: a short squeak now and then
      const c = this.ctx.createOscillator(); c.type = 'sawtooth';
      const f = 300 + Math.random() * 300; c.frequency.setValueAtTime(f, t + 0.03); c.frequency.linearRampToValueAtTime(f * 1.5, t + 0.25);
      const b = this.filt('bandpass', 1500 + Math.random() * 700, 7);
      this.env(t + 0.03, 0.05 * v, 0.06, 0.2, c.connect(b)).connect(this.master);
      c.start(t + 0.03); c.stop(t + 0.35);
    }
    // heel thud
    const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.08);
    this.env(t, 0.32 * v, 0.004, 0.09, o).connect(this.master);
    o.start(t); o.stop(t + 0.15);
  }

  gunshot() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.002;
    const send = ctx.createGain(); send.gain.value = 1.1; send.connect(this.revIn);
    // supersonic crack
    const n = this.src(this.noiseBuf, t, 0.12);
    const hp = this.filt('highpass', 1100, 0.7);
    const crack = this.env(t, 2.2, 0.0008, 0.08, n.connect(hp));
    crack.connect(this.master); crack.connect(send);
    // body / blast
    const n2 = this.src(this.noiseBuf, t, 0.45);
    const lp = this.filt('lowpass', 4200, 0.9);
    lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(220, t + 0.35);
    const body = this.env(t, 1.8, 0.001, 0.38, n2.connect(lp));
    body.connect(this.master); body.connect(send);
    // low thump
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const th = this.env(t, 1.6, 0.001, 0.22, o); th.connect(this.master);
    o.start(t); o.stop(t + 0.3);
    // slide mechanics click
    const n3 = this.src(this.noiseBuf, t + 0.03, 0.03);
    this.env(t + 0.03, 0.25, 0.001, 0.025, n3.connect(this.filt('bandpass', 3800, 3))).connect(this.master);
    this.casing(t + 0.38 + Math.random() * 0.12);
  }

  casing(t) {
    const ctx = this.ctx;
    const hits = [[0, 1], [0.11 + Math.random() * 0.05, 0.55], [0.2 + Math.random() * 0.06, 0.3], [0.26 + Math.random() * 0.05, 0.15]];
    for (const [dt, amp] of hits) {
      const tt = t + dt;
      for (const f of [3150, 4870, 6720]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * (0.97 + Math.random() * 0.06);
        const e = this.env(tt, 0.05 * amp, 0.001, 0.09 + Math.random() * 0.06, o);
        e.connect(this.master); const s = ctx.createGain(); s.gain.value = 0.3; e.connect(s).connect(this.revIn);
        o.start(tt); o.stop(tt + 0.25);
      }
    }
  }

  impact(kind = 'hard') {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.03;
    if (kind === 'paper') {
      const n = this.src(this.noiseBuf, t, 0.1);
      this.env(t, 0.5, 0.001, 0.07, n.connect(this.filt('bandpass', 900, 1.5))).connect(this.master);
      // cardboard "boing"
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.4);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 9; const lg = ctx.createGain(); lg.gain.value = 18;
      lfo.connect(lg).connect(o.frequency);
      this.env(t, 0.22, 0.004, 0.45, o).connect(this.master);
      o.start(t); o.stop(t + 0.6); lfo.start(t); lfo.stop(t + 0.6);
      return;
    }
    const n = this.src(this.noiseBuf, t, 0.1);
    const f = kind === 'metal' ? 2600 : kind === 'wood' ? 700 : 1500;
    const e = this.env(t, 0.5, 0.001, kind === 'metal' ? 0.12 : 0.06, n.connect(this.filt('bandpass', f, kind === 'metal' ? 6 : 1.2)));
    e.connect(this.master); e.connect(this.revIn);
    if (kind === 'metal') {
      const o = ctx.createOscillator(); o.frequency.value = 1400 + Math.random() * 800;
      this.env(t, 0.08, 0.001, 0.35, o).connect(this.master); o.start(t); o.stop(t + 0.4);
    }
  }

  click(pitch = 1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const n = this.src(this.noiseBuf, t, 0.03);
    this.env(t, 0.3, 0.001, 0.02, n.connect(this.filt('bandpass', 3200 * pitch, 4))).connect(this.master);
  }

  // magazine out, mag hits the floor, new mag in, slide forward
  reload() {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime;
    const clack = (dt, f, q, g, d) => {
      const t = t0 + dt, n = this.src(this.noiseBuf, t, d + 0.02);
      const e = this.env(t, g, 0.001, d, n.connect(this.filt('bandpass', f, q)));
      e.connect(this.master); const s = this.ctx.createGain(); s.gain.value = 0.35; e.connect(s).connect(this.revIn);
    };
    clack(0.12, 2600, 3, 0.25, 0.03);   // release
    clack(0.42, 700, 1.2, 0.3, 0.07);   // mag lands
    clack(0.98, 1800, 2.5, 0.4, 0.04);  // new mag seats
    clack(1.32, 3200, 2, 0.45, 0.05);   // slide drops
    clack(1.38, 1200, 2, 0.25, 0.04);
  }

  holster() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const n = this.src(this.noiseBuf, t, 0.35);
    this.env(t, 0.14, 0.08, 0.22, n.connect(this.filt('bandpass', 1300, 0.7))).connect(this.master);
    this.click(0.7);
  }
}

function softClip(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}
