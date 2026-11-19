// Sound design for the Resort look: soft glassy chimes with a gentle room reverb.
// Everything is synthesised live with the Web Audio API: no audio files, works offline.
// play(theme, kind) where kind is 'login', 'checkin' or 'warn' (theme is accepted for compatibility).
const MUTE_KEY = 'bm-mute';
let ctx = null;
let master = null;
let reverb = null;

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

// A short, airy hall: decaying noise used as an impulse response.
function room() {
  if (reverb) return reverb;
  const len = Math.floor(ctx.sampleRate * 2.2);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  reverb = ctx.createConvolver();
  reverb.buffer = buf;
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  reverb.connect(wet).connect(master);
  return reverb;
}

function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
function tone({ f, type = 'sine', t = 0, a = 0.005, d = 0.3, v = 0.2, lp, wet = false }) {
  const now = ctx.currentTime + t;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, now);
  let node = o;
  if (lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; node.connect(fl); node = fl; }
  node.connect(g).connect(wet ? room() : master);
  env(g, now, v, a, d);
  o.start(now);
  o.stop(now + a + d + 0.05);
}
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
// A glass bell: dry body plus a reverb tail.
const glass = (note, t, v = 0.12, d = 1.1) => { tone({ f: hz(note), t, d, v, wet: true }); tone({ f: hz(note), t, d: d * 0.7, v: v * 0.7 }); };

const SOUNDS = {
  // Rising major-seventh arpeggio over a warm low pad.
  login: () => {
    [72, 76, 79, 83, 88].forEach((n, i) => glass(n, i * 0.09, 0.12, 1.4));
    tone({ f: hz(48), type: 'triangle', a: 0.4, d: 1.6, v: 0.08, lp: 800 });
  },
  // Two bright glass notes, a fifth apart.
  checkin: () => { glass(84, 0, 0.14, 0.9); glass(91, 0.07, 0.1, 1.0); },
  // A gentle falling third: noticeable but never harsh.
  warn: () => {
    tone({ f: hz(64), type: 'triangle', d: 0.22, v: 0.18, lp: 2000 });
    tone({ f: hz(60), type: 'triangle', t: 0.2, d: 0.4, v: 0.18, lp: 2000 });
  },
};

export function play(_theme, kind) {
  if (isMuted()) return;
  try {
    if (!audio()) return;
    SOUNDS[kind]?.();
  } catch { /* sound is a bonus; never break the app */ }
}
