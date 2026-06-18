// Generador de FOLEY procedural (Web Audio): sintetiza los sonidos del juego en el
// navegador — cero assets, cero red, sin repetición. Autohosteado y liviano.
// Cada SFX se arma con tonos (osciladores con envolvente/sweep) y ruido filtrado.
const LS = 'critters_sfx';
let actx = null, master = null;
let muted = (() => { try { return localStorage.getItem(LS) === '0'; } catch { return false; } })();

function ctx () {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    master = actx.createGain(); master.gain.value = 0.45; master.connect(actx.destination);
  }
  if (actx.state === 'suspended') { try { actx.resume(); } catch (_) {} }
  return actx;
}

export function isMuted () { return muted; }
export function setMuted (m) { muted = !!m; try { localStorage.setItem(LS, muted ? '0' : '1'); } catch {} }
export function toggleMuted () { setMuted(!muted); return muted; }
// Desbloquea el audio en el primer gesto del usuario (políticas de autoplay).
export function initAudio () { const r = () => { try { ctx(); } catch {} window.removeEventListener('pointerdown', r); }; window.addEventListener('pointerdown', r, { once: true }); }

const rnd = (a, b) => a + Math.random() * (b - a);

function tone ({ freq = 440, to, dur = 0.12, type = 'triangle', gain = 0.3, at = 0.004, delay = 0 }) {
  const c = ctx(); if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (to) { try { o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur); } catch {} }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + at);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise ({ dur = 0.1, gain = 0.3, type = 'highpass', freq = 1200, q = 0.8, to, delay = 0 }) {
  const c = ctx(); if (!c) return;
  const t0 = c.currentTime + delay;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
  if (to) { try { f.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur); } catch {} }
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

// ---- SFX del juego ----
let _lastHit = 0;
export function hit (crit) {
  if (muted) return;
  const now = (actx ? actx.currentTime : 0);
  if (now - _lastHit < 0.03) return;   // throttle: no saturar con golpes muy seguidos
  _lastHit = now;
  try {
    noise({ dur: 0.07, gain: rnd(0.18, 0.26), type: 'bandpass', freq: rnd(1500, 2300), q: 0.7 });
    tone({ freq: rnd(150, 185), to: 70, dur: 0.1, type: 'square', gain: 0.16 });
    if (crit) { tone({ freq: 1100, to: 2200, dur: 0.1, type: 'sawtooth', gain: 0.13 }); noise({ dur: 0.05, gain: 0.16, type: 'highpass', freq: 4000 }); }
  } catch {}
}
export function faint () { if (muted) return; try { tone({ freq: 300, to: 60, dur: 0.42, type: 'sawtooth', gain: 0.22 }); noise({ dur: 0.3, gain: 0.12, type: 'lowpass', freq: 700, to: 200 }); } catch {} }
export function heal () { if (muted) return; try { tone({ freq: 520, to: 760, dur: 0.18, type: 'sine', gain: 0.16 }); tone({ freq: 780, dur: 0.2, type: 'sine', gain: 0.1, delay: 0.06 }); } catch {} }
export function active () { if (muted) return; try { noise({ dur: 0.22, gain: 0.18, type: 'bandpass', freq: 600, to: 3000, q: 0.6 }); tone({ freq: 220, to: 660, dur: 0.18, type: 'sawtooth', gain: 0.14 }); } catch {} }
export function summon () { if (muted) return; try { [523, 659, 880].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'triangle', gain: 0.18, delay: i * 0.08 })); tone({ freq: 1320, dur: 0.25, type: 'sine', gain: 0.12, delay: 0.24 }); } catch {} }
export function capture () { if (muted) return; try { tone({ freq: 660, dur: 0.12, type: 'triangle', gain: 0.18 }); tone({ freq: 990, dur: 0.2, type: 'triangle', gain: 0.16, delay: 0.1 }); } catch {} }
export function victory () {
  if (muted) return;
  try {
    [[523, 0, 0.16], [659, 0.12, 0.16], [784, 0.24, 0.16], [1046, 0.40, 0.55]].forEach(([f, d, dur]) => tone({ freq: f, dur, type: 'triangle', gain: 0.22, delay: d }));
    [1046, 1318, 1568].forEach(f => tone({ freq: f, dur: 0.55, type: 'sine', gain: 0.11, delay: 0.40 }));   // acorde final brillante
  } catch {}
}
export function defeat () {
  if (muted) return;
  try {
    [[440, 0, 0.22], [392, 0.20, 0.22], [330, 0.40, 0.26], [262, 0.62, 0.7]].forEach(([f, d, dur]) => tone({ freq: f, dur, type: 'sawtooth', gain: 0.18, delay: d }));
    tone({ freq: 131, to: 98, dur: 0.9, type: 'sine', gain: 0.14, delay: 0.62 });   // bajo grave que cae
  } catch {}
}
export function tap () { if (muted) return; try { tone({ freq: 320, dur: 0.05, type: 'square', gain: 0.08 }); } catch {} }
