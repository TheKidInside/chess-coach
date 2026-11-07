// Walkthroughs: one opening told start to finish like a narrated video, with one board, a voice and
// marks drawn on the board. The running order and the look follow ChessPage1's "London System: One
// Opening against anything" (setup, exceptions, the attack, example games, the plan); the script and
// the games are our own. Data in walkthroughs/<id>.json, checked by tools/lessons/verify_walkthrough.py.
// Keeps its own board and state, like elo.js, which hosts it inside the Lessons tab.
import { Chess } from './vendor/chess.js';
import { moveSound } from './sound.js';
import { toSpeech } from './review-words.js';
import { followDrag, userArrows } from './board-input.js';

const STORE_KEY = 'chess-coach-walkthrough-v1';
const SVGNS = 'http://www.w3.org/2000/svg';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const RATES = [1, 1.25, 1.5];
const MOVE_GAP = 620;      // between moves within one beat
const BEAT_GAP = 420;      // between beats while playing

const DRILL_GAP = 560;     // before the other side's reply in a drill

const W = {
  root: null, cache: {}, data: null, id: null, actions: {}, pick: 0,
  ch: 0, beat: 0, playing: false, token: 0, ended: false,
  game: new Chess(), last: null, done: new Set(), voice: true, rate: 1, places: {}, speaking: false,
  mode: 'watch', dr: null, clean: {},
};
const $ = (id) => W.root.querySelector(`[data-wt="${id}"]`);
const mk = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const moveList = (s) => (s ? s.split(' ').filter(Boolean) : []);
const chapter = () => W.data.chapters[W.ch];
const beat = () => chapter().beats[W.beat];
const atEnd = () => W.ch === W.data.chapters.length - 1 && W.beat === chapter().beats.length - 1;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    W.voice = raw.voice !== false;
    W.rate = RATES.includes(raw.rate) ? raw.rate : 1;
    W.places = raw.places || {};
    W.clean = raw.clean || {};
  } catch { /* storage blocked: start from the top */ }
}
function save() {
  if (W.mode === 'watch') W.places[W.id] = [W.ch, W.beat];
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ voice: W.voice, rate: W.rate, places: W.places, clean: W.clean })); } catch {}
}

/* ---------- position ---------- */
// The board at a beat: replay the chapter, restarting at each `reset`. `done` holds the setup items
// reached so far in the chapter, so a piece that later moves on keeps its tick.
function stateAt(upto, withPlay = true) {
  const ch = chapter();
  let g = new Chess(), last = null;
  const done = new Set();
  const note = () => (W.data.setup || []).forEach((item, i) => { if (item.any.some((a) => holds(g, a))) done.add(i); });
  const apply = (s) => moveList(s).forEach((m) => { last = g.move(m); note(); });
  apply(ch.from);
  for (let i = 0; i <= upto; i++) {
    const b = ch.beats[i];
    if (b.reset !== undefined) { g = new Chess(); last = null; done.clear(); apply(b.reset); }
    if (i < upto || withPlay) apply(b.play);
  }
  return { g, last, done };
}
const holds = (g, spec) => {
  const [piece, sq] = spec.split('@');
  const p = g.get(sq);
  return !!p && p.color === piece[0] && p.type === piece[1].toLowerCase();
};

function notation(g) {
  return g.history().map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san)).join(' ');
}

/* ---------- board ---------- */
// A Black opening (`side: "b"`) is told from Black's side of the board. A chapter marked `flip`
// (how the other side refutes or counters the opening) turns it round while you watch; Drill it
// keeps your side at the bottom, since you're the one making the moves.
const blackBelow = () => (W.data?.side === 'b') !== (W.mode !== 'drill' && !!W.data?.chapters[W.ch]?.flip);
const sqXY = (sq) => {
  const x = 'abcdefgh'.indexOf(sq[0]), y = 8 - Number(sq[1]);
  return blackBelow() ? { x: 7 - x, y: 7 - y } : { x, y };
};

function drawBoard() {
  const box = $('board');
  box.textContent = '';
  const sel = W.mode === 'drill' ? W.dr?.sel : null;
  const dests = sel ? W.game.moves({ square: sel, verbose: true }).map((m) => m.to) : [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const sq = blackBelow() ? 'abcdefgh'[7 - c] + (r + 1) : 'abcdefgh'[c] + (8 - r);
    const light = ('abcdefgh'.indexOf(sq[0]) + Number(sq[1])) % 2 === 0;   // a1 is dark
    const el = mk('div', `el-sq ${light ? 'l' : 'd'}`);
    el.dataset.sq = sq;
    if (W.last && (W.last.from === sq || W.last.to === sq)) el.classList.add('last');
    if (sel === sq) el.classList.add('sel');
    if (dests.includes(sq)) { el.classList.add('dest'); el.appendChild(mk('i')); }
    const p = W.game.get(sq);
    if (p) {
      const img = mk('img', 'el-piece');
      img.src = `pieces/${p.color}${p.type.toUpperCase()}.svg`;
      img.alt = '';
      img.draggable = false;
      el.appendChild(img);
    }
    if (r === 7) el.appendChild(mk('span', 'el-coord f', sq[0]));
    if (c === 0) el.appendChild(mk('span', 'el-coord r', sq[1]));
    box.appendChild(el);
  }
  W.arrows?.sync(`${W.id}|${W.mode}|${W.dr ? W.dr.i : `${W.ch}.${W.beat}`}|${W.game.fen()}`);
}

function slideLast() {
  if (!W.last || REDUCED) return;
  const img = W.root.querySelector(`.el-sq[data-sq="${W.last.to}"] .el-piece`);
  if (!img) return;
  const a = sqXY(W.last.from), b = sqXY(W.last.to);
  img.style.zIndex = 5;
  img.animate([{ transform: `translate(${(a.x - b.x) * 100}%, ${(a.y - b.y) * 100}%)` }, { transform: 'none' }], { duration: 240, easing: 'ease-out' });
}

function svgEl(tag, attrs, cls) {
  const n = document.createElementNS(SVGNS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  if (cls) n.setAttribute('class', cls);
  return n;
}

// What the narrator is pointing at: shaded squares, thick arrows, rings, a cross, a scribbled word.
function drawMarks(b = {}) {
  const svg = $('marks');
  svg.textContent = '';
  for (const sq of b.shade || []) {
    const { x, y } = sqXY(sq);
    svg.appendChild(svgEl('rect', { x, y, width: 1, height: 1 }, 'wt-shade'));
  }
  for (const [from, to] of b.arrows || []) {
    const a = sqXY(from), c = sqXY(to);
    const x1 = a.x + 0.5, y1 = a.y + 0.5, x2 = c.x + 0.5, y2 = c.y + 0.5;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const ex = x2 - ux * 0.4, ey = y2 - uy * 0.4;
    svg.appendChild(svgEl('line', { x1: x1 + ux * 0.2, y1: y1 + uy * 0.2, x2: ex, y2: ey }, 'wt-arrow'));
    svg.appendChild(svgEl('polygon', { points: `${x2 - ux * 0.08},${y2 - uy * 0.08} ${ex - uy * 0.22},${ey + ux * 0.22} ${ex + uy * 0.22},${ey - ux * 0.22}` }, 'wt-head'));
  }
  for (const sq of b.circle || []) {
    const { x, y } = sqXY(sq);
    svg.appendChild(svgEl('circle', { cx: x + 0.5, cy: y + 0.5, r: 0.44 }, 'wt-ring'));
  }
  for (const sq of b.cross || []) {
    const { x, y } = sqXY(sq);
    svg.appendChild(svgEl('line', { x1: x + 0.15, y1: y + 0.15, x2: x + 0.85, y2: y + 0.85 }, 'wt-arrow'));
    svg.appendChild(svgEl('line', { x1: x + 0.85, y1: y + 0.15, x2: x + 0.15, y2: y + 0.85 }, 'wt-arrow'));
  }
  if (b.word) {
    const { x, y } = sqXY(b.word[0]);
    const halfWidth = b.word[1].length * 0.085;
    const cx = Math.max(halfWidth, Math.min(8 - halfWidth, x + 0.5));
    const t = svgEl('text', { x: cx, y: y < 0.5 ? y + 1.32 : y - 0.1, 'text-anchor': 'middle' }, 'wt-word');
    t.textContent = b.word[1];
    svg.appendChild(t);
  }
}

/* ---------- voice ---------- */
const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
// Edge's "Natural" voices sound far better than the old desktop ones (same ranking as Game review).
const rankVoice = (v) => (/natural/i.test(v.name) ? 4 : /online|google/i.test(v.name) ? 2 : 0) + (/en-US|en-GB|en-AU/i.test(v.lang) ? 1 : 0);
function bestVoice() {
  if (!synth) return null;
  return synth.getVoices().filter((v) => /^en\b|^en-/i.test(v.lang)).sort((a, b) => rankVoice(b) - rankVoice(a))[0] || null;
}
const canSpeak = () => W.voice && !!bestVoice();
const silence = () => { if (synth) synth.cancel(); };

function say(text) {
  silence();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(toSpeech(text));
    const v = bestVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = W.rate;
    W.speaking = true;
    const done = () => { clearTimeout(guard); W.speaking = false; resolve(); };
    // A voice that never reports its end must not stall the walkthrough.
    const guard = setTimeout(done, Math.max(5000, (text.length * 130) / W.rate));
    u.onend = done;
    // A failed voice (an online one, offline) leaves time to read; cancelling us doesn't need it.
    u.onerror = (e) => { if (e.error === 'canceled' || e.error === 'interrupted') done(); else setTimeout(done, readTime(text)); };
    synth.speak(u);
  });
}
const readTime = (text) => (1100 + text.length * 48) / W.rate;

/* ---------- playing ---------- */
// One beat: caption up, moves walk on as the voice talks, marks land once the pieces have stopped.
async function showBeat({ animate = false, speak = canSpeak() } = {}) {
  const token = ++W.token;
  silence();
  W.ended = false;
  const b = beat();
  renderText(b);
  drawMarks();
  const talking = speak && canSpeak() ? say(b.say) : W.playing ? wait(readTime(b.say)) : Promise.resolve();
  const fresh = moveList(b.play);
  if (animate && fresh.length && !REDUCED) {
    const start = stateAt(W.beat, false);
    W.game = start.g;
    W.last = start.last;
    W.done = start.done;
    drawBoard();
    renderProgress();
    for (let i = 0; i < fresh.length; i++) {
      if (i) await wait(MOVE_GAP / W.rate);
      if (token !== W.token) return;
      W.last = W.game.move(fresh[i]);
      moveSound(W.last, W.game.inCheck());
      (W.data.setup || []).forEach((item, n) => { if (item.any.some((a) => holds(W.game, a))) W.done.add(n); });
      drawBoard();
      slideLast();
      renderProgress();
    }
    await wait(260);
    if (token !== W.token) return;
  }
  const end = stateAt(W.beat);
  W.game = end.g;
  W.last = end.last;
  W.done = end.done;
  drawBoard();
  drawMarks(b);
  renderProgress();
  save();
  await talking;
  if (token !== W.token || !W.playing) return;
  await wait(BEAT_GAP);
  if (token !== W.token || !W.playing) return;
  advance();
}

function advance() {
  if (atEnd()) {
    W.playing = false;
    W.ended = true;
    renderControls();
    renderEnd();
    return;
  }
  stepForward();
  showBeat({ animate: true });
}
function stepForward() {
  if (W.beat < chapter().beats.length - 1) W.beat++;
  else { W.ch++; W.beat = 0; }
}

function pause() {
  W.playing = false;
  W.token++;
  silence();
  if (!W.data || W.mode === 'drill') return;
  // Stopped mid-beat: land the moves and marks so the board matches the caption.
  const end = stateAt(W.beat);
  W.game = end.g;
  W.last = end.last;
  W.done = end.done;
  drawBoard();
  drawMarks(beat());
  renderProgress();
  renderControls();
  save();
}

function togglePlay() {
  if (!W.data) return;
  if (W.playing) return pause();
  W.playing = true;
  if (W.ended) { W.ch = 0; W.beat = 0; }
  showBeat({ animate: true });
}

function next() {
  if (!W.data || atEnd()) return;
  stepForward();
  showBeat({ animate: true });
}
function back() {
  if (!W.data) return;
  if (W.beat > 0) W.beat--;
  else if (W.ch > 0) { W.ch--; W.beat = chapter().beats.length - 1; }
  else return;
  showBeat();
}
function jump(i) {
  if (W.mode === 'drill') return drillChapter(i);
  W.ch = i;
  W.beat = 0;
  showBeat();
}

/* ---------- text and chrome ---------- */
function renderText(b) {
  $('chapter').textContent = `Chapter ${W.ch + 1} of ${W.data.chapters.length}`;
  $('title').textContent = chapter().title;
  $('say').textContent = b.say;
  $('card').textContent = b.card || '';
  $('card').classList.toggle('hidden', !b.card);
  $('end').classList.add('hidden');
  renderControls();
  renderChapters();
}

function renderProgress() {
  $('line').textContent = notation(W.game);
  const box = $('setup');
  box.classList.toggle('hidden', !chapter().setup);
  if (!chapter().setup) return;
  box.textContent = '';
  box.appendChild(mk('h3', '', W.data.setupTitle));
  W.data.setup.forEach((item, i) => box.appendChild(mk('div', `wt-tick${W.done.has(i) ? ' on' : ''}`, item.label)));
}

function renderControls() {
  if (!W.data) return;
  if (W.mode === 'drill') return renderDrillControls();
  $('play').textContent = W.playing ? 'Pause' : W.ended ? 'Watch again' : 'Play';
  $('back').disabled = W.ch === 0 && W.beat === 0;
  $('next').disabled = atEnd();
  const off = !bestVoice();
  $('voice').textContent = off ? 'No voice here' : W.voice ? 'Voice on' : 'Voice off';
  $('voice').disabled = off;
  $('voice').setAttribute('aria-pressed', String(W.voice && !off));
  $('rate').textContent = `${W.rate}x`;
  const before = W.data.chapters.slice(0, W.ch).reduce((n, c) => n + c.beats.length, 0);
  const total = W.data.chapters.reduce((n, c) => n + c.beats.length, 0);
  $('pos').textContent = `${before + W.beat + 1} of ${total}`;
}

function renderChapters() {
  [...$('chapters').children].forEach((el, i) => {
    el.setAttribute('aria-current', i === W.ch ? 'true' : 'false');
    el.classList.toggle('past', i < W.ch);
    const share = i < W.ch ? 1 : i > W.ch ? 0 : (W.beat + 1) / W.data.chapters[i].beats.length;
    el.querySelector('i').style.width = `${share * 100}%`;
  });
  const list = $('chapters');
  const on = list.children[W.ch];
  // Phone: the list is a strip, so keep the current chapter in view without moving the page.
  if (on && list.scrollWidth > list.clientWidth) list.scrollLeft = on.offsetLeft - (list.clientWidth - on.offsetWidth) / 2;
}

function renderEnd() {
  const box = $('end');
  box.textContent = '';
  box.classList.remove('hidden');
  box.appendChild(mk('h3', '', 'Now make it yours'));
  const self = mk('button', 'el-btn primary', 'Drill this walkthrough');
  self.type = 'button';
  self.addEventListener('click', () => startDrill());
  box.appendChild(self);
  for (const key of ['drill', 'plan', 'play']) {   // a walkthrough lists only the ends it has
    if (!W.data.end[key]) continue;
    const b = mk('button', 'el-btn primary', W.data.end[key]);
    b.type = 'button';
    b.addEventListener('click', () => W.actions[key]?.(W.data.end));
    box.appendChild(b);
  }
  box.scrollIntoView({ block: 'nearest' });
}

/* ---------- drill ---------- */
// Drill it: the walkthrough's own lines with you at the board. Each move your side plays in a beat is
// a question; the other side's moves play themselves. A line runs from a chapter's start (or a beat's
// `reset`) to the next reset. A beat marked "drill": false shows your side making a mistake on purpose,
// so the line stops just before it; a later `reset` back to that same position carries the line on.
// A line counts as clean when you found every move without a hint.
function drillLines(data) {
  const me = data.side || 'w';
  const lines = [];
  data.chapters.forEach((ch, ci) => {
    let cur = null, g = null;
    const open = (start) => {
      g = new Chess();
      moveList(start).forEach((m) => g.move(m));
      if (cur?.cut === g.fen()) { cur.cut = null; return; }
      cur = { ch: ci, start: moveList(start), moves: [], cut: null };
      lines.push(cur);
    };
    open(ch.from);
    ch.beats.forEach((b, bi) => {
      if (b.reset !== undefined) open(b.reset);
      for (const san of moveList(b.play)) {
        if (cur.cut) break;
        if (g.turn() === me && b.drill === false) { cur.cut = g.fen(); break; }
        const ask = g.turn() === me;
        const m = g.move(san);
        cur.moves.push({ san: m.san, beat: bi, ask });
      }
    });
  });
  const seen = new Set();
  return lines.filter((l) => {
    if (!l.moves.some((m) => m.ask)) return false;
    l.key = `${l.start.join(' ')}|${l.moves.map((m) => m.san).join(' ')}`;
    if (seen.has(l.key)) return false;
    seen.add(l.key);
    return true;
  });
}

function setMode(mode) {
  W.mode = mode;
  W.root?.classList.toggle('wt-drilling', mode === 'drill');
  ['back', 'play', 'next', 'voice', 'rate'].forEach((k) => $(k)?.classList.toggle('hidden', mode === 'drill'));
  ['again', 'show', 'skip'].forEach((k) => $(k)?.classList.toggle('hidden', mode !== 'drill'));
  if ($('drill')) $('drill').textContent = mode === 'drill' ? 'Watch' : 'Drill it';
  if (mode !== 'drill') W.dr = null;
}

const cleanSet = () => new Set(W.clean[W.id] || []);
// Only lines that still exist count, so an edited walkthrough doesn't keep stale ticks.
const cleanCount = () => { const c = cleanSet(); return W.dr.all.filter((l) => c.has(l.key)).length; };

function startDrill(only) {
  if (!W.data) return;
  W.playing = false;
  W.token++;
  silence();
  const all = drillLines(W.data);
  const lines = only ? all.filter((l) => only.has(l.key)) : all;
  if (!lines.length) return;
  setMode('drill');
  W.dr = { all, lines, i: 0, ply: 0, misses: 0, missed: new Set(), sel: null, note: '', fb: '' };
  $('end').classList.add('hidden');
  $('card').classList.add('hidden');
  $('setup').classList.add('hidden');
  startLine(0);
}

function leaveDrill() {
  W.token++;
  setMode('watch');
  const [ch, bt] = W.places[W.id] || [0, 0];
  W.ch = W.data.chapters[ch] ? ch : 0;
  W.beat = W.data.chapters[W.ch].beats[bt] ? bt : 0;
}
function stopDrill() {
  leaveDrill();
  showBeat({ speak: false });
}

function drillChapter(ci) {
  // A chapter with nothing to play (an intro, a summary) opens the next line after it.
  const i = W.dr.lines.findIndex((l) => l.ch >= ci);
  if (i >= 0) startLine(i);
}

// The position at the line's start, then the other side's moves up to your first question.
function startLine(i) {
  const dr = W.dr;
  W.token++;
  dr.i = i;
  dr.ply = 0;
  dr.misses = 0;
  dr.sel = null;
  dr.fb = '';
  dr.lineMiss = false;
  dr.finished = false;
  dr.marks = null;
  W.arrows?.clear();   // a restarted line has the same position, but the old arrows are stale
  const line = dr.lines[i];
  W.ch = line.ch;
  W.beat = line.moves[0].beat;
  W.game = new Chess();
  line.start.forEach((m) => { W.last = W.game.move(m); });
  if (!line.start.length) W.last = null;
  dr.note = line.start.length ? 'From this position.' : 'From the start.';
  autoPlay();
}

const curMove = () => W.dr.lines[W.dr.i].moves[W.dr.ply];

async function autoPlay() {
  const dr = W.dr, token = W.token;
  drillRender();
  while (dr.ply < dr.lines[dr.i].moves.length && !curMove().ask) {
    await wait(DRILL_GAP / W.rate);
    if (token !== W.token) return;
    W.last = W.game.move(curMove().san);
    moveSound(W.last, W.game.inCheck());
    dr.ply++;
    drillRender();
    slideLast();
  }
  if (dr.ply >= dr.lines[dr.i].moves.length) lineDone();
}

function drillSquare(sq) {
  const dr = W.dr;
  const want = curMove();
  if (!want || !want.ask) return;
  if (dr.sel) {
    const m = W.game.moves({ square: dr.sel, verbose: true }).find((x) => x.to === sq);
    if (m) return tryMove(m);
  }
  const p = W.game.get(sq);
  dr.sel = p && p.color === W.game.turn() && dr.sel !== sq ? sq : null;
  drawBoard();
}

function tryMove(m) {
  const dr = W.dr;
  const want = new Chess(W.game.fen()).move(curMove().san);
  dr.sel = null;
  // Any promotion choice counts: the walkthroughs only ever promote to a queen.
  if (m.from === want.from && m.to === want.to) return landMove(want.san);
  dr.misses++;
  dr.lineMiss = true;
  dr.fb = dr.misses === 1 ? `Not the move from the walkthrough. Try again.` : `Still not it. The piece to move is on ${want.from}, or press Show me.`;
  drillRender();
  if (dr.misses > 1) drawMarks({ circle: [want.from] });
  W.root.querySelector(`.el-sq[data-sq="${m.to}"]`)?.classList.add('miss');
}

function showDrillMove() {
  const dr = W.dr;
  if (!dr || !curMove()?.ask) return;
  dr.lineMiss = true;
  landMove(curMove().san, true);
}

function landMove(san, shown = false) {
  const dr = W.dr;
  const mv = curMove();
  W.last = W.game.move(san);
  moveSound(W.last, W.game.inCheck());
  const b = chapter().beats[mv.beat];
  dr.fb = '';
  dr.note = `${shown ? 'That was' : 'Yes,'} ${san}. ${b.say}`;
  dr.misses = 0;
  dr.ply++;
  W.beat = mv.beat;
  dr.marks = { arrows: b.arrows, circle: b.circle };
  autoPlay();   // renders the board at once, so the slide goes on the fresh one
  slideLast();
}

function lineDone() {
  const dr = W.dr, line = dr.lines[dr.i];
  const clean = cleanSet();
  if (dr.lineMiss) { dr.missed.add(line.key); clean.delete(line.key); } else clean.add(line.key);
  W.clean[W.id] = [...clean];
  save();
  dr.fb = dr.lineMiss ? 'Line finished, with help. It comes back when you drill the missed ones.' : 'Line finished, every move found.';
  dr.finished = true;
  drillRender();
}

function nextLine() {
  const dr = W.dr;
  if (!dr || dr.over) return;
  if (!dr.finished) dr.missed.add(dr.lines[dr.i].key);   // skipped counts as not yet known
  dr.finished = false;
  if (dr.i < dr.lines.length - 1) return startLine(dr.i + 1);
  drillSummary();
}

function drillSummary() {
  const dr = W.dr;
  W.token++;
  dr.over = true;
  const total = dr.all.length, clean = cleanCount();
  $('chapter').textContent = 'Drill finished';
  $('title').textContent = W.data.title;
  $('say').textContent = dr.missed.size
    ? `${dr.lines.length - dr.missed.size} of ${dr.lines.length} lines found without help this time. ${clean} of ${total} lines are clean in all.`
    : `All ${dr.lines.length} lines found without help. ${clean} of ${total} lines are clean in all.`;
  $('line').textContent = '';
  const box = $('end');
  box.textContent = '';
  box.classList.remove('hidden');
  const add = (label, fn, primary) => {
    const b = mk('button', `el-btn${primary ? ' primary' : ''}`, label);
    b.type = 'button';
    b.addEventListener('click', fn);
    box.appendChild(b);
  };
  if (dr.missed.size) add('Drill the missed and skipped ones', () => startDrill(new Set(dr.missed)), true);
  add('Drill all again', () => startDrill(), !dr.missed.size);
  add('Back to the walkthrough', stopDrill);
  renderDrillControls(true);
}

function drillRender() {
  const dr = W.dr, line = dr.lines[dr.i];
  $('chapter').textContent = `Drill: line ${dr.i + 1} of ${dr.lines.length}`;
  $('title').textContent = W.data.chapters[line.ch].title;
  const yours = curMove()?.ask;
  $('say').textContent = dr.finished ? dr.note : yours ? `${dr.note} Your move.` : dr.note;
  $('line').textContent = notation(W.game);
  const box = $('end');
  box.textContent = '';
  box.classList.toggle('hidden', !dr.fb && !dr.finished);
  if (dr.fb) box.appendChild(mk('div', `el-fb ${dr.finished && !dr.lineMiss ? 'ok' : dr.finished ? '' : 'no'}`, dr.fb));
  if (dr.finished) {
    const b = mk('button', 'el-btn primary', dr.i < dr.lines.length - 1 ? 'Next line' : 'See how you did');
    b.type = 'button';
    b.addEventListener('click', nextLine);
    box.appendChild(b);
  }
  drawBoard();
  drawMarks(dr.marks || {});
  renderChapters();
  renderDrillControls();
}

function renderDrillControls(over = false) {
  const dr = W.dr;
  $('show').disabled = over || !curMove()?.ask;
  $('again').disabled = over;
  $('skip').disabled = over;
  $('skip').textContent = dr && dr.i === dr.lines.length - 1 ? 'Finish' : 'Skip';
  $('pos').textContent = `${cleanCount()} of ${dr.all.length} lines clean`;
}

/* ---------- boot ---------- */
function build(root) {
  W.root = root;
  root.innerHTML = `
    <div class="wt-stage">
      <section class="wt-left">
        <div class="el-board-wrap">
          <div class="el-board" data-wt="board"></div>
          <svg class="el-arrows wt-marks" data-wt="marks" viewBox="0 0 8 8" aria-hidden="true"></svg>
          <div class="wt-card hidden" data-wt="card"></div>
        </div>
        <div class="el-controls">
          <button class="el-btn" data-wt="back" type="button" title="Left arrow">Back</button>
          <button class="el-btn primary" data-wt="play" type="button" title="Space">Play</button>
          <button class="el-btn" data-wt="next" type="button" title="Right arrow">Next</button>
          <button class="el-btn" data-wt="voice" type="button"></button>
          <button class="el-btn" data-wt="rate" type="button" title="Speed" aria-label="Playback speed"></button>
          <button class="el-btn hidden" data-wt="again" type="button">Restart line</button>
          <button class="el-btn primary hidden" data-wt="show" type="button">Show me</button>
          <button class="el-btn hidden" data-wt="skip" type="button" title="Right arrow">Skip</button>
          <button class="el-btn" data-wt="drill" type="button" title="Play your side's moves yourself">Drill it</button>
          <span class="el-pos" data-wt="pos"></span>
        </div>
      </section>
      <section class="wt-right">
        <div class="wt-now">
          <div class="eyebrow" data-wt="chapter"></div>
          <h2 data-wt="title"></h2>
          <p class="wt-say" data-wt="say" aria-live="polite"></p>
          <div class="el-moves" data-wt="line"></div>
          <div class="wt-end hidden" data-wt="end"></div>
          <div class="wt-setup hidden" data-wt="setup"></div>
        </div>
        <ol class="wt-chapters" data-wt="chapters"></ol>
      </section>
    </div>`;
  $('drill').addEventListener('click', () => (W.mode === 'drill' ? stopDrill() : startDrill()));
  $('again').addEventListener('click', () => startLine(W.dr.i));
  $('show').addEventListener('click', showDrillMove);
  $('skip').addEventListener('click', () => nextLine());
  // Drill: tap a piece then a square, or drag it there.
  $('board').addEventListener('pointerdown', (e) => {
    const sq = e.target.closest('.el-sq')?.dataset.sq;
    if (!sq || e.button !== 0 || !e.isPrimary || W.mode !== 'drill') return;
    // Pressing the piece that is already picked: drag it, or a tap puts it down.
    if (W.dr.sel === sq) return followDrag(e, $('board'), sq, (to) => drillSquare(to), () => drillSquare(sq));
    drillSquare(sq);
    if (W.dr?.sel === sq) followDrag(e, $('board'), sq, (to) => drillSquare(to));
  });
  W.arrows = userArrows($('board').parentElement);   // right-drag to draw your own arrows
  $('play').addEventListener('click', togglePlay);
  $('next').addEventListener('click', next);
  $('back').addEventListener('click', back);
  $('voice').addEventListener('click', () => {
    W.voice = !W.voice;
    if (!W.voice) silence();
    save();
    if (W.playing) showBeat();
    else renderControls();
  });
  $('rate').addEventListener('click', () => {
    W.rate = RATES[(RATES.indexOf(W.rate) + 1) % RATES.length];
    save();
    if (W.playing) showBeat();
    else renderControls();
  });
  // Voices can arrive after the first render.
  synth?.addEventListener?.('voiceschanged', () => { if (W.data) renderControls(); });
}

function buildChapters() {
  const list = $('chapters');
  list.textContent = '';
  W.data.chapters.forEach((c, i) => {
    const li = mk('li');
    const b = mk('button', 'wt-chapter');
    b.type = 'button';
    b.append(mk('span', '', c.title), mk('i'));
    b.addEventListener('click', () => jump(i));
    li.appendChild(b);
    list.appendChild(li);
  });
}

export async function openWalkthrough(root, id, actions = {}) {
  if (!W.root) {
    load();
    build(root);
  }
  const pick = ++W.pick;   // a slow fetch must not override a later choice
  if (W.mode === 'drill') leaveDrill();
  pause();
  try {
    if (!W.cache[id]) {
      const r = await fetch(`walkthroughs/${id}.json`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      W.cache[id] = await r.json();
    }
  } catch (err) {
    if (pick !== W.pick) return;
    // Nothing behind the controls now, or Play would resume the walkthrough open before this one.
    W.token++;
    W.playing = false;
    silence();
    W.data = null;
    $('chapters').textContent = '';
    drawMarks();
    $('card').classList.add('hidden');
    $('end').classList.add('hidden');
    ['play', 'next', 'back'].forEach((k) => { $(k).disabled = true; });
    $('title').textContent = "Couldn't load this walkthrough";
    $('say').textContent = err instanceof TypeError ? 'The file could not be reached. On this computer the app server has probably stopped: run start-chess.cmd, then reopen the app. On the website, check your internet connection.' : String(err.message || err);
    return;
  }
  if (pick !== W.pick) return;
  W.token++;   // Play pressed while the file was on its way belongs to the old walkthrough
  W.playing = false;
  silence();
  W.actions = actions;
  W.id = id;
  W.data = W.cache[id];
  $('play').disabled = false;
  buildChapters();
  const [ch, bt] = W.places[id] || [0, 0];
  const c = W.data.chapters[ch];
  W.ch = c ? ch : 0;
  W.beat = c?.beats[bt] ? bt : 0;
  showBeat({ speak: false });   // browsers only allow speech after a click, so wait for Play
}

export function pauseWalkthrough() {
  if (W.mode === 'drill') return;   // nothing talks in a drill, and a pending reply must still land
  W.token++;   // a stepped beat may still be walking its moves on
  if (W.playing || W.speaking) pause();
}

export function walkthroughKey(e) {
  if (W.mode === 'drill') {
    if (e.key === 'ArrowRight') { nextLine(); e.preventDefault(); }
    return;
  }
  if (e.key === 'ArrowRight') { next(); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { back(); e.preventDefault(); }
  else if (e.key === ' ' && !e.target.closest('button')) { togglePlay(); e.preventDefault(); }
}
