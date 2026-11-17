// Every sound is synthesised live with the Web Audio API: no audio files, works offline.
// play(theme, kind) where kind is 'login', 'checkin' or 'warn'.
const MUTE_KEY = 'bm-mute';
let ctx = null;
let master = null;

export const isMuted = () => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } };
export function setMuted(on) { try { localStorage.setItem(MUTE_KEY, on ? '1' : '0'); } catch { /* ignore */ } }

function audio() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    const comp = ctx.createDynamicsCompressor();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ---- building blocks ----
function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
function tone({ f, to, type = 'sine', t = 0, a = 0.005, d = 0.3, v = 0.3, detune = 0, lp, out }) {
  const c = ctx, now = c.currentTime + t;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, now); o.detune.value = detune;
  if (to) o.frequency.exponentialRampToValueAtTime(to, now + a + d);
  let node = o;
  if (lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; node.connect(fl); node = fl; }
  node.connect(g).connect(out || master);
  env(g, now, v, a, d);
  o.start(now); o.stop(now + a + d + 0.05);
}
let noiseBuf = null;
function noise({ t = 0, a = 0.002, d = 0.1, v = 0.3, type = 'bandpass', f = 2000, to, q = 1 }) {
  const c = ctx, now = c.currentTime + t;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource(); s.buffer = noiseBuf;
  const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, now); fl.Q.value = q;
  if (to) fl.frequency.exponentialRampToValueAtTime(to, now + a + d);
  const g = c.createGain();
  s.connect(fl).connect(g).connect(master);
  env(g, now, v, a, d);
  s.start(now); s.stop(now + a + d + 0.05);
}
function distorted({ f, t = 0, d = 0.18, v = 0.25, amount = 40 }) {
  const c = ctx, now = c.currentTime + t;
  const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
  const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f * 1.5; // power chord fifth
  const ws = c.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
  ws.curve = curve;
  const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 1400;
  const g = c.createGain();
  o.connect(ws); o2.connect(ws); ws.connect(fl).connect(g).connect(master);
  env(g, now, v, 0.004, d);
  o.start(now); o2.start(now); o.stop(now + d + 0.1); o2.stop(now + d + 0.1);
}
const N = (semi) => 440 * Math.pow(2, (semi - 9) / 12); // semitones from C4… roughly; N(0)=C4
const bell = (f, t, v = 0.22, d = 1.2) => { tone({ f, t, d, v }); tone({ f: f * 2.01, t, d: d * 0.6, v: v * 0.35 }); tone({ f: f * 3.02, t, d: d * 0.3, v: v * 0.15 }); };

// ---- sound designs per theme ----
const SOUNDS = {
  hilton: {
    login: () => { bell(N(24), 0); bell(N(28), 0.12); bell(N(31), 0.24); bell(N(36), 0.38, 0.18, 1.6); },
    checkin: () => { bell(N(28), 0, 0.2, 0.6); bell(N(35), 0.09, 0.2, 0.9); },
    warn: () => { tone({ f: 220, type: 'triangle', d: 0.16, v: 0.3 }); tone({ f: 196, type: 'triangle', t: 0.2, d: 0.25, v: 0.3 }); },
  },
  darkroom: {
    // film advance ratchet, then a mechanical shutter
    login: () => {
      for (let i = 0; i < 7; i++) noise({ t: i * 0.055, d: 0.02, f: 3200, q: 4, v: 0.35 });
      noise({ t: 0.5, d: 0.03, type: 'highpass', f: 2500, v: 0.6 }); tone({ f: 140, to: 60, t: 0.5, d: 0.08, v: 0.5 });
      noise({ t: 0.58, d: 0.04, type: 'highpass', f: 1800, v: 0.45 });
      tone({ f: 1800, to: 6000, t: 0.7, d: 0.35, v: 0.05 });
    },
    checkin: () => {
      noise({ d: 0.025, type: 'highpass', f: 2600, v: 0.6 }); tone({ f: 150, to: 55, d: 0.07, v: 0.5 });
      noise({ t: 0.07, d: 0.035, type: 'highpass', f: 1700, v: 0.4 });
      tone({ f: 2000, to: 7000, t: 0.12, d: 0.3, v: 0.04 });
    },
    warn: () => { tone({ f: 90, to: 50, d: 0.1, v: 0.6 }); tone({ f: 90, to: 50, t: 0.16, d: 0.1, v: 0.6 }); noise({ t: 0.32, d: 0.15, f: 600, q: 2, v: 0.2 }); },
  },
  cocoa: {
    // pouring, then spoon clinks on the mug
    login: () => {
      noise({ d: 0.9, a: 0.15, type: 'lowpass', f: 350, to: 1400, q: 3, v: 0.25 });
      bell(2600, 0.95, 0.12, 0.5); bell(3150, 1.12, 0.1, 0.45); bell(2600, 1.26, 0.08, 0.6);
      tone({ f: 320, to: 900, t: 0.6, d: 0.1, v: 0.12 });
    },
    checkin: () => { tone({ f: 280, to: 880, d: 0.11, v: 0.28 }); tone({ f: 420, to: 1200, t: 0.1, d: 0.09, v: 0.18 }); bell(2800, 0.22, 0.09, 0.5); },
    warn: () => { tone({ f: 200, to: 120, type: 'triangle', d: 0.2, v: 0.4 }); tone({ f: 160, to: 100, type: 'triangle', t: 0.22, d: 0.3, v: 0.4 }); },
  },
  tactical: {
    // radio squelch, two beeps, then a reload
    login: () => {
      noise({ d: 0.12, f: 1800, q: 1.5, v: 0.3 });
      tone({ f: 1000, type: 'square', t: 0.16, d: 0.07, v: 0.12 }); tone({ f: 1000, type: 'square', t: 0.3, d: 0.07, v: 0.12 });
      noise({ t: 0.55, d: 0.03, f: 3500, q: 6, v: 0.5 }); noise({ t: 0.7, d: 0.05, f: 1200, q: 3, v: 0.5 }); tone({ f: 180, to: 90, t: 0.7, d: 0.06, v: 0.3 });
    },
    checkin: () => {
      tone({ f: 70, to: 38, d: 0.35, v: 0.6 }); noise({ d: 0.25, type: 'lowpass', f: 400, v: 0.35 });
      tone({ f: 880, to: 1320, type: 'square', t: 0.18, d: 0.08, v: 0.1 }); tone({ f: 1320, type: 'square', t: 0.28, d: 0.1, v: 0.1 });
    },
    warn: () => { for (let i = 0; i < 3; i++) { tone({ f: 880, type: 'square', t: i * 0.22, d: 0.09, v: 0.12 }); tone({ f: 660, type: 'square', t: i * 0.22 + 0.11, d: 0.09, v: 0.12 }); } },
  },
  idol: {
    // bright synth-pop arpeggio with sparkles
    login: () => {
      [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => { tone({ f: N(12 + s), type: 'square', t: i * 0.075, d: 0.16, v: 0.07, lp: 4000 }); tone({ f: N(12 + s), type: 'sawtooth', detune: 9, t: i * 0.075, d: 0.16, v: 0.05, lp: 3000 }); });
      for (let i = 0; i < 6; i++) tone({ f: 3000 + Math.random() * 3000, t: 0.55 + i * 0.05, d: 0.12, v: 0.04 });
      tone({ f: N(36), type: 'triangle', t: 0.55, d: 0.7, v: 0.12 });
    },
    checkin: () => { tone({ f: N(19), type: 'square', d: 0.08, v: 0.08, lp: 5000 }); tone({ f: N(26), type: 'square', t: 0.08, d: 0.18, v: 0.08, lp: 5000 }); tone({ f: 5200, t: 0.16, d: 0.15, v: 0.04 }); },
    warn: () => { tone({ f: N(16), type: 'square', d: 0.12, v: 0.08, lp: 3000 }); tone({ f: N(12), type: 'square', t: 0.14, d: 0.12, v: 0.08, lp: 3000 }); tone({ f: N(7), type: 'square', t: 0.28, d: 0.25, v: 0.08, lp: 3000 }); },
  },
  prog: {
    // low drone and a pulse grouped 2+2+3 (7/8)
    login: () => {
      tone({ f: 73.4, type: 'sawtooth', a: 0.6, d: 1.4, v: 0.18, lp: 500 }); tone({ f: 110, type: 'sawtooth', a: 0.6, d: 1.4, v: 0.12, lp: 600 });
      [0, 2, 4].forEach((b) => distorted({ f: 73.4, t: 0.15 + b * 0.13, d: 0.1, v: 0.18 }));
      [0, 1, 2, 3, 4, 5, 6].forEach((b) => noise({ t: 0.15 + b * 0.13, d: 0.03, type: 'highpass', f: 7000, v: [0, 2, 4].includes(b) ? 0.25 : 0.1 }));
      bell(N(26), 1.1, 0.12, 1.4);
    },
    checkin: () => { distorted({ f: 82.4, d: 0.09, v: 0.2 }); distorted({ f: 82.4, t: 0.12, d: 0.09, v: 0.2 }); distorted({ f: 98, t: 0.24, d: 0.2, v: 0.22 }); bell(3300, 0.26, 0.06, 0.8); },
    warn: () => { distorted({ f: 73.4, d: 0.35, v: 0.22 }); tone({ f: 103.8, type: 'sawtooth', d: 0.35, v: 0.12, lp: 900 }); },
  },
  brother: {
    // warm brass swell and a fist bump
    login: () => {
      [N(0), N(4), N(7), N(12)].forEach((f) => { tone({ f, type: 'sawtooth', a: 0.25, d: 0.9, v: 0.09, lp: 1800 }); tone({ f, type: 'sawtooth', detune: 7, a: 0.25, d: 0.9, v: 0.06, lp: 1600 }); });
      tone({ f: 120, to: 45, t: 0.95, d: 0.25, v: 0.6 }); noise({ t: 0.95, d: 0.08, f: 1000, v: 0.35 });
    },
    checkin: () => { tone({ f: 110, to: 45, d: 0.2, v: 0.55 }); noise({ d: 0.07, f: 1400, q: 1.2, v: 0.4 }); tone({ f: N(19), type: 'triangle', t: 0.12, d: 0.3, v: 0.15 }); },
    warn: () => { tone({ f: N(7), type: 'triangle', d: 0.18, v: 0.25 }); tone({ f: N(2), type: 'triangle', t: 0.2, d: 0.35, v: 0.25 }); },
  },
  goat: {
    // deep 808 boom and a hard piano stab
    login: () => {
      tone({ f: 110, to: 38, d: 1.4, v: 0.75 });
      noise({ t: 0.02, d: 0.5, type: 'bandpass', f: 600, to: 3000, q: 2, v: 0.12 });
      [N(-12), N(-5), N(0), N(3)].forEach((f) => { tone({ f, type: 'triangle', t: 0.55, d: 1.2, v: 0.16 }); tone({ f: f * 2, t: 0.55, d: 0.6, v: 0.05 }); });
    },
    checkin: () => { tone({ f: 90, to: 40, d: 0.5, v: 0.6 }); noise({ d: 0.04, type: 'highpass', f: 4000, v: 0.35 }); },
    warn: () => { tone({ f: 60, type: 'square', d: 0.35, v: 0.18, lp: 400 }); tone({ f: 64, type: 'square', d: 0.35, v: 0.18, lp: 400 }); },
  },
};

export function play(theme, kind) {
  if (isMuted()) return;
  try {
    if (!audio()) return;
    (SOUNDS[theme] || SOUNDS.hilton)[kind]?.();
  } catch { /* sound is a bonus; never break the app */ }
}
