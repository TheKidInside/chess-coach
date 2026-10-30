import { Chess } from './vendor/chess.js';
import { OPENINGS, FAMILIES } from './openings.js';
import { STUDY } from './study.js';
import {
  P, loadProfile, save, onEvent, addXp, levelOf, levelStart, todayXp, streakNow, INTERVALS, MASTERED_BOX,
  openingStat, recordOpening, dueOpenings, addMistake, dueMistakes, recordMistakeReview,
  recordPuzzle, puzzleDifficulty, moveAccuracy, recordGame, today, addDays, checkGoal,
} from './profile.js';
import { play as sfx, moveSound, setSound } from './sound.js';
import { renderProgress } from './progress.js';
import { api, isStatic } from './backend.js';

const $ = (s) => document.querySelector(s);
const boardEl = $('#board');
const FILES = 'abcdefgh';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const S = {
  game: new Chess(),
  orient: 'w',
  tab: 'openings',
  omode: 'study',          // study | learn | drill
  opening: OPENINGS[0],    // the line being trained
  family: FAMILIES[0],     // the main opening it belongs to
  reviewQueue: [],         // opening ids still due in the current review session
  colorPref: 'w',          // w | b | r(andom)
  playColor: 'w',
  elo: 1500,
  coachOn: true,
  selected: null,
  arrows: [],              // [{from, to, kind: good|bad|alt}]
  tags: {},                // ply index -> inaccuracy|mistake|blunder
  lossByPly: {},           // ply index -> winning chances lost (your moves in Play)
  recorded: false,         // current Play game already logged
  lastVerdict: null,
  epoch: 0,                // bumps on every reset; stale async results check it
  anaEpoch: 0,
  busy: false,             // waiting on engine / scripted reply
  paused: false,           // coach stopped the game after a mistake
  slips: 0,                // wrong moves in the current opening run
  evalLine: null,
  judgeId: 0,              // per drill attempt, so a slow verdict can't land on a newer one
  saved: {},               // tab -> game kept while you look at other tabs
  viewPly: null,           // null = live position; n = showing the position after n plies
  anim: null,              // {from, to} to slide on the next render
  flash: null,             // {sq, kind} to flash on the next render
  hint: null,              // square to pulse (puzzle hint)
  pz: { src: 'lichess', p: null, mistake: null, color: 'w', step: 0, failed: false, done: false, next: null, pending: null, skipped: new Set() },
  lineDone: false,         // current opening run already recorded
  takebacks: 0,            // take-backs in the current Play game
  chat: [],
  coachStyle: 'standard',  // standard | danya
};

// ------------------------------------------------------------------ server ---

// api() lives in backend.js: it talks to server.py on the laptop, or answers in the
// browser (WASM Stockfish, Lichess, local Qwen) on static hosting like GitHub Pages.

const cache = new Map();
function analyse(fen, movetime = 700, multipv = 1) {
  const key = `${fen}|${multipv}`;
  if (cache.has(key)) return cache.get(key);
  if (cache.size > 400) cache.clear();
  const p = api('/api/analyse', { fen, movetime, multipv });
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

// ------------------------------------------------------------- chess utils ---

function winPct(line) {             // White's winning chances, 0-100
  if (!line) return 50;
  if (line.mate !== undefined) return line.mate > 0 ? 100 : line.mate < 0 ? 0 : 50;
  const cp = Math.max(-1500, Math.min(1500, line.cp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function winPctFor(color, result, fen) {
  let w;
  const line = result.lines[0];
  if (line) w = winPct(line);
  else {                              // no moves: mate or stalemate
    const g = new Chess(fen);
    w = g.isCheckmate() ? (g.turn() === 'w' ? 0 : 100) : 50;
  }
  return color === 'w' ? w : 100 - w;
}

function evalText(line) {
  if (!line) return '–';
  if (line.mate !== undefined) return line.mate === 0 ? '#' : (line.mate > 0 ? 'M' : '-M') + Math.abs(line.mate);
  const v = (line.cp ?? 0) / 100;
  if (Math.abs(v) < 0.05) return '0.0';
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

function uciMove(game, uci) {
  return game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}

function uciToSan(fen, uci) {
  if (!uci) return null;
  try { return uciMove(new Chess(fen), uci).san; } catch { return uci; }
}

function sanSquares(fen, san) {
  const m = new Chess(fen).move(san);
  return { from: m.from, to: m.to };
}

function pvToSan(fen, pv, max = 10) {
  const g = new Chess(fen);
  let num = parseInt(fen.split(' ')[5], 10);
  const out = [];
  for (const [i, uci] of pv.slice(0, max).entries()) {
    const white = g.turn() === 'w';
    let m;
    try { m = uciMove(g, uci); } catch { break; }
    if (white) out.push(`${num}. ${m.san}`);
    else out.push(i === 0 ? `${num}... ${m.san}` : m.san);
    if (!white) num++;
  }
  return out.join(' ');
}

function numberedLine(sans) {
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ');
}

function moveLabel(ply, san) {
  const n = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${n}. ${san}` : `${n}... ${san}`;
}

function cloneGame(g) {   // PGN keeps a non-standard start position in its FEN header
  const c = new Chess();
  c.loadPgn(g.pgn());
  return c;
}

const colorName = (c) => (c === 'w' ? 'White' : 'Black');

// ------------------------------------------------------------ opening names ---

// eco.json: position (first 4 FEN fields) -> [ECO code, name], built from the
// Lichess chess-openings dataset by tools/build_eco.mjs. Keying by position
// means transpositions still get the right name.
let ECO = null;
fetch('eco.json').then((r) => r.json()).then((j) => { ECO = j; render(); }).catch(() => {});

// coaches.json lists the coach styles. A style with "lessons": "<slug>" is a grandmaster's
// teaching, distilled into lessons/<slug>.json; their per-opening advice also shows under
// "From the masters". Adding a GM is a data change: a lessons file plus a style entry.
let COACHES = null;
const LIBS = {};   // slug -> lesson library
fetch('coaches.json').then((r) => r.json()).then(async (c) => {
  COACHES = c;
  await Promise.all(Object.values(c.styles).filter((s) => s.lessons).map((s) => fetch(`lessons/${s.lessons}.json`)
    .then((r) => r.json()).then((j) => { LIBS[s.lessons] = j; }).catch(() => {})));
  $('#coach-styles').innerHTML = Object.entries(c.styles)
    .map(([k, s]) => `<button class="seg-btn" data-style="${esc(k)}">${esc(s.label)}</button>`).join('');
  applyCoachStyle();
  if (S.tab === 'openings') renderFamily();
}).catch(() => {});

function gameOpening(g = S.game) {
  if (!ECO) return null;
  const hist = g.history({ verbose: true });
  let found = null, lastBook = -1;
  hist.forEach((m, i) => {
    const e = ECO[m.after.split(' ').slice(0, 4).join(' ')];
    if (e) { found = e; lastBook = i; }
  });
  const book = new Set(hist.slice(0, lastBook + 1).map((_, i) => i));   // everything up to the last named position is theory
  return found ? { eco: found[0], name: found[1], lastBook, book, total: hist.length } : null;
}

function renderBoardHead(info) {
  const el = $('#opening-name');
  if (S.tab === 'puzzles' && (S.pz.p || S.pz.mistake)) {
    el.innerHTML = S.pz.p
      ? `<b>PUZZLE</b>Rated ${Number(S.pz.p.rating) || '?'} · ${colorName(S.pz.color)} to move`
      : `<b>REVIEW</b>Your mistake from ${esc(S.pz.mistake.date)}`;
    return;
  }
  const sans = S.game.history();
  if (!info) {
    el.innerHTML = !sans.length ? '<span class="muted">Starting position</span>'
      : ECO ? '<span class="muted">Opening not in the database</span>' : '';
    return;
  }
  const out = info.lastBook < info.total - 1 ? ` · out of book after ${moveLabel(info.lastBook, sans[info.lastBook])}` : '';
  el.innerHTML = `<b>${info.eco}</b>${esc(info.name)}<span class="muted small">${out}</span>`;
}

// ------------------------------------------------------------------- board ---

function viewGame() {        // the position on screen: live, or an earlier ply while browsing
  if (S.viewPly === null) return S.game;
  const g = cloneGame(S.game);
  for (let n = g.history().length; n > S.viewPly; n--) g.undo();
  return g;
}

function squareAt(x, y) {
  const r = boardEl.getBoundingClientRect();
  const col = Math.floor(((x - r.left) / r.width) * 8);
  const row = Math.floor(((y - r.top) / r.height) * 8);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  const file = S.orient === 'w' ? col : 7 - col;
  const rank = S.orient === 'w' ? 8 - row : row + 1;
  return FILES[file] + rank;
}

function squareCenter(sq) {
  const file = FILES.indexOf(sq[0]), rank = +sq[1];
  const col = S.orient === 'w' ? file : 7 - file;
  const row = S.orient === 'w' ? 8 - rank : rank - 1;
  return [col + 0.5, row + 0.5];
}

function render() {
  const g = viewGame();
  const live = S.viewPly === null;
  const hist = g.history({ verbose: true });
  const last = hist[hist.length - 1];
  let checkSq = null;
  if (g.inCheck()) {
    for (const row of g.board()) for (const p of row) if (p && p.type === 'k' && p.color === g.turn()) checkSq = p.square;
  }
  const targets = live && S.selected ? g.moves({ square: S.selected, verbose: true }).map((m) => m.to) : [];

  const frag = document.createDocumentFragment();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const file = S.orient === 'w' ? col : 7 - col;
      const rank = S.orient === 'w' ? 8 - row : row + 1;
      const sq = FILES[file] + rank;
      const div = document.createElement('div');
      div.className = 'sq ' + ((file + rank) % 2 ? 'dark' : 'light');
      div.dataset.sq = sq;
      if (last && (sq === last.from || sq === last.to)) div.classList.add('last');
      if (live && sq === S.selected) div.classList.add('sel');
      if (sq === checkSq) div.classList.add('check');
      if (live && sq === S.hint) div.classList.add('hint');
      if (live && S.flash && S.flash.sq === sq) div.classList.add(`flash-${S.flash.kind}`);
      const piece = g.get(sq);
      if (targets.includes(sq)) div.classList.add('target', ...(piece ? ['occupied'] : []));
      if (row === 7) div.insertAdjacentHTML('beforeend', `<span class="coord file">${FILES[file]}</span>`);
      if (col === 0) div.insertAdjacentHTML('beforeend', `<span class="coord rank">${rank}</span>`);
      if (piece) {
        const img = document.createElement('img');
        img.className = 'piece';
        img.src = `pieces/${piece.color}${piece.type.toUpperCase()}.svg`;
        img.alt = piece.color + piece.type;
        img.draggable = false;
        div.appendChild(img);
      }
      frag.appendChild(div);
    }
  }
  boardEl.replaceChildren(frag);
  S.flash = null;
  if (S.anim && live) slide(S.anim);
  S.anim = null;
  drawArrows(live);
  const info = gameOpening();
  renderBoardHead(info);
  renderMoves(info ? info.book : new Set());
  $('#live-pill').classList.toggle('hidden', live);
}

function slide({ from, to }) {
  const img = boardEl.querySelector(`.sq[data-sq="${to}"] .piece`);
  if (!img || !img.animate) return;
  const size = boardEl.clientWidth / 8;
  const [x1, y1] = squareCenter(from), [x2, y2] = squareCenter(to);
  img.style.zIndex = 3;
  img.animate([{ transform: `translate(${(x1 - x2) * size}px, ${(y1 - y2) * size}px)` }, { transform: 'none' }],
    { duration: 190, easing: 'cubic-bezier(.22, 1, .36, 1)' });
}

function drawArrows(live = S.viewPly === null) {
  const svg = $('#arrows');
  svg.querySelectorAll('line').forEach((l) => l.remove());
  if (!live) return;
  for (const a of S.arrows) {
    const [x1, y1] = squareCenter(a.from);
    const [x2, y2] = squareCenter(a.to);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const k = (len - 0.35) / len;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x1 + (x2 - x1) * k); line.setAttribute('y2', y1 + (y2 - y1) * k);
    line.setAttribute('stroke', `var(--arrow-${a.kind})`);
    line.setAttribute('stroke-width', '0.17');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', `url(#head-${a.kind})`);
    svg.appendChild(line);
  }
}

const TAG_MARK = { inaccuracy: '?!', mistake: '?', blunder: '??' };
function renderMoves(book) {
  const sans = S.game.history();
  const cur = (S.viewPly ?? sans.length) - 1;
  const box = $('#movelist');
  let html = '';
  for (let i = 0; i < sans.length; i += 2) {
    html += `<span class="num">${i / 2 + 1}.</span>`;
    for (const p of [i, i + 1]) {
      if (p >= sans.length) { html += '<span></span>'; continue; }
      const t = S.tags[p];
      const cls = ['mv', p === cur ? 'cur' : '', book.has(p) && !t ? 'book' : ''].filter(Boolean).join(' ');
      html += `<button class="${cls}" data-ply="${p + 1}"${book.has(p) && !t ? ' title="Book move (known opening theory)"' : ''}>${esc(sans[p])}` +
        (t ? `<span class="tag ${t}">${TAG_MARK[t]}</span>` : '') + '</button>';
    }
  }
  box.innerHTML = html;
  const curEl = box.querySelector('.mv.cur');   // scroll only the list, never the page
  if (curEl) {
    const top = curEl.offsetTop - box.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + curEl.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + curEl.offsetHeight - box.clientHeight;
  }
}

$('#movelist').addEventListener('click', (e) => {
  const b = e.target.closest('.mv');
  if (b) navTo(+b.dataset.ply);
});

function navTo(ply) {   // Study steps through its line; everywhere else this browses back through the game
  if (studying()) studyGo(ply);
  else setView(ply);
}

function setView(ply) {
  const n = S.game.history().length;
  ply = Math.max(0, Math.min(n, ply));
  S.viewPly = ply >= n ? null : ply;
  S.selected = null;
  if (S.tab === 'analyze') S.arrows = [];
  render();
  if (S.tab === 'analyze') runAnalysis();
}

function updateEval(line) {
  S.evalLine = line;
  const w = line ? winPct(line) : 50;
  $('#evalfill').style.height = `${S.orient === 'w' ? w : 100 - w}%`;
  $('#evaltext').textContent = line ? evalText(line) : '–';
}

// Every programmatic move goes through here: slide animation, sound, back to live view.
function applyMove(move, { animate = true } = {}) {
  const mv = typeof move === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move) ? uciMove(S.game, move) : S.game.move(move);
  S.viewPly = null;
  if (animate) S.anim = { from: mv.from, to: mv.to };
  moveSound(mv, S.game.inCheck());
  return mv;
}

// ------------------------------------------------------------------- input ---

function userColorCanMove(color) {
  if (S.tab === 'analyze') return true;
  if (S.tab === 'progress') return false;
  const mine = S.tab === 'openings' ? S.opening.side : S.tab === 'puzzles' ? S.pz.color : S.playColor;
  return color === mine;
}

function inputLocked() {
  if (S.viewPly !== null || studying()) return true;
  if (S.tab === 'puzzles' && (S.pz.done || (!S.pz.p && !S.pz.mistake))) return true;
  if (S.tab === 'play' && S.recorded) return true;
  return S.busy || S.paused || S.game.isGameOver();
}

boardEl.addEventListener('pointerdown', (e) => {
  const sq = squareAt(e.clientX, e.clientY);
  if (!sq) return;
  if (S.viewPly !== null) { setView(S.game.history().length); return; }   // clicking the board returns to live
  if (inputLocked()) return;
  const piece = S.game.get(sq);
  if (piece && piece.color === S.game.turn() && userColorCanMove(piece.color)) {
    S.selected = sq;
    render();
    startDrag(e, sq);
    return;
  }
  if (S.selected && tryMove(S.selected, sq, true)) return;
  S.selected = null;
  render();
});

function startDrag(e, from) {
  const img = boardEl.querySelector(`.sq[data-sq="${from}"] .piece`);
  if (!img) return;
  const r = img.getBoundingClientRect();
  const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
  let moved = false;
  const onMove = (ev) => {
    moved = true;
    img.classList.add('dragging');
    img.style.transform = `translate(${ev.clientX - ox}px, ${ev.clientY - oy}px) scale(1.08)`;
  };
  const onUp = (ev) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    img.style.transform = '';
    img.classList.remove('dragging');
    const to = squareAt(ev.clientX, ev.clientY);
    if (moved && to && to !== from && !tryMove(from, to, false)) { S.selected = null; render(); }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function promotionFor(from, to) {   // auto-queen, except when the puzzle's answer under-promotes
  const z = S.pz;
  const want = S.tab === 'puzzles' && !z.done && (z.p ? z.p.solution[z.step] : z.mistake?.best);
  return want && want.length === 5 && want.startsWith(from + to) ? want[4] : 'q';
}

function tryMove(from, to, animate) {
  const legal = S.game.moves({ square: from, verbose: true }).find((m) => m.to === to);
  if (!legal) return false;
  const fenBefore = S.game.fen();
  pruneTags();
  if (S.tab === 'analyze') S.lastVerdict = null;
  const mv = applyMove({ from, to, promotion: legal.promotion ? promotionFor(from, to) : undefined }, { animate });
  S.selected = null;
  S.arrows = [];
  S.hint = null;
  render();
  if (S.tab === 'openings') onOpeningMove(mv, fenBefore);
  else if (S.tab === 'play') onPlayMove(mv, fenBefore);
  else if (S.tab === 'puzzles') onPuzzleMove(mv, fenBefore);
  else runAnalysis();
  refreshChips();
  return true;
}

// --------------------------------------------------------------- UI helpers ---

function banner(kind, html, actions = []) {
  const el = $('#banner');
  el.className = `banner ${kind}`;
  el.innerHTML = html;
  if (actions.length) {
    const box = document.createElement('div');
    box.className = 'actions';
    for (const [label, fn, primary] of actions) {
      const b = document.createElement('button');
      b.textContent = label;
      if (primary) b.className = 'primary';
      b.onclick = fn;
      box.appendChild(b);
    }
    el.appendChild(box);
  }
}
function hideBanner() { $('#banner').className = 'banner hidden'; }

function toast(html, big = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (big ? ' big' : '');
  t.innerHTML = html;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, big ? 3200 : 1900);
}

function verdictText(v) {
  const loss = Math.round(v.loss);
  if (v.cls === 'best') return `<b>${v.label}</b>: Stockfish's top choice.`;
  if (v.cls === 'good') return `<b>${v.label}</b>: good move${v.loss >= 5 && v.bestSan ? ` (Stockfish slightly preferred <b>${v.bestSan}</b>)` : ''}.`;
  const name = { inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder' }[v.cls];
  return `<b>${name}: ${v.label}${TAG_MARK[v.cls]}</b> costs about ${loss}% winning chances (eval ${v.evalBefore} → ${v.evalAfter}, White's view).` +
    (v.replySan ? ` It allows <b>${v.replySan}</b>.` : '') +
    (v.bestSan ? ` Better was <b>${v.bestSan}</b>.` : '');
}

// Compare the position before and after the student's move from their side.
async function judge(fenBefore, fenAfter, mv) {
  const [before, after] = await Promise.all([analyse(fenBefore), analyse(fenAfter)]);
  const loss = Math.max(0, winPctFor(mv.color, before, fenBefore) - winPctFor(mv.color, after, fenAfter));
  const uci = mv.from + mv.to + (mv.promotion || '');
  const isBest = before.bestmove === uci;
  const cls = isBest ? 'best' : loss >= 30 ? 'blunder' : loss >= 20 ? 'mistake' : loss >= 10 ? 'inaccuracy' : 'good';
  const num = parseInt(fenBefore.split(' ')[5], 10);
  return {
    cls, loss: isBest ? 0 : loss, san: mv.san,
    label: mv.color === 'w' ? `${num}. ${mv.san}` : `${num}... ${mv.san}`,
    bestUci: isBest ? null : before.bestmove,
    bestSan: isBest ? null : uciToSan(fenBefore, before.bestmove),
    replySan: after.bestmove ? uciToSan(fenAfter, after.bestmove) : null,
    evalBefore: evalText(before.lines[0]),
    evalAfter: evalText(after.lines[0]),
    afterLine: after.lines[0],
    from: mv.from, to: mv.to,
  };
}

// --------------------------------------------------------------------- HUD ---

function updateHud() {
  const d = P.data;
  const s = streakNow();
  $('#streak-num').textContent = s;
  $('#hud-streak').classList.toggle('lit', s > 0 && d.streak.last === today());
  const x = todayXp();
  $('#goal-num').textContent = x;
  $('#goal-max').textContent = d.goal;
  $('#goal-ring').style.strokeDashoffset = 94.25 * (1 - Math.min(1, x / d.goal));
  $('#hud-goal').classList.toggle('done', x >= d.goal);
  const lvl = levelOf(d.xp), lo = levelStart(lvl), hi = levelStart(lvl + 1);
  $('#lvl-num').textContent = lvl;
  $('#xp-fill').style.width = `${((d.xp - lo) / (hi - lo)) * 100}%`;
  const due = dueOpenings(OPENINGS).length;
  $('#due-badge').textContent = due;
  $('#due-badge').classList.toggle('hidden', !due);
  const mDue = dueMistakes().length;
  $('#mistake-count').textContent = mDue ? `(${mDue})` : '';
}

onEvent((ev) => {
  if (ev.type === 'xp') { sfx('xp'); toast(`<b>+${ev.amount} XP</b>${esc(ev.reason)}`); }
  if (ev.type === 'goal') { sfx('goal'); toast(`<b>Daily goal hit</b>Streak: ${ev.streak} day${ev.streak > 1 ? 's' : ''}. Come back tomorrow to keep it going.`, true); }
  if (ev.type === 'level') { sfx('level'); toast(`<b>Level ${ev.level}</b>Keep stacking reps.`, true); }
  updateHud();
});

// ---------------------------------------------------------------- openings ---

// The repertoire is a list of main openings (FAMILIES); each is a main line plus
// branches (variations, transpositions). Every line is reviewed on its own schedule.
const LINE = new Map(OPENINGS.map((o) => [o.id, o]));
const FAMILY = new Map(FAMILIES.map((f) => [f.id, f]));
const familyOf = (o) => FAMILY.get(o.family);
const familyLines = (f) => f.lines.map((id) => LINE.get(id));
const mainOf = (f) => LINE.get(f.lines[0]);

const OPENING_GROUPS = [
  ['As White · 1.e4', (o) => o.side === 'w' && o.moves[0] === 'e4'],
  ['As White · 1.d4 / 1.c4', (o) => o.side === 'w' && o.moves[0] !== 'e4'],
  ['As Black · vs 1.e4', (o) => o.side === 'b' && o.moves[0] === 'e4'],
  ['As Black · vs 1.d4', (o) => o.side === 'b' && o.moves[0] !== 'e4'],
];
const LEVELS = ['', 'Beginner', 'Intermediate', 'Sharp'];

function pips(box) {
  return `<span class="pips${box >= MASTERED_BOX ? ' mastered' : ''}" title="Memory strength ${box}/5${box >= MASTERED_BOX ? ' (mastered)' : ''}">` +
    [1, 2, 3, 4, 5].map((i) => `<i class="${i <= box ? 'on' : ''}"></i>`).join('') + '</span>';
}

const isDue = (o) => { const st = openingStat(o.id); return !!st && st.due <= today(); };

function familyBar(f) {   // how well the whole opening is known: average memory box over its lines
  const lines = familyLines(f);
  const boxes = lines.map((o) => openingStat(o.id)?.box || 0);
  const mastered = boxes.filter((b) => b >= MASTERED_BOX).length;
  const pct = (boxes.reduce((a, b) => a + b, 0) / (5 * lines.length)) * 100;
  return `<span class="fbar${mastered === lines.length ? ' mastered' : ''}" title="${mastered} of ${lines.length} lines mastered"><i style="width:${pct}%"></i></span>`;
}

function fillOpeningList() {
  const list = $('#opening-list');
  const scroll = list.scrollTop;
  list.innerHTML = '';
  for (const [label, test] of OPENING_GROUPS) {
    list.insertAdjacentHTML('beforeend', `<div class="olist-group eyebrow">${label}</div>`);
    for (const f of FAMILIES.filter((x) => test(mainOf(x)))) {
      const lines = familyLines(f);
      const due = lines.filter(isDue).length;
      const row = document.createElement('button');
      row.className = 'orow' + (f === S.family ? ' active' : '');
      row.dataset.id = f.id;
      row.innerHTML = `<span class="oname">${due ? '<span class="due">Due</span>' : ''}${esc(f.name)}` +
        `<span class="oeco">${lines.length} line${lines.length > 1 ? 's' : ''}</span></span>` +
        `<span class="olvl l${mainOf(f).level}">${LEVELS[mainOf(f).level]}</span>` + familyBar(f);
      row.onclick = () => selectFamily(f);
      list.appendChild(row);
    }
  }
  list.scrollTop = scroll;
  renderRepHead();
  renderReviewStrip();
}

function renderRepHead() {
  const open = !$('#repertoire').classList.contains('closed');
  const due = dueOpenings(OPENINGS).length;
  const mastered = OPENINGS.filter((o) => (openingStat(o.id)?.box || 0) >= MASTERED_BOX).length;
  $('#mastery-count').textContent = open
    ? `${FAMILIES.length} openings · ${mastered} of ${OPENINGS.length} lines mastered`
    : `${due ? `${due} due · ` : ''}change opening`;
}

function setRepOpen(open) {   // fold the repertoire away while you study one opening
  $('#repertoire').classList.toggle('closed', !open);
  $('#rep-toggle').setAttribute('aria-expanded', String(open));
  if (P.data.settings.repOpen !== open) { P.data.settings.repOpen = open; save(); }
  renderRepHead();
  if (open) $('#opening-list .orow.active')?.scrollIntoView({ block: 'nearest' });
}
$('#rep-toggle').addEventListener('click', () => setRepOpen($('#repertoire').classList.contains('closed')));

function selectFamily(f) {
  S.family = f;
  S.opening = familyLines(f).find(isDue) || mainOf(f);
  S.reviewQueue = [];
  setRepOpen(false);
  fillOpeningList();
  startOpening();
}

// Pick a line inside the current opening. In Study, `atPly` keeps you at the same
// point (a branch shares the moves so far; a transposition reaches the same position).
function selectLine(o, atPly = null) {
  S.opening = o;
  S.family = familyOf(o);
  S.reviewQueue = [];
  fillOpeningList();
  if (atPly === null || S.omode !== 'study') return startOpening();
  startOpening(atPly);
}

function divergence(a, b) {   // first ply where two lines part ways
  let i = 0;
  while (i < a.moves.length && i < b.moves.length && a.moves[i] === b.moves[i]) i++;
  return i;
}

function renderFamily() {
  const f = S.family, main = mainOf(f);
  $('#family-title').textContent = f.name;
  $('#family-idea').textContent = f.idea;
  const gm = Object.values(LIBS).flatMap((lib) => (lib.openings[f.topic || f.id] || []).map((d) => ({ ...d, who: lib.short })));
  $('#masters').classList.toggle('hidden', !f.masters.length && !gm.length);
  $('#masters-list').innerHTML = f.masters.map((m) => `<li>${esc(m)}</li>`).join('') +
    gm.map((d) => `<li class="gm-note"><span class="eyebrow">${esc(d.who)}'s videos</span> ${esc(d.text)} <span class="small">${sourceLinks(d.sources)}</span></li>`).join('');
  const lines = familyLines(f);
  $('#branch-count').textContent = `${lines.length} line${lines.length > 1 ? 's' : ''}`;
  const box = $('#branches');
  box.innerHTML = '';
  for (const o of lines) {
    const d = divergence(o, main);
    const at = o === main ? 'Main' : o.kind === 'transposition' ? 'Order' : d < o.moves.length ? moveLabel(d, o.moves[d]).replace(' ', '') : 'Main';
    const st = openingStat(o.id);
    const row = document.createElement('button');
    row.className = `brow ${o.kind}${o === S.opening ? ' active' : ''}`;
    row.title = o.kind === 'transposition' ? `Another move order into ${LINE.get(o.joins)?.branch || 'this opening'}` : o.name;
    row.innerHTML = `<span class="bmove">${esc(at)}</span><span class="bname">${isDue(o) ? '<span class="due">Due</span>' : ''}${esc(o.branch)}</span>` +
      `<span class="olvl l${o.level}">${LEVELS[o.level]}</span>` + pips(st ? st.box : 0);
    row.onclick = () => { if (o !== S.opening) selectLine(o); };
    box.appendChild(row);
  }
}

function renderReviewStrip() {
  const el = $('#review-strip');
  const due = dueOpenings(OPENINGS);
  const started = OPENINGS.filter((o) => openingStat(o.id));
  if (due.length) {
    el.className = 'review-strip';
    el.innerHTML = `<div class="rs-text"><b>${due.length} line${due.length > 1 ? 's' : ''} due for review</b>Drill ${due.length > 1 ? 'them' : 'it'} from memory before ${due.length > 1 ? 'they fade' : 'it fades'}. Bonus XP for each.</div>`;
    const b = document.createElement('button');
    b.className = 'primary';
    b.textContent = 'Review now';
    b.onclick = startReview;
    el.appendChild(b);
  } else if (started.length) {
    const next = started.map((o) => openingStat(o.id).due).sort()[0];
    el.className = 'review-strip clear';
    el.innerHTML = `<div class="rs-text"><b>All caught up</b>Next review ${next <= today() ? 'later today' : next === addDays(today(), 1) ? 'tomorrow' : `on ${next}`}. Learn a new line to grow your repertoire.</div>`;
  } else {
    el.className = 'review-strip clear';
    el.innerHTML = '<div class="rs-text"><b>Start your repertoire</b>Pick a Beginner opening, Study its main line, then play it in Learn mode. It comes back for a memory drill tomorrow.</div>';
  }
}

function startReview() {
  S.reviewQueue = dueOpenings(OPENINGS).map((o) => o.id);
  setRepOpen(false);
  nextReview();
}

function nextReview() {
  const id = S.reviewQueue.shift();
  if (!id) return;
  S.opening = LINE.get(id);
  S.family = familyOf(S.opening);
  fillOpeningList();
  setOpeningMode('drill');
}

// `atPly` (Study only): start with that many moves of the line already on the board.
function startOpening(atPly = 0) {
  S.epoch++;
  S.game = new Chess();
  const o = S.opening;
  for (let i = 0; i < Math.min(atPly, o.moves.length); i++) S.game.move(o.moves[i]);
  S.viewPly = null;
  S.orient = o.side;
  S.tags = {}; S.slips = 0; S.busy = false; S.paused = false; S.arrows = []; S.lastVerdict = null; S.lineDone = false;
  const st = openingStat(o.id);
  const joins = o.kind === 'transposition' && LINE.get(o.joins);
  renderFamily();
  $('#opening-title').textContent = o.name;
  $('#opening-level').textContent = `${o.eco} · ${LEVELS[o.level]} · you play ${colorName(o.side)} · ${Math.ceil(o.moves.length / 2)} moves` +
    (st ? ` · practised ${st.runs}×` : '') + (joins ? ` · transposes into ${joins.branch}` : '');
  $('#opening-idea').textContent = o.idea;
  $('#study').classList.toggle('hidden', S.omode !== 'study');
  $('#opening-note').innerHTML = '';
  hideBanner();
  updateEval(null);
  if (S.omode === 'study') return studyShow();
  render();
  openingStep();
}

// ------------------------------------------------------------------- study ---
// Study: no board input. Next plays the next move of the line (both sides) and shows
// why it is played; Back undoes. The arrow keys, the move list and the nav buttons
// all step the same way (navTo), so there is one pointer: the moves on the board.

const studying = () => S.tab === 'openings' && S.omode === 'study';
const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

let POSITIONS = null;   // position -> [{ o, ply }] for every line, built on first use
function positionIndex() {
  if (POSITIONS) return POSITIONS;
  POSITIONS = new Map();
  for (const o of OPENINGS) {
    const g = new Chess();
    o.moves.forEach((san, i) => {
      g.move(san);
      const k = posKey(g.fen());
      if (!POSITIONS.has(k)) POSITIONS.set(k, []);
      POSITIONS.get(k).push({ o, ply: i + 1 });
    });
  }
  return POSITIONS;
}

function studyGo(n) {
  const o = S.opening, cur = S.game.history().length;
  n = Math.max(0, Math.min(o.moves.length, n));
  if (n === cur) return;
  S.epoch++;
  if (n === cur + 1) applyMove(o.moves[cur]);
  else {
    S.game = new Chess();
    for (let i = 0; i < n; i++) S.game.move(o.moves[i]);
  }
  hideBanner();
  studyShow();
}

// Lines that part ways from this one right here: same first n moves, a different next move.
// Your own opening's branches first, then other openings of yours that pass through.
function branchesAt(n) {
  const o = S.opening, seen = new Set([o.moves[n]]), out = [];
  const others = n >= 2 ? OPENINGS.filter((x) => x.family !== o.family && x.side === o.side) : [];   // not on move 1: every opening would list
  const pool = [...familyLines(S.family), ...others];
  for (const x of pool) {
    if (x === o || x.moves.length <= n || seen.has(x.moves[n]) || divergence(x, o) < n) continue;
    seen.add(x.moves[n]);
    out.push(x);
  }
  return out.slice(0, 4);
}

// Lines that reach the position on the board by a different move order.
function transpositionsHere() {
  const o = S.opening, n = S.game.history().length;
  if (!n) return [];
  const mine = o.moves.slice(0, n).join();
  return (positionIndex().get(posKey(S.game.fen())) || [])
    .filter((e) => e.o !== o && e.o.side === o.side && e.o.moves.slice(0, e.ply).join() !== mine)
    .slice(0, 2);
}

function studyShow() {
  const o = S.opening, n = S.game.history().length, len = o.moves.length;
  const st = STUDY[o.id] || {};
  S.arrows = (st.show?.[n - 1] || []).map((a) => ({ from: a.slice(0, 2), to: a.slice(2, 4), kind: 'alt' }));
  S.selected = null;
  render();
  let html = `<div class="study-top"><span class="eyebrow">${n ? `Move ${n} of ${len}` : 'Before move 1'}</span>` +
    `<span class="study-bar"><i style="width:${(n / len) * 100}%"></i></span></div>`;
  if (!n) {
    html += `<p class="study-why">${esc(o.idea)}</p><p class="muted small">You play ${colorName(o.side)}. Press Next to see each move and the reasoning behind it.</p>`;
  } else {
    const p = n - 1, yours = (p % 2 === 0 ? 'w' : 'b') === o.side;
    html += `<div class="study-move"><b>${esc(moveLabel(p, o.moves[p]))}</b><span class="who ${yours ? 'you' : 'them'}">${yours ? 'Your move' : 'Their move'}</span></div>` +
      `<p class="study-note">${esc(o.notes[p])}</p>` +
      (st.why?.[p] ? `<p class="study-why">${esc(st.why[p])}</p>` : '') +
      (st.gm?.[p] ? `<div class="gm"><span class="eyebrow">From the masters</span>${esc(st.gm[p])}</div>` : '');
    for (const t of transpositionsHere()) {
      html += `<button class="xlink" data-line="${t.o.id}" data-ply="${t.ply}"><span class="eyebrow">Transposition</span>` +
        `Same position as <b>${esc(t.o.branch)}</b>${t.o.family !== o.family ? ` (${esc(familyOf(t.o).name)})` : ''} after ${esc(moveLabel(t.ply - 1, t.o.moves[t.ply - 1]))}: a different move order, the same game.</button>`;
    }
  }
  if (n === len) {
    html += `<div class="study-end"><b>End of the line.</b> ${esc(o.idea)}</div>`;
  }
  const alts = n < len ? branchesAt(n) : [];
  if (alts.length) {
    html += `<div class="alts"><span class="eyebrow">${S.game.turn() === o.side ? 'Other moves you can play here' : 'Other replies to expect here'}</span>` +
      alts.map((x) => `<button class="chip alt" data-line="${x.id}" data-ply="${n}"><b>${esc(moveLabel(n, x.moves[n]))}</b> ${esc(x.branch)}` +
        `${x.family !== o.family ? ` <span class="muted">· ${esc(familyOf(x).name)}</span>` : ''}</button>`).join('') + '</div>';
  }
  html += '<div class="study-nav">';
  if (n === len) {
    const lines = familyLines(S.family);
    const next = lines[(lines.indexOf(o) + 1) % lines.length];
    html += '<button data-act="learn" class="primary">Learn it</button><button data-act="drill">Drill it</button>' +
      (next !== o ? `<button data-act="branch" data-line="${next.id}">Next branch: ${esc(next.branch)}</button>` : '') +
      '<button data-act="play">Play on vs Stockfish</button><button data-act="again">From the start</button>';
  } else {
    html += `<button data-act="back"${n ? '' : ' disabled'}>Back</button><span class="muted small kbd">← → or Space</span>` +
      `<button data-act="next" class="primary">${n ? 'Next' : 'Start'}</button>`;
  }
  $('#study').innerHTML = html + '</div>';
  refreshChips();
}

$('#study').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.line && b.dataset.act !== 'branch') return selectLine(LINE.get(b.dataset.line), +b.dataset.ply);
  const n = S.game.history().length;
  ({
    next: () => studyGo(n + 1),
    back: () => studyGo(n - 1),
    again: () => studyGo(0),
    learn: () => setOpeningMode('learn'),
    drill: () => setOpeningMode('drill'),
    branch: () => selectLine(LINE.get(b.dataset.line), 0),
    play: continueOpeningInPlay,
  })[b.dataset.act]?.();
});

function openingNote() {
  const o = S.opening;
  const ply = S.game.history().length;
  let html = '';
  if (ply > 0) html += `<p><b>${moveLabel(ply - 1, o.moves[ply - 1])}</b>: ${o.notes[ply - 1]}</p>`;
  if (ply < o.moves.length && S.game.turn() === o.side) {
    html += S.omode === 'learn'
      ? `<p>Your move: <b>${o.moves[ply]}</b> (green arrow). ${o.notes[ply]}</p>`
      : `<p>Your move. Play the book move from memory.</p>`;
  }
  $('#opening-note').innerHTML = html;
}

function openingStep() {
  const o = S.opening;
  const ply = S.game.history().length;
  if (ply >= o.moves.length) return finishOpening();
  if (S.game.turn() !== o.side) {          // scripted opponent reply
    S.busy = true;
    const ep = S.epoch;
    setTimeout(() => {
      if (ep !== S.epoch) return;
      applyMove(o.moves[ply]);
      S.busy = false;
      render();
      openingStep();
    }, 450);
    openingNote();
    return;
  }
  S.arrows = S.omode === 'learn' ? [{ ...sanSquares(S.game.fen(), o.moves[ply]), kind: 'good' }] : [];
  render();
  openingNote();
}

async function onOpeningMove(mv, fenBefore) {
  const o = S.opening;
  const ply = S.game.history().length - 1;
  const expected = o.moves[ply];
  if (expected === undefined) { S.game.undo(); render(); return; }   // line already finished
  const bare = (s) => s.replace(/[+#]$/, '');
  if (bare(mv.san) === bare(expected)) { hideBanner(); return openingStep(); }

  S.game.undo();
  S.slips++;
  sfx('bad');
  S.flash = { sq: mv.to, kind: 'bad' };
  const exp = sanSquares(fenBefore, expected);
  if (S.omode === 'learn') {
    S.arrows = [{ ...exp, kind: 'good' }];
    render();
    banner('warn', `Not this line. Follow the green arrow: <b>${expected}</b>.`);
    return;
  }
  S.arrows = [{ from: mv.from, to: mv.to, kind: 'bad' }, { ...exp, kind: 'good' }];
  render();
  banner('warn', `<b>${esc(mv.san)}</b> isn't the book move. The line plays <b>${expected}</b>: ${o.notes[ply]}<br><span class="small">Checking your move with Stockfish…</span>`,
    [['Try again', () => { hideBanner(); S.arrows = []; render(); }, true]]);
  const ep = S.epoch, id = ++S.judgeId;
  try {
    const fenAfter = new Chess(fenBefore); fenAfter.move(mv.san);
    const v = await judge(fenBefore, fenAfter.fen(), mv);
    if (ep !== S.epoch || id !== S.judgeId || $('#banner').classList.contains('hidden')) return;
    v.takenBack = true;
    S.lastVerdict = v;
    const engineView = v.cls === 'best' || v.cls === 'good'
      ? `Stockfish says <b>${esc(mv.san)}</b> is playable (${v.evalAfter}): a sideline, not an error. Still, learn the main move.`
      : verdictText(v);
    const span = $('#banner .small');
    if (span) span.innerHTML = engineView;
  } catch (e) {
    const span = $('#banner .small');
    if (span && ep === S.epoch && id === S.judgeId) span.textContent = `Engine check failed: ${e.message}`;
  }
}

function finishOpening() {
  if (S.lineDone) return;
  S.lineDone = true;
  const o = S.opening;
  S.arrows = [];
  render();
  openingNote();
  const before = openingStat(o.id);
  const boxBefore = before ? before.box : 0;
  const r = recordOpening(o.id, S.omode, S.slips);
  const slips = `${S.slips} slip${S.slips > 1 ? 's' : ''}`;
  let msg;
  if (S.omode === 'learn') {
    msg = `Line complete${S.slips ? ` (${slips})` : ''}. ${r.isNew ? 'It comes back tomorrow for a memory drill.' : 'Drill it from memory to lock it in.'}`;
    if (r.isNew) addXp(10, 'New line learned');
  } else if (r.ok && r.moved) {
    const days = INTERVALS[r.box];
    msg = `Clean drill. Next review in ${days} day${days > 1 ? 's' : ''}.`;
    addXp(r.wasDue ? 35 : 20, r.wasDue ? 'Review complete' : 'First clean drill');
    sfx('good');
    if (r.box >= MASTERED_BOX && boxBefore < MASTERED_BOX) toast(`<b>Mastered</b>${esc(o.name)}`, true);
  } else if (r.ok) {
    msg = `Clean run. It isn't due until ${r.due}, so this was practice: the review schedule doesn't change.`;
    if (r.firstToday) addXp(5, 'Practice');
    sfx('good');
  } else {
    msg = `${slips}. This line comes back tomorrow.`;
  }
  fillOpeningList();
  const actions = [];
  if (S.reviewQueue.length) actions.push([`Next due line (${S.reviewQueue.length} left)`, nextReview, true]);
  actions.push(['Again', startOpening, !S.reviewQueue.length]);
  if (S.omode === 'learn') actions.push(['Drill it', () => setOpeningMode('drill')]);
  actions.push(['Play on vs Stockfish', continueOpeningInPlay]);
  banner(r.ok || S.omode === 'learn' ? 'ok' : 'warn', `<b>${msg}</b><br><span class="small">${esc(o.name)}: ${esc(o.idea)}</span>`, actions);
}

function continueOpeningInPlay() {
  const parked = S.saved.play;
  if (parked && !parked.recorded && parked.game.history().length && !parked.game.isGameOver()
    && !confirm('You have a game in progress in Play. Abandon it and play on from this opening?')) return;
  const sans = S.game.history();
  S.playColor = S.opening.side;
  switchTab('play', false);
  S.saved.play = null;
  S.epoch++;
  S.game = new Chess();
  for (const san of sans) S.game.move(san);
  resetPlayState();
  S.orient = S.playColor;
  hideBanner();
  render();
  afterPositionChange();
}

const OMODE_HINTS = {
  study: 'Step through the line with Next. Every move comes with the reasoning behind it; blue arrows show the idea.',
  learn: 'Arrows show every move. Read the note, then play it.',
  drill: 'No arrows. Play the line from memory; a clean run moves it up a review box.',
};

function setOpeningMode(mode) {
  S.omode = mode;
  document.querySelectorAll('[data-omode]').forEach((b) => b.classList.toggle('active', b.dataset.omode === mode));
  $('#omode-hint').textContent = OMODE_HINTS[mode];
  syncToolButtons();
  startOpening();
}

// ----------------------------------------------------------------- puzzles ---

function pzStatus(kind, html) {
  const el = $('#pz-status');
  el.className = `pz-status${kind ? ' ' + kind : ''}`;
  el.innerHTML = html;
}

function renderPuzzleStats(delta) {
  const p = P.data.puzzles;
  $('#pz-rating').textContent = p.rating;
  $('#pz-run').textContent = p.run;
  $('#pz-best').textContent = p.bestRun;
  $('#pz-solved').textContent = p.solved;
  const total = p.solved + p.failed;
  $('#pz-rate').textContent = total ? `${Math.round((p.solved / total) * 100)}% first try` : '';
  const d = $('#pz-delta');
  if (delta === undefined) { d.textContent = ''; return; }
  d.textContent = delta >= 0 ? `+${delta}` : `${delta}`;
  d.className = `delta ${delta >= 0 ? 'up' : 'down'}`;
}

function puzzleButtons() {
  const z = S.pz;
  const active = (z.p || z.mistake) && !z.done;
  $('#pz-hint').disabled = !active || S.busy;
  $('#pz-solution').disabled = !active || S.busy;
  $('#pz-next').textContent = z.src === 'mistakes' ? 'Next mistake' : 'Next puzzle';
  $('#pz-theme-field').classList.toggle('hidden', z.src !== 'lichess');
}

async function fetchPuzzle() {
  const theme = $('#pz-theme').value;
  for (let i = 0; i < 3; i++) {
    const p = await api(`/api/puzzle?difficulty=${puzzleDifficulty()}&angle=${theme}`);
    if ((!P.data.puzzles.seen.includes(p.id) && p.id !== S.pz.p?.id) || i === 2) return { ...p, theme };
  }
  return null;
}

function prefetchPuzzle() {
  S.pz.next = fetchPuzzle().catch(() => null);
}

async function loadPuzzle() {
  const z = S.pz;
  const ep = ++S.epoch;
  if (z.mistake && !z.done) z.skipped.add(z.mistake.id);   // skipping rotates to the next due mistake
  Object.assign(z, { p: null, mistake: null, step: 0, failed: false, done: false, pending: null });
  S.viewPly = null; S.arrows = []; S.hint = null; S.tags = {}; S.lastVerdict = null; S.busy = false;
  $('#pz-meta').innerHTML = '';
  hideBanner();
  updateEval(null);
  refreshChips();
  if (z.src === 'mistakes') return loadMistake();
  pzStatus('', 'Loading a puzzle…');
  puzzleButtons();
  let p = null;
  try {
    const pre = z.next && (await z.next);
    p = pre && pre.theme === $('#pz-theme').value ? pre : await fetchPuzzle();
  } catch (e) {
    if (ep !== S.epoch) return;
    pzStatus('bad', `<b>Couldn't reach Lichess.</b> ${esc(e.message)}. Check the internet connection, or train on your own mistakes meanwhile.`);
    return;
  }
  if (ep !== S.epoch || S.tab !== 'puzzles') return;
  z.next = null;
  const g = new Chess();
  try { for (const san of p.pgn.split(' ')) g.move(san); } catch { return loadPuzzle(); }
  const last = g.undo();                         // replay the opponent's last move on screen
  z.p = p;
  z.color = last.color === 'w' ? 'b' : 'w';
  z.pending = { kind: 'replay', move: last.san };
  S.game = g;
  S.orient = z.color;
  S.busy = true;
  render();
  puzzleButtons();
  pzStatus('', `<b>${colorName(z.color)} to move.</b> Find the best move.`);
  setTimeout(() => {
    if (ep !== S.epoch) return;
    settlePuzzle();
    S.busy = false;
    render();
    puzzleButtons();
  }, 500);
  prefetchPuzzle();
}

function loadMistake() {
  const z = S.pz;
  const allDue = dueMistakes();
  let due = allDue.filter((m) => !z.skipped.has(m.id));
  if (!due.length && allDue.length) { z.skipped.clear(); due = allDue; }
  if (!due.length) {
    S.game = new Chess();
    render();
    puzzleButtons();
    pzStatus('', P.data.mistakes.length
      ? '<b>No mistakes due.</b> Reviewed ones come back on a schedule. Play more games, or switch to Lichess puzzles.'
      : '<b>Your mistake deck is empty.</b> Play games in the Play tab: every mistake or blunder you make lands here, so you can fix it for good.');
    return;
  }
  const m = due[0];
  z.mistake = m;
  S.game = new Chess(m.fen);
  z.color = S.game.turn();
  S.orient = z.color;
  render();
  puzzleButtons();
  pzStatus('', `<b>You played ${esc(m.played)}${TAG_MARK[m.cls] || ''} here.</b> Find the better move for ${colorName(z.color)}.`);
}

async function onPuzzleMove(mv, fenBefore) {
  const z = S.pz;
  if (z.mistake) return onMistakeMove(mv, fenBefore);
  const uci = mv.from + mv.to + (mv.promotion || '');
  const expected = z.p.solution[z.step];
  if (uci === expected || S.game.isCheckmate()) {
    z.step++;
    S.flash = { sq: mv.to, kind: 'good' };
    render();
    if (z.step >= z.p.solution.length || S.game.isCheckmate()) return puzzleSolved();
    sfx('good');
    pzStatus('ok', '<b>Best move.</b> Keep going.');
    S.busy = true;
    z.pending = { kind: 'reply' };
    puzzleButtons();
    const ep = S.epoch;
    setTimeout(() => {
      if (ep !== S.epoch) return;
      settlePuzzle();
      S.busy = false;
      render();
      puzzleButtons();
      pzStatus('', `<b>${colorName(z.color)} to move.</b> What's the follow-up?`);
    }, 380);
    return;
  }
  sfx('bad');
  S.flash = { sq: mv.to, kind: 'bad' };
  S.busy = true;
  render();
  puzzleFailed();
  pzStatus('bad', '<b>Not it.</b> Try again, or show the solution.');
  z.pending = { kind: 'undo' };
  puzzleButtons();
  const ep = S.epoch;
  setTimeout(() => {
    if (ep !== S.epoch) return;
    settlePuzzle();
    S.busy = false;
    render();
    puzzleButtons();
  }, 450);
}

// Finish whatever scripted step was in flight (also runs when you come back from another tab mid-step).
function settlePuzzle() {
  const z = S.pz, pend = z.pending;
  z.pending = null;
  if (!pend) return;
  if (pend.kind === 'replay') applyMove(pend.move);
  else if (pend.kind === 'reply') { applyMove(z.p.solution[z.step]); z.step++; }
  else if (pend.kind === 'undo') { S.game.undo(); S.viewPly = null; }
}

function puzzleFailed() {   // the first miss (or a hint) is what the rating counts
  const z = S.pz;
  if (z.failed) return;
  z.failed = true;
  const delta = recordPuzzle(z.p, false);
  renderPuzzleStats(delta);
}

function puzzleSolved() {
  const z = S.pz;
  z.done = true;
  S.hint = null;
  puzzleButtons();
  const themes = `<div class="themes">${z.p.themes.map((t) => `<span>${esc(t.replace(/([A-Z])/g, ' $1').toLowerCase())}</span>`).join('')}</div>`;
  $('#pz-meta').innerHTML = `Puzzle ${esc(z.p.id)} · rated ${Number(z.p.rating) || '?'} · <a href="https://lichess.org/training/${encodeURIComponent(z.p.id)}" target="_blank" rel="noopener">open on Lichess</a>${themes}`;
  if (!z.failed) {
    const delta = recordPuzzle(z.p, true);
    renderPuzzleStats(delta);
    sfx('good');
    const run = P.data.puzzles.run;
    pzStatus('ok', `<b>Solved.</b> ${run > 1 ? `${run} in a row. ` : ''}Press Enter for the next one.`);
    addXp(12 + Math.min(12, (run - 1) * 2), run > 2 ? `Puzzle run ×${run}` : 'Puzzle solved');
  } else {
    pzStatus('', '<b>Solved after a miss.</b> The miss already counted. Press Enter for the next one.');
    addXp(3, 'Puzzle finished');
  }
  refreshChips();
}

function showSolution() {
  const z = S.pz;
  if (z.done || S.busy) return;
  if (z.mistake) {
    recordMistakeReview(z.mistake.id, false);
    z.done = true;
    const best = z.mistake.best;
    S.arrows = [{ from: best.slice(0, 2), to: best.slice(2, 4), kind: 'good' }];
    render();
    puzzleButtons();
    pzStatus('', `<b>Best was ${esc(uciToSan(S.game.fen(), best))}.</b> This one comes back tomorrow.`);
    updateHud();
    refreshChips();
    return;
  }
  puzzleFailed();
  S.busy = true;
  S.hint = null;
  puzzleButtons();
  const ep = S.epoch;
  const stepOnce = () => {
    if (ep !== S.epoch) return;
    if (z.step >= z.p.solution.length) {
      S.busy = false;
      z.done = true;
      puzzleButtons();
      pzStatus('', '<b>That was the solution.</b> Step back through it with the arrow keys, or press Enter for the next puzzle.');
      refreshChips();
      return;
    }
    applyMove(z.p.solution[z.step]);
    z.step++;
    render();
    setTimeout(stepOnce, 650);
  };
  stepOnce();
}

function showHint() {
  const z = S.pz;
  if (z.done || S.busy) return;
  const target = z.mistake ? z.mistake.best : z.p.solution[z.step];
  S.hint = target.slice(0, 2);
  if (z.mistake) z.failed = true; else puzzleFailed();
  render();
  pzStatus('', `<b>Hint:</b> move the highlighted piece. ${z.mistake ? 'Hinted fixes come back tomorrow.' : 'Hints count as a miss for your rating.'}`);
}

async function onMistakeMove(mv, fenBefore) {
  const z = S.pz, m = z.mistake;
  const uci = mv.from + mv.to + (mv.promotion || '');
  let ok = uci === m.best;
  const ep = S.epoch;
  if (!ok) {
    S.busy = true;
    z.pending = { kind: 'undo' };
    puzzleButtons();
    pzStatus('', 'Checking with Stockfish…');
    try {
      const v = await judge(fenBefore, S.game.fen(), mv);
      ok = v.loss <= 8;
    } catch { ok = false; }
    if (ep !== S.epoch) return;
    z.pending = null;
    S.busy = false;
  }
  if (ok) {
    z.done = true;
    S.hint = null;
    S.flash = { sq: mv.to, kind: 'good' };
    if (uci !== m.best) S.arrows = [{ from: m.best.slice(0, 2), to: m.best.slice(2, 4), kind: 'alt' }];
    render();
    sfx('good');
    recordMistakeReview(m.id, !z.failed);
    const days = INTERVALS[m.box];
    pzStatus('ok', z.failed ? '<b>Got it on a retry.</b> It comes back tomorrow.'
      : `<b>Fixed.</b> ${uci === m.best ? 'That is the engine move.' : 'Stockfish agrees that works too (blue arrow: its first choice).'} Next review in ${days} day${days > 1 ? 's' : ''}.`);
    if (!z.failed) addXp(15, 'Mistake fixed');
    puzzleButtons();
    updateHud();
    refreshChips();
    return;
  }
  sfx('bad');
  S.flash = { sq: mv.to, kind: 'bad' };
  z.failed = true;
  S.game.undo();
  S.viewPly = null;
  render();
  puzzleButtons();
  pzStatus('bad', '<b>Still not the move.</b> Look for checks, captures and threats first.');
}

$('#pz-next').addEventListener('click', loadPuzzle);
$('#pz-hint').addEventListener('click', showHint);
$('#pz-solution').addEventListener('click', showSolution);
$('#pz-theme').addEventListener('change', () => { S.pz.next = null; loadPuzzle(); });
document.querySelectorAll('[data-psrc]').forEach((b) => b.addEventListener('click', () => {
  S.pz.src = b.dataset.psrc;
  document.querySelectorAll('[data-psrc]').forEach((x) => x.classList.toggle('active', x === b));
  loadPuzzle();
}));

// -------------------------------------------------------------------- play ---

function setPlayNote(html) { $('#play-note').innerHTML = html; }

function resetPlayState() {
  S.tags = {}; S.lossByPly = {}; S.recorded = false; S.takebacks = 0;
  S.paused = false; S.busy = false; S.arrows = []; S.lastVerdict = null; S.viewPly = null;
}

function oppLabel(elo = S.elo) {
  const max = +$('#play-elo').max;
  if (elo >= max) return 'Stockfish · full strength';
  const tier = elo < 1500 ? 'Casual' : elo < 1800 ? 'Club' : elo < 2100 ? 'Strong club' : elo < 2500 ? 'Expert' : 'Master';
  return `${tier} · ${elo}`;
}

function gameInProgress() {
  return S.tab === 'play' && !S.recorded && S.game.history().length > 0 && !S.game.isGameOver();
}

function resumePlay() {
  const saved = S.saved.play;
  S.saved.play = null;
  if (!saved || saved.game.isGameOver() || saved.game.history().length === 0 || saved.recorded) return newGame();
  S.game = saved.game; S.tags = saved.tags; S.lossByPly = saved.lossByPly; S.lastVerdict = saved.verdict; S.recorded = false; S.takebacks = saved.takebacks || 0;
  S.orient = S.playColor; S.arrows = []; S.viewPly = null;
  setPlayNote('Game resumed.');
  render();
  afterPositionChange();
}

function newGame() {
  S.saved.play = null;
  S.epoch++;
  S.game = new Chess();
  S.playColor = S.colorPref === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : S.colorPref;
  S.orient = S.playColor;
  resetPlayState();
  hideBanner();
  updateEval(null);
  setPlayNote(`You have ${colorName(S.playColor)} against ${oppLabel()}. ${S.coachOn ? 'The coach checks every move.' : 'Coach is off; accuracy is still scored.'}`);
  render();
  refreshChips();
  afterPositionChange();
}

function afterPositionChange() {
  if (gameOver()) return;
  if (S.game.turn() !== S.playColor) return engineReply();
  const fen = S.game.fen();   // prefetch so the verdict is instant
  analyse(fen).then((r) => { if (S.game.fen() === fen) updateEval(r.lines[0]); }).catch(() => {});
}

function accuracy(lossByPly = S.lossByPly) {
  const losses = Object.values(lossByPly);
  if (!losses.length) return null;
  return Math.round(losses.reduce((a, l) => a + moveAccuracy(l), 0) / losses.length);
}

function gameOver() {
  const g = S.game;
  if (!g.isGameOver()) return false;
  let msg, result;
  if (g.isCheckmate()) {
    result = g.turn() === S.playColor ? 'loss' : 'win';
    msg = result === 'win' ? 'Checkmate. You win.' : 'Checkmate. Stockfish wins.';
  } else {
    result = 'draw';
    msg = g.isStalemate() ? 'Stalemate. Draw.' : g.isThreefoldRepetition() ? 'Draw by repetition.'
      : g.isInsufficientMaterial() ? 'Draw: insufficient material.' : 'Draw by the 50-move rule.';
  }
  if (S.tab === 'play') finishGame(result, msg, false);
  return true;
}

async function finishGame(result, msg, resigned) {
  if (S.recorded) return;
  S.recorded = true;
  const ep = S.epoch;
  // snapshot now: a new game or tab switch while we wait must not lose this one
  const snap = { game: S.game, tags: S.tags, lossByPly: S.lossByPly, color: S.playColor, elo: S.elo, opp: oppLabel(), takebacks: S.takebacks };
  await waitForJudging();
  const acc = accuracy(snap.lossByPly);
  const counts = { inaccuracy: 0, mistake: 0, blunder: 0 };
  for (const t of Object.values(snap.tags)) counts[t]++;
  const myMoves = Object.keys(snap.lossByPly).length;
  recordGame({ result, resigned, color: snap.color, elo: snap.elo, oppLabel: snap.opp, acc, counts, takebacks: snap.takebacks, moves: snap.game.history().length, pgn: snap.game.pgn() });
  // XP for finished games only: resigning or a very short game pays nothing, take-backs halve it
  let xp = !resigned && myMoves >= 10 ? 15 + (result === 'win' ? 25 : result === 'draw' ? 10 : 0) + Math.round((acc || 0) / 10) : 0;
  if (snap.takebacks) xp = Math.floor(xp / 2);
  if (xp) addXp(xp, result === 'win' ? 'Game won' : 'Game finished');
  updateHud();
  if (ep !== S.epoch || S.tab !== 'play') return;
  sfx(result === 'win' ? 'good' : result === 'loss' ? 'bad' : 'move');
  const dueM = dueMistakes().length;
  const actions = [['Rematch', newGame, true], ['Analyze this game', () => switchTab('analyze')]];
  if (dueM) actions.push([`Fix my mistakes (${dueM})`, () => { S.pz.src = 'mistakes'; S.saved.puzzles = null; document.querySelectorAll('[data-psrc]').forEach((x) => x.classList.toggle('active', x.dataset.psrc === 'mistakes')); switchTab('puzzles'); }]);
  banner(result === 'loss' ? 'bad' : 'ok',
    `<b>${msg}</b>${xpNote(resigned, myMoves, snap.takebacks)}
     <div class="summary">
       <div><b>${acc ?? '–'}${acc === null ? '' : '%'}</b><span>Accuracy</span></div>
       <div><b>${counts.inaccuracy}</b><span>Inaccuracies</span></div>
       <div><b>${counts.mistake + counts.blunder}</b><span>Mistakes</span></div>
       <div><b>+${xp}</b><span>XP</span></div>
     </div>`, actions);
  setPlayNote('');
  updateHud();
}

function xpNote(resigned, myMoves, takebacks) {
  const why = resigned ? 'Resigned games earn no XP.' : myMoves < 10 ? 'Short games (under 10 of your moves) earn no XP.'
    : takebacks ? `${takebacks} take-back${takebacks > 1 ? 's' : ''}: XP halved.` : '';
  return why ? `<br><span class="small">${why}</span>` : '';
}

let judging = Promise.resolve();
function waitForJudging() { return judging.catch(() => {}); }

async function onPlayMove(mv, fenBefore) {
  const ep = S.epoch;
  const ply = S.game.history().length - 1;
  const fenAfter = S.game.fen();
  const game = S.game, tags = S.tags, losses = S.lossByPly;
  const p = judge(fenBefore, fenAfter, mv).then((v) => {
    const h = game.history({ verbose: true })[ply];
    if (!h || h.before !== fenBefore || h.san !== mv.san) return null;   // move taken back
    losses[ply] = v.loss;
    if (['inaccuracy', 'mistake', 'blunder'].includes(v.cls)) tags[ply] = v.cls;
    if ((v.cls === 'mistake' || v.cls === 'blunder') && v.bestUci) addMistake({ fen: fenBefore, best: v.bestUci, played: v.label, cls: v.cls });
    return v;
  });
  judging = p;
  if (!S.coachOn) {
    p.then((v) => { if (v) { S.lastVerdict = v; render(); refreshChips(); updateHud(); } }).catch(() => {});
    if (!gameOver()) engineReply();
    return;
  }
  S.busy = true;
  setPlayNote('Coach is checking your move…');
  try {
    const v = await p;
    if (!v || ep !== S.epoch) return;
    S.lastVerdict = v;
    updateEval(v.afterLine);
    render();
    refreshChips();
    updateHud();
    if (v.cls === 'mistake' || v.cls === 'blunder') {
      S.busy = false;
      S.paused = true;
      sfx('bad');
      setPlayNote('Game paused: the coach caught something. It is saved to your mistake deck.');
      banner('bad', verdictText(v), [
        ['Take back & retry', takeBack, true],
        ['Show better move', () => { S.arrows = [{ from: v.from, to: v.to, kind: 'bad' }, ...(v.bestUci ? [{ from: v.bestUci.slice(0, 2), to: v.bestUci.slice(2, 4), kind: 'good' }] : [])]; drawArrows(); }],
        ['Ask the coach why', () => ask(`Why is ${v.label} a ${v.cls}? What was I missing, and why is ${v.bestSan || 'the engine move'} better?`)],
        ['Play on', () => { S.paused = false; hideBanner(); S.arrows = []; drawArrows(); engineReply(); }],
      ]);
      return;
    }
    if (v.cls === 'inaccuracy') banner('warn', verdictText(v));
    else hideBanner();
    const acc = accuracy();
    setPlayNote(verdictText(v) + (acc !== null ? `<br><span class="muted small">Accuracy so far: ${acc}%</span>` : ''));
  } catch (e) {
    if (ep !== S.epoch) return;
    setPlayNote(`Coach unavailable: ${esc(e.message)}`);
  }
  S.busy = false;
  if (!gameOver()) engineReply();
}

async function engineReply() {
  if (gameOver()) return;
  const ep = S.epoch;
  S.busy = true;
  const started = Date.now();
  try {
    const movetime = Math.round(300 + (S.elo - 1320) / 2);
    const r = await api('/api/move', { fen: S.game.fen(), elo: S.elo, movetime });
    const wait = 350 - (Date.now() - started);   // a beat, so instant replies don't feel robotic
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    if (ep !== S.epoch) return;
    if (r.bestmove) applyMove(r.bestmove);
  } catch (e) {
    if (ep !== S.epoch) return;
    S.busy = false;
    banner('bad', `Stockfish didn't answer: ${esc(e.message)}`, [['Retry', () => { hideBanner(); engineReply(); }, true]]);
    return;
  }
  S.busy = false;
  render();
  afterPositionChange();
}

function resign() {
  if (!gameInProgress()) return;
  if (!confirm('Resign this game? It counts as a loss.')) return;
  S.epoch++;
  S.busy = false; S.paused = false;
  finishGame('loss', 'You resigned.', true);
}

// ----------------------------------------------------------------- analyze ---

async function runAnalysis() {
  const ep = ++S.anaEpoch;
  const g = viewGame();
  const fen = g.fen();
  const box = $('#lines');
  if (g.isGameOver()) {
    box.textContent = g.isCheckmate() ? 'Checkmate.' : 'Draw.';
    S.arrows = []; drawArrows();
    return;
  }
  box.innerHTML = '<div class="muted small">Stockfish is thinking…</div>';
  try {
    const r = await analyse(fen, 1200, 3);
    if (ep !== S.anaEpoch || S.tab !== 'analyze') return;
    box.innerHTML = '';
    for (const line of r.lines) {
      const b = document.createElement('button');
      b.className = 'line';
      b.innerHTML = `<span class="ev">${evalText(line)}</span><span>${pvToSan(fen, line.pv || [], 10)}</span>`;
      b.onclick = () => {
        if (S.viewPly !== null || !line.pv || !line.pv[0]) return;
        applyMove(line.pv[0]);
        S.arrows = [];
        render();
        runAnalysis();
      };
      box.appendChild(b);
    }
    S.arrows = r.lines.slice(0, 2).filter((l) => l.pv && l.pv[0])
      .map((l, i) => ({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), kind: i === 0 ? 'good' : 'alt' }));
    drawArrows();
    updateEval(r.lines[0]);
  } catch (e) {
    if (ep === S.anaEpoch) box.textContent = `Engine error: ${e.message}`;
  }
}

$('#btn-load').addEventListener('click', () => {
  const text = $('#load-text').value.trim();
  if (!text) return;
  const g = new Chess();
  try {
    if (/^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7} [wb] /.test(text)) g.load(text);
    else g.loadPgn(text);
  } catch (e) {
    $('#lines').textContent = `Could not load: ${e.message}`;
    return;
  }
  S.game = g; S.tags = {}; S.selected = null; S.viewPly = null;
  render();
  runAnalysis();
});

function copy(text, what) {
  navigator.clipboard.writeText(text).then(() => toast(`<b>Copied</b>${what}`), () => toast(`<b>Copy failed</b>${what}`));
}
$('#btn-copyfen').addEventListener('click', () => copy(viewGame().fen(), 'FEN'));
$('#btn-copypgn').addEventListener('click', () => copy(S.game.pgn(), 'PGN'));

// ---------------------------------------------------------------- controls ---

function pruneTags() {   // drop ?/?? marks for plies that are no longer on the board
  const n = S.game.history().length;
  for (const k of Object.keys(S.tags)) if (+k >= n) delete S.tags[k];
  for (const k of Object.keys(S.lossByPly)) if (+k >= n) delete S.lossByPly[k];
}

function takeBack() {
  if (S.tab === 'puzzles' || S.tab === 'progress') return;
  if (S.tab === 'play' && S.recorded) return;
  if (S.tab === 'openings' && S.lineDone) return;   // finished lines are recorded; use Again
  if (studying()) return studyGo(S.game.history().length - 1);
  if (S.game.history().length === 0) return;   // nothing to undo; don't cancel a pending first reply
  if (S.tab === 'play') S.takebacks++;
  S.epoch++;
  S.busy = false; S.paused = false; S.arrows = []; S.selected = null; S.viewPly = null;
  hideBanner();
  if (S.tab === 'analyze') {
    S.game.undo();
    pruneTags();
    render();
    return runAnalysis();
  }
  const mine = S.tab === 'openings' ? S.opening.side : S.playColor;
  S.game.undo();
  while (S.game.history().length && S.game.turn() !== mine) S.game.undo();
  pruneTags();
  if (S.lastVerdict) S.lastVerdict.takenBack = true;
  render();
  if (S.tab === 'openings') openingStep();
  else { setPlayNote('Took back. Your move.'); afterPositionChange(); }
}

function flip() {
  S.orient = S.orient === 'w' ? 'b' : 'w';
  render();
  updateEval(S.evalLine);
}

function restart() {
  if (S.tab === 'openings') startOpening();
  else if (S.tab === 'play') { if (!gameInProgress() || confirm('Abandon this game? It will not be recorded.')) newGame(); }
  else if (S.tab === 'puzzles') loadPuzzle();
  else if (S.tab === 'analyze') { S.game = new Chess(); S.tags = {}; S.arrows = []; S.viewPly = null; render(); runAnalysis(); }
}

$('#btn-undo').addEventListener('click', takeBack);
$('#btn-flip').addEventListener('click', flip);
$('#btn-reset').addEventListener('click', restart);
const navEnd = () => (studying() ? S.opening.moves.length : S.game.history().length);
$('#nav-first').addEventListener('click', () => navTo(0));
$('#nav-prev').addEventListener('click', () => navTo((S.viewPly ?? S.game.history().length) - 1));
$('#nav-next').addEventListener('click', () => navTo((S.viewPly ?? S.game.history().length) + 1));
$('#nav-last').addEventListener('click', () => navTo(navEnd()));
$('#live-pill').addEventListener('click', () => setView(S.game.history().length));

function syncToolButtons() {
  const t = S.tab;
  $('#btn-undo').classList.toggle('hidden', t === 'puzzles' || t === 'progress' || studying());
  $('#btn-reset').classList.toggle('hidden', t === 'progress');
  $('#btn-reset').textContent = t === 'puzzles' ? 'Skip' : 'Restart';
  $('#moves-card').classList.toggle('hidden', t === 'progress');
}

function switchTab(tab, reset = true) {
  if (S.tab === tab && reset) return;
  if ((S.tab === 'play' || S.tab === 'puzzles') && tab !== S.tab) {
    // keep this game to come back to; other tabs work on a copy
    if (S.tab === 'play') S.saved.play = { game: S.game, tags: S.tags, lossByPly: S.lossByPly, verdict: S.lastVerdict, recorded: S.recorded, takebacks: S.takebacks };
    else S.saved.puzzles = S.game;
    S.game = cloneGame(S.game);
    S.tags = { ...S.tags }; S.lossByPly = {};
  }
  S.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  for (const t of ['openings', 'puzzles', 'play', 'analyze', 'progress']) $(`#panel-${t}`).classList.toggle('hidden', t !== tab);
  S.epoch++;
  S.busy = false; S.paused = false; S.selected = null; S.hint = null; S.viewPly = null;
  hideBanner();
  syncToolButtons();
  refreshChips();
  if (!reset) return;
  if (tab === 'openings') startOpening();
  else if (tab === 'play') resumePlay();
  else if (tab === 'puzzles') {
    renderPuzzleStats();
    if (S.saved.puzzles && (S.pz.p || S.pz.mistake)) {
      S.game = S.saved.puzzles; S.saved.puzzles = null;
      S.orient = S.pz.color; S.arrows = [];
      settlePuzzle();   // finish a reply/undo that the tab switch interrupted
      render(); puzzleButtons();
    } else loadPuzzle();
  } else if (tab === 'analyze') { S.arrows = []; render(); runAnalysis(); }
  else { S.arrows = []; render(); renderProgress($('#panel-progress'), OPENINGS, () => { checkGoal(); updateHud(); }, openLoggedGame); }
}

function openLoggedGame(pgn) {
  const g = new Chess();
  try { g.loadPgn(pgn); } catch { toast('<b>Could not open</b>that game'); return; }
  S.game = g; S.tags = {}; S.lastVerdict = null;
  switchTab('analyze');
}

document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
document.querySelectorAll('[data-omode]').forEach((b) => b.addEventListener('click', () => { S.reviewQueue = []; setOpeningMode(b.dataset.omode); }));
document.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
  if (gameInProgress() && !confirm('Abandon this game and start a new one?')) return;
  S.colorPref = b.dataset.color;
  P.data.settings.color = S.colorPref; save();
  document.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('active', x === b));
  newGame();
}));
$('#play-elo').addEventListener('input', (e) => {
  S.elo = +e.target.value;
  $('#elo-label').textContent = oppLabel();
});
$('#play-elo').addEventListener('change', () => { P.data.settings.elo = S.elo; save(); });
$('#coach-on').addEventListener('change', (e) => { S.coachOn = e.target.checked; P.data.settings.coach = S.coachOn; save(); });
$('#btn-newgame').addEventListener('click', () => { if (!gameInProgress() || confirm('Abandon this game? It will not be recorded.')) newGame(); });
$('#btn-resign').addEventListener('click', resign);

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select') || e.ctrlKey || e.altKey || e.metaKey) return;
  const cur = S.viewPly ?? S.game.history().length;
  if (e.key === 'ArrowLeft') { navTo(cur - 1); e.preventDefault(); }
  else if (e.key === 'ArrowRight' || (e.key === ' ' && studying() && !e.target.closest('button'))) { navTo(cur + 1); e.preventDefault(); }
  else if (e.key === 'Home') { navTo(0); e.preventDefault(); }
  else if (e.key === 'End') { navTo(navEnd()); e.preventDefault(); }
  else if (e.key === 'f') flip();
  else if (e.key === 'Escape') { S.selected = null; render(); }
  else if (e.key === 'Enter' && S.tab === 'puzzles' && (S.pz.done || (!S.pz.p && !S.pz.mistake)) && !e.target.closest('button')) loadPuzzle();
});

// ------------------------------------------------------------------- coach ---

function mdToHtml(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  let html = '', inList = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const bullet = line.match(/^([-*]|\d+\.)\s+(.*)/);
    if (bullet) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(bullet[2])}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    if (!line) continue;
    const h = line.match(/^#+\s+(.*)/);
    html += h ? `<p><b>${inline(h[1])}</b></p>` : `<p>${inline(line)}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}

function addMsg(kind, html, who) {
  const div = document.createElement('div');
  div.className = `msg ${kind}`;
  div.innerHTML = (who ? `<div class="who">${esc(who)}</div>` : '') + html;
  $('#chat').appendChild(div);
  $('#chat').scrollTop = $('#chat').scrollHeight;
  return div;
}

function refreshChips() {
  const v = S.lastVerdict;
  const chips = {
    openings: S.omode === 'study' && S.game.history().length
      ? ['Explain the last move in more depth', 'What else could be played here?', 'What are the typical plans here?']
      : ["Explain this opening's ideas", 'What are the typical plans here?', 'What if my opponent deviates?'],
    puzzles: !S.pz.p && !S.pz.mistake ? [] : S.pz.done ? ['Explain the solution', 'What pattern should I remember?'] : ['Give me a hint without the answer'],
    play: ["What's the plan here?", 'What should I watch out for?', ...(v && !v.takenBack && ['inaccuracy', 'mistake', 'blunder'].includes(v.cls) ? ['Why was my last move bad?'] : [])],
    analyze: ["What's the plan here?", 'Explain the top engine line'],
    progress: ['What should I train next?'],
  }[S.tab];
  const box = $('#chips');
  box.innerHTML = '';
  for (const c of chips) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = c;
    b.onclick = () => ask(c);
    box.appendChild(b);
  }
}

async function buildContext() {
  const g = viewGame();
  const fen = g.fen();
  const out = [`FEN: ${fen}`, `Side to move: ${colorName(g.turn())}`];
  if (S.tab === 'openings') {
    const o = S.opening, f = familyOf(o);
    out.push(`Mode: opening training (${S.omode}) — ${o.name} (${o.eco}), the "${o.branch}" branch of the student's ${f.name} repertoire. Student plays ${colorName(o.side)}.`,
      `Line being taught: ${numberedLine(o.moves)}`, `Opening idea: ${o.idea}`,
      `Other branches in this opening: ${familyLines(f).filter((x) => x !== o).map((x) => `${x.branch} (${numberedLine(x.moves)})`).join('; ') || 'none'}`);
    const p = g.history().length - 1;
    if (S.omode === 'study' && p >= 0 && p < o.moves.length) out.push(`Study commentary on the last move ${moveLabel(p, o.moves[p])}: ${o.notes[p]} ${STUDY[o.id]?.why?.[p] || ''}`);
    const lib = styleLib(), dn = lib?.openings[f.topic || f.id];
    if (dn?.length) out.push(`${lib.short}'s advice on this opening (from the lesson notes): ${dn.map((x) => x.text).join(' ')}`);
  } else if (S.tab === 'play') {
    out.push(`Mode: practice game vs Stockfish (${oppLabel()}). Student plays ${colorName(S.playColor)}.`);
  } else if (S.tab === 'puzzles') {
    const z = S.pz;
    if (!z.done) out.push('Mode: tactics puzzle the student is still solving. Do NOT reveal the solution move or name the moving piece. Give a nudge: what to look at (checks, loose pieces, the theme).');
    else out.push(`Mode: tactics puzzle, already finished.${z.p ? ` Solution (UCI): ${z.p.solution.join(' ')}. Themes: ${z.p.themes.join(', ')}.` : ''} Explain why the solution works.`);
  } else if (S.tab === 'progress') {
    const d = P.data;
    const weak = OPENINGS.filter((o) => d.openings[o.id] && d.openings[o.id].box < 2).map((o) => o.name);
    out.push(`Mode: training advice. Puzzle rating ${d.puzzles.rating}; ${d.games.length} games, recent accuracy ${d.games.slice(0, 5).map((x) => x.acc).join('/') || 'n/a'}; mistake deck ${d.mistakes.length}; weak opening lines: ${weak.join(', ') || 'none'}.`);
  } else {
    out.push('Mode: free analysis board (student moves both sides).');
  }
  const sans = g.history();
  out.push(`Moves so far: ${sans.length ? numberedLine(sans) : '(none — starting position or loaded FEN)'}`);
  const named = gameOpening(g);
  if (named) out.push(`Opening (ECO database): ${named.eco} ${named.name}` +
    (named.lastBook < named.total - 1 ? ` — left known theory after ${moveLabel(named.lastBook, sans[named.lastBook])}` : ''));
  if (S.lastVerdict && S.tab !== 'puzzles') {
    const v = S.lastVerdict;
    out.push((v.takenBack ? '(The student has since TAKEN BACK this move; it is no longer on the board.) ' : '') +
      `Coach check of the student's most recent move ${v.label}: ${v.cls}, lost ~${Math.round(v.loss)}% winning chances (eval ${v.evalBefore} -> ${v.evalAfter}).` +
      (v.bestSan ? ` Stockfish's best was ${v.bestSan}.` : '') + (v.replySan ? ` Stockfish's best reply to the student's move: ${v.replySan}.` : ''));
  }
  if (g.isGameOver()) out.push(`Game over: ${g.isCheckmate() ? 'checkmate' : 'draw'}.`);
  else if (!(S.tab === 'puzzles' && !S.pz.done)) {
    try {
      const r = await analyse(fen, 1000, 3);
      out.push('Stockfish top lines (eval from White\'s view):');
      r.lines.forEach((l, i) => out.push(`  ${i + 1}) ${evalText(l)}  ${pvToSan(fen, l.pv || [], 10)}`));
    } catch (e) {
      out.push(`(Stockfish unavailable: ${e.message})`);
    }
  }
  return out.join('\n');
}

async function ask(question) {
  setCoachOpen(true);
  addMsg('user', mdToHtml(question));
  const pending = addMsg('ai', '<p class="muted">Thinking…</p>');
  try {
    const context = await buildContext();
    const r = await api('/api/ask', { question, history: S.chat, context, provider: $('#provider').value, style: S.coachStyle });
    const who = r.provider + (S.coachStyle !== 'standard' && COACHES ? ` · ${COACHES.styles[S.coachStyle].label}` : '');
    pending.innerHTML = `<div class="who">${esc(who)}</div>` + mdToHtml(r.answer);
    S.chat.push({ role: 'user', content: question }, { role: 'assistant', content: r.answer });
    S.chat = S.chat.slice(-12);
  } catch (e) {
    pending.className = 'msg err';
    pending.textContent = e.message;
  }
  $('#chat').scrollTop = $('#chat').scrollHeight;
}

$('#ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#ask-input').value.trim();
  if (!q) return;
  $('#ask-input').value = '';
  ask(q);
});

function setCoachOpen(open) {
  $('#coach').classList.toggle('closed', !open);
  $('#coach-toggle').setAttribute('aria-expanded', String(open));
  if (P.data.settings.coachOpen !== open) { P.data.settings.coachOpen = open; save(); }
}
$('#coach-toggle').addEventListener('click', () => setCoachOpen($('#coach').classList.contains('closed')));

// Coach style (coaches.json): the server/backend builds the system prompt from it, and a
// grandmaster style brings that GM's lesson library (Lessons button).
const styleLib = () => LIBS[COACHES?.styles[S.coachStyle]?.lessons] || null;
function applyCoachStyle() {   // UI only; COACHES may still be loading
  if (COACHES && !COACHES.styles[S.coachStyle]) S.coachStyle = 'standard';
  document.querySelectorAll('[data-style]').forEach((b) => b.classList.toggle('active', b.dataset.style === S.coachStyle));
  $('#btn-lessons').classList.toggle('hidden', !styleLib());
}
function setCoachStyle(style) {
  S.coachStyle = style;
  applyCoachStyle();
  if (P.data.settings.coachStyle !== S.coachStyle) { P.data.settings.coachStyle = S.coachStyle; save(); }
}
$('#coach-styles').addEventListener('click', (e) => { const b = e.target.closest('[data-style]'); if (b) setCoachStyle(b.dataset.style); });

const sourceLinks = (sources = []) => sources.map((s) =>
  `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">${esc(s.label || 'video')}</a>`).join(' · ');

function openLessons() {
  const lib = styleLib();
  if (!lib) return;
  $('#lessons-title').textContent = `Lessons from ${lib.short}'s videos`;
  $('#lessons-source').textContent = lib.source || '';
  $('#lessons-body').innerHTML = !lib.themes.length ? '<p class="empty">No lessons distilled yet.</p>'
    : lib.themes.map((t) => `<section><h3>${esc(t.name)}</h3>${t.lessons.map((l) =>
      `<div class="lesson-item"><b>${esc(l.title)}</b><p>${esc(l.text)}</p><span class="small">${sourceLinks(l.sources)}</span></div>`).join('')}</section>`).join('');
  $('#lessons-dlg').showModal();
}
$('#btn-lessons').addEventListener('click', openLessons);
$('#lessons-close').addEventListener('click', () => $('#lessons-dlg').close());
$('#lessons-dlg').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });   // click outside closes

// --------------------------------------------------------- sound + theme ---

function applySound() {
  const on = P.data.settings.sound;
  setSound(on);
  $('#btn-sound').classList.toggle('off', !on);
  $('#btn-sound').title = `Sound (${on ? 'on' : 'off'})`;
  $('#btn-sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
}
$('#btn-sound').addEventListener('click', () => { P.data.settings.sound = !P.data.settings.sound; save(); applySound(); });

const THEME_ICONS = {
  system: '<circle cx="12" cy="12" r="8" fill="none"/><path d="M12 4a8 8 0 0 1 0 16z"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" fill="none"/>',
  dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
};
function applyTheme() {
  const t = P.data.settings.theme;
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem('chess-coach-theme', t); } catch { /* ignore */ }
  $('#btn-theme').title = `Theme: ${t}`;
  $('#btn-theme').setAttribute('aria-label', `Theme: ${t}`);
  $('#btn-theme svg').innerHTML = THEME_ICONS[t];
}
$('#btn-theme').addEventListener('click', () => {
  const order = ['system', 'light', 'dark'];
  P.data.settings.theme = order[(order.indexOf(P.data.settings.theme) + 1) % 3];
  save();
  applyTheme();
});

// -------------------------------------------------------------------- boot ---

async function boot() {
  await loadProfile();
  applySound();
  applyTheme();
  setCoachOpen(P.data.settings.coachOpen);
  S.coachStyle = P.data.settings.coachStyle;
  applyCoachStyle();
  S.colorPref = P.data.settings.color;
  document.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('active', x.dataset.color === S.colorPref));
  S.coachOn = P.data.settings.coach;
  $('#coach-on').checked = S.coachOn;
  S.elo = P.data.settings.elo;
  updateHud();
  fillOpeningList();
  renderPuzzleStats();
  syncToolButtons();
  refreshChips();
  try {
    const st = await api('/api/status');
    const ai = st.claude ? `Claude (${st.claudeModel})` : st.local ? 'local Qwen' : 'no AI running';
    $('#coach-ai').textContent = ai;
    const prov = $('#provider');
    prov.innerHTML = `<option value="auto">Auto</option>` +
      `<option value="claude"${st.claude ? '' : ' disabled'}>Claude${st.claude ? '' : ' (not set up)'}</option>` +
      `<option value="local">Local Qwen${st.local ? '' : ' (not running)'}</option>`;
    const elo = $('#play-elo');
    elo.min = st.eloMin; elo.max = st.eloMax;
    elo.value = P.data.settings.elo;
    elo.dispatchEvent(new Event('input'));
    if (st.hosted && !st.local) addMsg('ai', mdToHtml('Online version: Stockfish runs in your browser. The coach chat works on a computer that has the local Qwen model running (`tools\\llm\\start-qwen.cmd`); it isn\'t available on a phone.'), 'setup');
    else if (!st.claude && !st.local) addMsg('ai', mdToHtml('No AI is running yet. Start the local model with `tools\\llm\\start-qwen.cmd`, or set `ANTHROPIC_API_KEY` and restart the server to use Claude.'), 'setup');
  } catch {
    if (isStatic()) {
      $('#coach-ai').textContent = 'engine failed';
      banner('bad', '<b>Couldn\'t start the in-browser engine.</b> Reload, or try an up-to-date Chrome, Edge, Firefox or Safari.');
    } else {
      $('#coach-ai').textContent = 'server offline';
      banner('bad', '<b>Server offline.</b> Start it with start-chess.cmd, then reload.');
    }
  }
  // Heartbeat: the server shuts itself down a while after the last app window closes.
  const ping = () => { if (!isStatic()) fetch('/api/ping').catch(() => {}); };
  setInterval(ping, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
  ping();
  // Land on what's most worth doing: due reviews first.
  const due = dueOpenings(OPENINGS);
  if (due.length) S.opening = due[0];
  S.family = familyOf(S.opening);
  setRepOpen(P.data.settings.repOpen);
  fillOpeningList();
  setOpeningMode(S.omode);
}

boot();
