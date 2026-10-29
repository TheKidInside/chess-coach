// Small synthesized sound set (Web Audio): no audio files to ship or license.

let ctx = null;
let enabled = true;
export function setSound(on) { enabled = on; }

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// A filtered noise burst reads as wood on wood.
function knock(freq, gain, dur) {
  const c = ac();
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start();
}

function tone(freq, start, dur, gain = 0.12, type = 'sine') {
  const c = ac();
  const t = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

const SOUNDS = {
  move: () => knock(1700, 0.9, 0.07),
  capture: () => { knock(900, 1.3, 0.11); knock(2200, 0.4, 0.05); },
  check: () => { knock(1500, 0.9, 0.07); tone(880, 0.02, 0.12, 0.06, 'triangle'); },
  good: () => { tone(660, 0, 0.14); tone(990, 0.09, 0.2); },
  bad: () => { tone(247, 0, 0.18, 0.1, 'triangle'); tone(196, 0.12, 0.25, 0.1, 'triangle'); },
  xp: () => tone(1320, 0, 0.09, 0.05),
  goal: () => { tone(523, 0, 0.18); tone(659, 0.1, 0.18); tone(784, 0.2, 0.3); },
  level: () => { tone(523, 0, 0.25); tone(659, 0.12, 0.25); tone(784, 0.24, 0.25); tone(1047, 0.36, 0.5); },
};

export function play(name) {
  if (!enabled || !SOUNDS[name]) return;
  try { SOUNDS[name](); } catch { /* audio blocked until the first user gesture */ }
}

export function moveSound(mv, inCheck) {
  if (inCheck) play('check');
  else if (mv.captured) play('capture');
  else play('move');
}
