// All sound is synthesized. Each monster's cry is built from its own outline: the top edge becomes the pitch curve.
import { clamp } from './geom.js';

let ctx = null, master = null, noise = null;
let muted = false;

export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.8; }
export function isMuted() { return muted; }

export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 4;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.8;
      master.connect(comp); comp.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (navigator.audioSession) navigator.audioSession.type = 'playback'; // play through the iPhone silent switch
    if (ctx.state !== 'running') ctx.resume();
  } catch { /* no audio on this device */ }
}

const ready = () => ctx && ctx.state === 'running' && !muted;

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function noiseHit(t, { type = 'lowpass', freq = 1200, q = 0.8, peak = 0.6, dur = 0.15 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noise;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, 0.003, peak, dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  return f;
}

function tone(t, { type = 'sine', from = 200, to = from, dur = 0.2, peak = 0.4, a = 0.004 } = {}) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(from, t);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(to, 20), t + dur);
  const g = ctx.createGain();
  env(g, t, a, peak, dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + a + dur + 0.05);
}

export function cry(mon, { pitch = 1, len = 1, delay = 0 } = {}) {
  if (!ready()) return;
  const t = ctx.currentTime + 0.01 + delay;
  const d = 0.6 * len;
  const f0 = clamp(780 - mon.size * 620, 130, 760) * pitch;
  const tops = mon.sil.tops.length ? mon.sil.tops : [0.5, 0.6, 0.5];
  const mean = tops.reduce((a, b) => a + b, 0) / tops.length;
  const N = 32, curve = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = tops[Math.floor((i / N) * tops.length)];
    curve[i] = f0 * Math.pow(2, (v - mean) * 2.2 + (i < 4 ? (i - 4) * 0.04 : 0));
  }
  const type = mon.spike > 0.5 ? 'sawtooth' : mon.spike > 0.22 ? 'square' : 'triangle';
  const o1 = ctx.createOscillator(); o1.type = type;
  const o2 = ctx.createOscillator(); o2.type = 'sine';
  o1.frequency.setValueCurveAtTime(curve, t, d);
  const half = curve.map((v) => v * 0.5);
  o2.frequency.setValueCurveAtTime(half, t, d);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 5 + mon.legs.length * 1.6;
  const lg = ctx.createGain(); lg.gain.value = f0 * (0.03 + mon.legs.length * 0.008);
  lfo.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f0 * 2.4; bp.Q.value = 0.9;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
  g.gain.setValueAtTime(0.42, t + d * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  const g2 = ctx.createGain(); g2.gain.value = 0.5;
  o1.connect(bp); bp.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(master);
  for (const o of [o1, o2, lfo]) { o.start(t); o.stop(t + d + 0.05); }
}

export function sfx(name, power = 1) {
  if (!ready()) return;
  const t = ctx.currentTime + 0.005;
  switch (name) {
    case 'tap': tone(t, { type: 'triangle', from: 900, to: 700, dur: 0.04, peak: 0.12 }); break;
    case 'ink': tone(t, { type: 'sine', from: 520, to: 640, dur: 0.05, peak: 0.08 }); break;
    case 'eye': tone(t, { type: 'sine', from: 380, to: 900, dur: 0.09, peak: 0.25 }); break;
    case 'whoosh': {
      const f = noiseHit(t, { type: 'bandpass', freq: 600, q: 1.4, peak: 0.25, dur: 0.22 });
      f.frequency.exponentialRampToValueAtTime(2600, t + 0.2);
      break;
    }
    case 'hit':
      tone(t, { from: 140, to: 50, dur: 0.18, peak: 0.7 * power });
      noiseHit(t, { freq: 1800, peak: 0.45 * power, dur: 0.12 });
      break;
    case 'crit':
      tone(t, { from: 160, to: 45, dur: 0.25, peak: 0.85 });
      noiseHit(t, { type: 'highpass', freq: 3000, peak: 0.35, dur: 0.2 });
      tone(t + 0.02, { type: 'square', from: 1320, dur: 0.12, peak: 0.12 });
      tone(t + 0.07, { type: 'square', from: 1760, dur: 0.16, peak: 0.1 });
      break;
    case 'block':
      tone(t, { type: 'square', from: 260, to: 200, dur: 0.06, peak: 0.25 });
      noiseHit(t, { type: 'bandpass', freq: 2400, q: 3, peak: 0.3, dur: 0.05 });
      break;
    case 'land': tone(t, { from: 90, to: 40, dur: 0.22, peak: 0.6 }); noiseHit(t, { freq: 500, peak: 0.4, dur: 0.2 }); break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.11, { type: 'triangle', from: f, dur: 0.22, peak: 0.25 }));
      break;
    case 'lose':
      [392, 330, 262].forEach((f, i) => tone(t + i * 0.16, { type: 'triangle', from: f, to: f * 0.97, dur: 0.3, peak: 0.2 }));
      break;
    case 'stamp': noiseHit(t, { freq: 700, peak: 0.35, dur: 0.06 }); tone(t, { from: 220, to: 120, dur: 0.08, peak: 0.3 }); break;
    case 'select': tone(t, { type: 'triangle', from: 660, to: 990, dur: 0.07, peak: 0.16 }); break;
    case 'heal':
      [523, 659, 784].forEach((f, i) => tone(t + i * 0.07, { type: 'sine', from: f, to: f * 1.02, dur: 0.18, peak: 0.18 }));
      break;
    case 'bleed': tone(t, { type: 'sine', from: 700, to: 260, dur: 0.16, peak: 0.16 }); noiseHit(t, { type: 'bandpass', freq: 900, q: 4, peak: 0.12, dur: 0.1 }); break;
    case 'stun':
      for (let i = 0; i < 4; i++) tone(t + i * 0.06, { type: 'square', from: 1200 + (i % 2) * 300, dur: 0.05, peak: 0.07 });
      break;
    case 'fly': {
      const f = noiseHit(t, { type: 'bandpass', freq: 400, q: 2, peak: 0.3, dur: 0.4 });
      f.frequency.exponentialRampToValueAtTime(1800, t + 0.35);
      tone(t, { type: 'triangle', from: 300, to: 900, dur: 0.3, peak: 0.12 });
      break;
    }
    case 'glare': tone(t, { type: 'sawtooth', from: 110, to: 90, dur: 0.5, peak: 0.12 }); tone(t, { type: 'sine', from: 1400, to: 1300, dur: 0.4, peak: 0.05 }); break;
    case 'miss': noiseHit(t, { type: 'highpass', freq: 2000, peak: 0.18, dur: 0.18 }); tone(t, { type: 'triangle', from: 500, to: 300, dur: 0.15, peak: 0.1 }); break;
    case 'drop': tone(t, { type: 'sine', from: 1500, to: 2400, dur: 0.06, peak: 0.12 }); tone(t + 0.05, { type: 'sine', from: 2000, to: 2600, dur: 0.08, peak: 0.08 }); break;
    case 'levelup':
      [392, 523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.08, { type: 'square', from: f, dur: 0.14, peak: 0.08 }));
      [523, 1047].forEach((f) => tone(t + 0.42, { type: 'triangle', from: f, dur: 0.5, peak: 0.16 }));
      break;
    case 'evolve': {
      const f = noiseHit(t, { type: 'bandpass', freq: 200, q: 1.5, peak: 0.3, dur: 1.2 });
      f.frequency.exponentialRampToValueAtTime(4000, t + 1.1);
      [262, 330, 392, 523, 659, 784, 1047].forEach((fr, i) => tone(t + 0.9 + i * 0.05, { type: 'triangle', from: fr, dur: 0.4, peak: 0.12 }));
      break;
    }
    case 'buy': [880, 1320].forEach((f, i) => tone(t + i * 0.08, { type: 'square', from: f, dur: 0.1, peak: 0.08 })); break;
    case 'deny': tone(t, { type: 'square', from: 180, to: 150, dur: 0.15, peak: 0.12 }); break;
  }
}
