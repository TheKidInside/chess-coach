// Lessons tab: one opening taught at four levels (0, 850, 1,900, 2,350 Elo) as a student and coach
// talking over a board. Format from Team Liquid's "Magnus Teaches the London System (to every Elo)";
// the content is our own. Each lesson is data in elo-lessons/<id>.json, checked by tools/lessons/verify_elo.py.
// Keeps its own board and state, so nothing here touches S.game or the trainer's XP.
// The 'danya' group teaches a topic from GM Naroditsky's videos the same way; a scene or drill may start from a fen.
import { Chess } from './vendor/chess.js';
import { play as sfx, moveSound } from './sound.js';
import { openWalkthrough, pauseWalkthrough, walkthroughKey } from './walkthrough.js';
import { followDrag, userArrows } from './board-input.js';

const CATALOG = [
  { id: 'italian', name: 'Italian Game', side: 'w', role: 'White, classical development' },
  { id: 'london', name: 'London System', side: 'w', role: 'White, same setup every game' },
  { id: 'carokann', name: 'Caro-Kann', side: 'b', role: 'Black against 1.e4' },
  { id: 'slav', name: 'Slav Defence', side: 'b', role: 'Black against 1.d4' },
  { id: 'danya-king', group: 'danya', name: 'The king in endgames', side: 'w', role: 'King first, then opposition, then triangulation' },
  { id: 'danya-loose', group: 'danya', name: 'Loose pieces', side: 'w', role: 'Spot them, count them, overload the guard' },
  { id: 'walk-london', group: 'walk', walk: 'london', drill: 'london', name: 'London System', side: 'w', role: 'Watch it start to finish, about 10 minutes' },
  { id: 'walk-scotch', group: 'walk', walk: 'scotch', name: 'Scotch Game', side: 'w', role: 'Watch it start to finish, about 10 minutes' },
  { id: 'walk-qgd', group: 'walk', walk: 'qgd', name: "Queen's Gambit", side: 'w', role: 'Watch it start to finish, about 10 minutes' },
  { id: 'walk-najdorf', group: 'walk', walk: 'najdorf', name: 'Sicilian Najdorf', side: 'b', role: 'Watch it start to finish, about 10 minutes' },
  { id: 'walk-dragon', group: 'walk', walk: 'dragon', name: 'Sicilian Dragon', side: 'b', role: 'Watch it start to finish, about 10 minutes' },
  { id: 'walk-bishops', group: 'walk', walk: 'bishops', name: "Bishop's Opening", side: 'w', role: 'Two plans and two gambits, about 15 minutes',
    credit: `Lines and traps from GM Igor Smirnov's <a href="https://www.youtube.com/watch?v=s4466dzeDms" target="_blank" rel="noopener">"They Will QUIT Chess After You Play This Opening"</a> (Remote Chess Academy), retold in our own words: the script is ours, not by or from GM Smirnov. Presentation borrowed from ChessPage1's London video. Every line checked with Stockfish 19; where the engine is less sure than the video (the h4 bait), the script says so.` },
  { id: 'walk-scholars', group: 'walk', walk: 'scholars', name: "Beating the Scholar's Mate", side: 'b', role: 'Stop the early queen, then punish it, about 15 minutes',
    credit: `Lines and traps from Yellow Rook's <a href="https://www.youtube.com/watch?v=yusczVFpEGo" target="_blank" rel="noopener">"I Feared the Scholar's Mate, Now I Love When They Try It"</a>, retold in our own words: the script is ours, not by or from Yellow Rook. Presentation borrowed from ChessPage1's London video. Every line checked with Stockfish 19; where the engine disagrees with the video (the Ne5 trap, Bg4 vs Nb4), the script says so.` },
  { id: 'walk-friedliver', group: 'walk', walk: 'friedliver', name: 'Fried Liver Attack', side: 'w', role: 'The attack, its mates and every refutation, about 15 minutes',
    credit: `An original script, not taken from a video. Presentation borrowed from ChessPage1's <a href="https://www.youtube.com/watch?v=dksvHyyI_Vo" target="_blank" rel="noopener">"London System: One Opening against anything"</a>. Every line checked with Stockfish 19; how often each move is played comes from a sample of Lichess games by players under 1800 (Sept 2026).` },
].map((c) => ({ group: 'openings', ...c }));
const GROUPS = [['openings', 'Openings'], ['danya', "Danya's lessons"], ['walk', 'Walkthroughs']];
const CREDITS = {
  openings: `Format borrowed from Team Liquid's <a href="https://www.youtube.com/watch?v=baJ848UCB-0" target="_blank" rel="noopener">"Magnus Teaches the London System (to every Elo)"</a>. These are original lessons, not by or from Magnus Carlsen. Lines checked with Stockfish 19. Frequencies come from a sample of 812,516 Lichess rated games (Sept 2026), and some cells are small.`,
  danya: `Topics and principles come from GM Daniel Naroditsky's YouTube lessons, paraphrased, with the video moments linked at the end of each level. He did not teach these as four levels: the script, the coach and the choice of positions are ours, including classic studies and games. Lines checked with Stockfish 19.`,
  walk: `Presentation borrowed from ChessPage1's <a href="https://www.youtube.com/watch?v=dksvHyyI_Vo" target="_blank" rel="noopener">"London System: One Opening against anything"</a>. These are original scripts, not by or from ChessPage1. The example games are made up, not real games. Lines checked with Stockfish 19.`,
};
const STORE_KEY = 'chess-coach-elo-v1';
const SVGNS = 'http://www.w3.org/2000/svg';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const E = {
  ready: false, root: null, cache: {}, lesson: null, id: 'carokann',
  tier: 0, scene: 0, step: 0, solved: {}, doneDrills: {}, places: {}, lastIn: {},
  misses: 0, drill: null, watch: null, auto: null, sel: null, game: new Chess(), last: null, busy: false, anim: null, pick: 0,
};
const $ = (id) => E.root.querySelector(`[data-el="${id}"]`);
const mk = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    E.solved = raw.solved || {};
    E.doneDrills = raw.doneDrills || {};
    E.places = raw.places || {};
    if (CATALOG.some((c) => c.id === raw.id)) E.id = raw.id;
  } catch { /* storage blocked: start from the top */ }
}
function save() {
  if (E.lesson) E.places[E.id] = [E.tier, E.scene, E.step];
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ id: E.id, solved: E.solved, doneDrills: E.doneDrills, places: E.places })); } catch {}
}

const tier = () => E.lesson.tiers[E.tier];
const scene = () => tier().scenes[E.scene];
const onWrap = () => E.scene === tier().scenes.length;
const stepKey = (st = E.step, sc = E.scene, t = E.tier) => `${E.id}.${t}.${sc}.${st}`;
const drillKey = (i) => `${E.id}.${E.tier}.${i}`;
const moveList = (s) => (s ? s.split(' ').filter(Boolean) : []);
const startGame = (o) => (o.fen ? new Chess(o.fen) : new Chess());
const startPly = (o) => {
  if (!o.fen) return 0;
  const f = o.fen.split(' ');
  return (Number(f[5]) - 1) * 2 + (f[1] === 'b' ? 1 : 0);
};
const groupOf = (id) => CATALOG.find((c) => c.id === id).group;
const totalSteps = (t) => t.scenes.reduce((n, sc) => n + sc.steps.length, 0);
const stepNumber = () => tier().scenes.slice(0, E.scene).reduce((n, sc) => n + sc.steps.length, 0) + E.step + 1;

// A move quiz only joins the line once it has been answered.
function stepMoves(st, idx) {
  const list = moveList(st.play);
  if (st.quiz && st.quiz.kind === 'move' && E.solved[stepKey(idx)]) list.push(st.quiz.answer);
  return list;
}

function positionAt(upto) {
  const g = startGame(scene());
  moveList(scene().from).forEach((m) => g.move(m));
  let last = null;
  for (let i = 0; i <= upto; i++) stepMoves(scene().steps[i], i).forEach((m) => { last = g.move(m); });
  return { g, last };
}

function notation(startPly, sans) {
  let out = '', ply = startPly;
  sans.forEach((san, i) => {
    const n = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) out += `${n}.${san} `;
    else out += (i === 0 ? `${n}...` : '') + san + ' ';
    ply++;
  });
  return out.trim();
}

/* ---------- board ---------- */
const files = () => (E.lesson.side === 'b' ? 'hgfedcba' : 'abcdefgh');
const rankAt = (row) => (E.lesson.side === 'b' ? row + 1 : 8 - row);
const sqXY = (sq) => ({ x: files().indexOf(sq[0]), y: E.lesson.side === 'b' ? Number(sq[1]) - 1 : 8 - Number(sq[1]) });

function drawBoard(marks = []) {
  const b = $('board');
  b.textContent = '';
  const dests = E.sel ? E.game.moves({ square: E.sel, verbose: true }).map((m) => m.to) : [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const sq = files()[c] + rankAt(r);
    const light = ('abcdefgh'.indexOf(sq[0]) + Number(sq[1])) % 2 === 0;   // a1 is dark
    const el = mk('button', `el-sq ${light ? 'l' : 'd'}`);
    el.type = 'button';
    el.dataset.sq = sq;
    const p = E.game.get(sq);
    el.setAttribute('aria-label', sq + (p ? ` ${p.color}${p.type}` : ''));
    if (E.last && (E.last.from === sq || E.last.to === sq)) el.classList.add('last');
    if (E.sel === sq) el.classList.add('sel');
    if (marks.includes(sq)) el.classList.add('mark');
    if (dests.includes(sq)) { el.classList.add('dest'); el.appendChild(mk('i')); }
    if (p) {
      const img = mk('img', 'el-piece');
      img.src = `pieces/${p.color}${p.type.toUpperCase()}.svg`;
      img.alt = '';
      img.draggable = false;
      el.appendChild(img);
    }
    if (r === 7) el.appendChild(mk('span', 'el-coord f', sq[0]));
    if (c === 0) el.appendChild(mk('span', 'el-coord r', sq[1]));
    // Tap or drag a piece; keyboard Enter still clicks (detail 0).
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !e.isPrimary) return;
      // Pressing the piece that is already picked: drag it, or a tap puts it down.
      if (E.sel === sq) return followDrag(e, b, sq, (to) => onSquare(to), () => onSquare(sq));
      onSquare(sq);
      if (E.sel === sq) followDrag(e, b, sq, (to) => onSquare(to));
    });
    el.addEventListener('click', (e) => { if (e.detail === 0) onSquare(sq); });
    b.appendChild(el);
  }
  E.arrows?.sync(`${E.id}|${E.tier}|${E.scene}|${E.step}|${E.drill ? 'drill' : E.watch ? 'watch' : ''}|${E.game.fen()}`);
}

function drawArrows(list = []) {
  const svg = $('arrows');
  svg.textContent = '';
  for (const [from, to, kind] of list) {
    const a = sqXY(from), b = sqXY(to);
    const x1 = a.x + 0.5, y1 = a.y + 0.5, x2 = b.x + 0.5, y2 = b.y + 0.5;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const ex = x2 - ux * 0.38, ey = y2 - uy * 0.38;
    const color = `var(--arrow-${kind})`;
    const line = document.createElementNS(SVGNS, 'line');
    Object.entries({ x1: x1 + ux * 0.22, y1: y1 + uy * 0.22, x2: ex, y2: ey }).forEach(([k, v]) => line.setAttribute(k, v));
    line.setAttribute('stroke-width', '0.15');
    line.style.stroke = color;
    const head = document.createElementNS(SVGNS, 'polygon');
    head.setAttribute('points', `${x2 - ux * 0.08},${y2 - uy * 0.08} ${ex - uy * 0.2},${ey + ux * 0.2} ${ex + uy * 0.2},${ey - ux * 0.2}`);
    head.style.fill = color;
    svg.append(line, head);
  }
}

function animateLast() {
  if (!E.last || REDUCED) return;
  const img = E.root.querySelector(`.el-sq[data-sq="${E.last.to}"] .el-piece`);
  if (!img) return;
  const a = sqXY(E.last.from), b = sqXY(E.last.to);
  img.style.zIndex = 5;
  img.animate([{ transform: `translate(${(a.x - b.x) * 100}%, ${(a.y - b.y) * 100}%)` }, { transform: 'none' }], { duration: 200, easing: 'ease-out' });
}

const missAt = (sq) => E.root.querySelector(`.el-sq[data-sq="${sq}"]`)?.classList.add('miss');
const hitAt = (sq) => E.root.querySelector(`.el-sq[data-sq="${sq}"]`)?.classList.add('hit');

/* ---------- lesson flow ---------- */
function openQuiz() {
  if (E.drill || onWrap()) return null;
  const q = scene().steps[E.step].quiz;
  if (!q) return null;
  const got = E.solved[stepKey()];
  return (q.kind === 'choice' ? got && got.done : got) ? null : q;
}

function cancelAnim() { E.anim = null; E.busy = false; }

async function sync(animate) {
  if (E.watch) return renderWatch();
  if (E.drill) return renderDrill();
  if (onWrap()) return renderWrap();
  const st = scene().steps[E.step];
  const { g, last } = positionAt(E.step);
  E.sel = null;
  renderTalk();
  renderChrome();

  // Walk new moves on one at a time so the eye can follow them.
  const fresh = stepMoves(st, E.step);
  if (animate && fresh.length && !REDUCED) {
    const walk = positionAt(E.step);
    for (let i = 0; i < fresh.length; i++) walk.g.undo();
    E.game = walk.g;
    const token = (E.anim = {});
    E.busy = true;
    for (let i = 0; i < fresh.length; i++) {
      if (E.anim !== token) return;
      E.last = E.game.move(fresh[i]);
      moveSound(E.last, E.game.inCheck());
      drawBoard();
      drawArrows();
      animateLast();
      if (i < fresh.length - 1) await new Promise((r) => setTimeout(r, 480));
    }
    if (E.anim !== token) return;
    E.busy = false;
  }
  E.game = g;
  E.last = last;
  drawBoard(st.marks || []);
  drawArrows(st.arrows || []);
  save();
}

function tableEl(t) {
  const box = mk('div', `el-table${t.head.length === 3 ? ' wide' : ''}`);
  const tb = mk('table');
  tb.appendChild(mk('caption', '', t.caption));
  const hr = tb.insertRow();
  t.head.forEach((h) => { const th = mk('th', '', h); th.scope = 'col'; hr.appendChild(th); });
  t.rows.forEach((row) => { const r = tb.insertRow(); row.forEach((c) => { r.insertCell().textContent = c; }); });
  box.appendChild(tb);
  return box;
}

function quizEl(q, idx, current) {
  const key = stepKey(idx);
  const got = E.solved[key];
  const box = mk('div', 'el-quiz');
  if (q.kind === 'choice') {
    box.appendChild(mk('div', 'el-tag', q.prompt || 'Your call'));
    const list = mk('div', 'el-choices');
    q.options.forEach((o, i) => {
      const b = mk('button', 'el-choice', o.t);
      b.type = 'button';
      if (got?.picked?.includes(i)) b.classList.add(o.ok ? 'ok' : 'no');
      if (got?.done) b.disabled = true;
      b.addEventListener('click', () => pickChoice(q, i, key));
      list.appendChild(b);
    });
    box.appendChild(list);
    (got?.picked || []).forEach((i) => box.appendChild(mk('div', `el-fb ${q.options[i].ok ? 'ok' : 'no'}`, q.options[i].why)));
    return box;
  }
  box.appendChild(mk('div', 'el-tag', got ? 'Answer' : q.kind === 'square' ? 'Tap the square on the board' : 'Play the move on the board'));
  if (got) box.appendChild(mk('div', 'el-fb ok', q.hit));
  else if (current) {
    if (E.misses > 0) box.appendChild(mk('div', 'el-fb no', q.hint));
    if (E.misses > 1) {
      const b = mk('button', 'el-link', 'Show the answer');
      b.type = 'button';
      b.addEventListener('click', () => { solve(key, true); sync(false); if (q.kind === 'square') hitAt(q.answer); });
      box.appendChild(b);
    }
  }
  return box;
}

function appendStep(box, st, idx, current) {
  const msg = mk('div', `el-msg${st.who === 'student' ? ' student' : ''}${current ? '' : ' past'}`);
  // Only label a change of speaker.
  const prev = scene().steps[idx - 1];
  if (st.who === 'student' || !prev || prev.who === 'student') msg.appendChild(mk('div', 'el-who', st.who === 'student' ? 'Student' : 'Coach'));
  const sans = stepMoves(st, idx);
  if (sans.length) {
    const before = startPly(scene()) + moveList(scene().from).length + scene().steps.slice(0, idx).reduce((n, s, i) => n + stepMoves(s, i).length, 0);
    msg.appendChild(mk('div', 'el-moves', notation(before, sans)));
  }
  msg.appendChild(mk('p', '', st.say));
  if (st.table) msg.appendChild(tableEl(st.table));
  box.appendChild(msg);
  if (st.quiz) box.appendChild(quizEl(st.quiz, idx, current));
}

function renderTalk() {
  $('eyebrow').textContent = `${tier().elo} Elo, ${tier().name}. ${tier().hook}`;
  $('title').textContent = scene().title;
  const box = $('scroll');
  box.textContent = '';
  for (let i = 0; i <= E.step; i++) appendStep(box, scene().steps[i], i, i === E.step);
  box.scrollTop = box.scrollHeight;
}

function renderChrome() {
  const quiz = openQuiz();
  $('back').disabled = !E.drill && E.tier === 0 && E.scene === 0 && E.step === 0;
  $('next').disabled = !!quiz;
  $('next').textContent = quiz ? 'Answer to continue' : 'Next';
  $('pos').textContent = onWrap() ? 'Practice' : `Step ${stepNumber()} of ${totalSteps(tier())}`;
  markTabs();
}

function markTabs() {
  [...$('tiers').children].forEach((t, i) => t.setAttribute('aria-selected', String(i === E.tier)));
  [...$('picker').children].forEach((c) => c.setAttribute('aria-selected', String(c.dataset.id === E.id)));
}

function next() {
  if (E.busy) cancelAnim();
  if (E.watch) return stepWatch(1);
  if (E.drill) return;
  E.misses = 0;
  if (onWrap()) {
    if (E.tier < E.lesson.tiers.length - 1) { E.tier++; E.scene = 0; E.step = 0; sync(true); }
    return;
  }
  if (openQuiz()) return;
  if (E.step < scene().steps.length - 1) E.step++;
  else { E.scene++; E.step = 0; }
  sync(true);
}

function back() {
  if (E.busy) cancelAnim();
  stopAuto();
  E.misses = 0;
  if (E.watch) return E.watch.ply ? stepWatch(-1) : leaveWatch();
  if (E.drill) { E.drill = null; return sync(false); }
  if (onWrap()) { E.scene = tier().scenes.length - 1; E.step = scene().steps.length - 1; return sync(false); }
  if (E.step > 0) E.step--;
  else if (E.scene > 0) { E.scene--; E.step = scene().steps.length - 1; }
  else if (E.tier > 0) { E.tier--; E.scene = tier().scenes.length; E.step = 0; }
  sync(false);
}

function setTier(i) {
  if (E.busy) cancelAnim();
  stopAuto();
  E.tier = i; E.scene = 0; E.step = 0; E.drill = null; E.watch = null; E.misses = 0;
  sync(false);
}

/* ---------- answering ---------- */
function solve(key, val) {
  E.solved[key] = val;
  E.misses = 0;
  save();
}

function pickChoice(q, i, key) {
  const cur = E.solved[key] || { picked: [] };
  if (!cur.picked.includes(i)) cur.picked.push(i);
  if (q.options[i].ok) cur.done = true;
  E.solved[key] = cur;
  sfx(q.options[i].ok ? 'good' : 'bad');
  save();
  renderTalk();
  renderChrome();
}

function onSquare(sq) {
  if (E.busy || E.watch) return;
  if (E.drill) return drillTap(sq);
  const q = openQuiz();
  if (!q) return;
  if (q.kind === 'square') {
    if (sq === q.answer) { solve(stepKey(), true); sfx('good'); renderTalk(); renderChrome(); hitAt(sq); }
    else { E.misses++; sfx('bad'); missAt(sq); renderTalk(); renderChrome(); }
    return;
  }
  if (q.kind !== 'move') return;
  const mv = pickMove(sq);
  if (!mv) return;
  const want = new Chess(E.game.fen()).move(q.answer);
  const marks = scene().steps[E.step].marks || [];
  E.sel = null;
  if (want.from === mv.from && want.to === mv.to) {
    solve(stepKey(), true);
    E.last = E.game.move(want.san);
    moveSound(E.last, E.game.inCheck());
    renderTalk(); renderChrome();
    drawBoard(marks);
    drawArrows();
    animateLast();
    save();
  } else {
    E.misses++;
    sfx('bad');
    drawBoard(marks);
    missAt(mv.to);
    renderTalk(); renderChrome();
  }
}

// Tap your own piece, then a destination. Returns the move once a legal pair has been chosen.
function pickMove(sq) {
  if (E.sel) {
    const m = E.game.moves({ square: E.sel, verbose: true }).find((x) => x.to === sq);
    if (m) return m;
  }
  const p = E.game.get(sq);
  E.sel = p && p.color === E.game.turn() && E.sel !== sq ? sq : null;
  drawBoard(!E.drill && !onWrap() ? scene().steps[E.step].marks || [] : []);
  return null;
}

/* ---------- wrap + drills ---------- */
function renderWrap() {
  const t = tier();
  E.game = startGame(t.drills[0]);
  moveList(t.drills[0].moves).forEach((m) => E.game.move(m));
  E.last = null;
  E.sel = null;
  drawBoard();
  drawArrows();
  $('eyebrow').textContent = `${t.elo} Elo, ${t.name}`;
  $('title').textContent = 'What to keep, and how to practise it';
  const box = $('scroll');
  box.textContent = '';
  const card = mk('div', 'el-wrap');
  const games = mk('div', 'el-drills');
  t.drills.forEach((d, i) => {
    const b = mk('button', 'el-btn', `Watch: ${d.name}`);
    b.type = 'button';
    b.addEventListener('click', () => startWatch(i));
    games.appendChild(b);
  });
  const row = mk('div', 'el-drills');
  t.drills.forEach((d, i) => {
    const done = E.doneDrills[drillKey(i)];
    const b = mk('button', `el-btn${done ? ' done' : ''}`, (done ? 'Done: ' : '') + d.name);
    b.type = 'button';
    b.addEventListener('click', () => startDrill(i));
    row.appendChild(b);
  });
  const who = E.lesson.side === 'b' ? 'Black' : 'White';
  const them = E.lesson.side === 'b' ? 'White' : 'Black';
  card.append(
    mk('h3', '', 'The one idea'), mk('p', '', t.takeaway),
    mk('h3', '', 'See the whole line on the board'), games,
    mk('h3', '', 'Now play it from memory'),
    mk('p', '', `You play ${who}'s moves on the board. ${them} answers by itself. A wrong move gets another try, with no penalty.`),
    row,
  );
  if (t.sources?.length) {
    const src = mk('p', 'small');
    t.sources.forEach((s, i) => {
      const a = mk('a', '', `${s.title} (${s.label})`);
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener';
      src.append(i ? ' · ' : '', a);
    });
    card.append(mk('h3', '', 'From Naroditsky\'s videos'), src);
  }
  box.appendChild(card);
  renderChrome();
  const more = E.tier < E.lesson.tiers.length - 1;
  $('next').disabled = !more;
  $('next').textContent = more ? `On to ${E.lesson.tiers[E.tier + 1].elo} Elo` : 'End of lesson';
  save();
}

function startDrill(i) {
  stopAuto();
  E.drill = { i, moves: moveList(tier().drills[i].moves), ply: 0, misses: 0, wrongHere: 0 };
  E.game = startGame(tier().drills[i]);
  E.last = null;
  E.sel = null;
  advanceDrill(false);
}

// The other side's replies play themselves, so the board is always waiting on you.
function advanceDrill(animate) {
  const dr = E.drill;
  while (dr.ply < dr.moves.length && E.game.turn() !== E.lesson.side) E.last = E.game.move(dr.moves[dr.ply++]);
  renderDrill(animate);
}

function renderDrill(animate) {
  const t = tier(), dr = E.drill;
  drawBoard();
  drawArrows();
  if (animate) animateLast();
  $('eyebrow').textContent = `${t.elo} Elo drill`;
  $('title').textContent = t.drills[dr.i].name;
  const box = $('scroll');
  box.textContent = '';
  const done = dr.ply >= dr.moves.length;
  const q = mk('div', 'el-quiz');
  q.appendChild(mk('div', 'el-tag', done ? 'Line finished' : `Play the next move for ${E.lesson.side === 'b' ? 'Black' : 'White'}`));
  q.appendChild(mk('div', 'el-moves', notation(startPly(t.drills[dr.i]), E.game.history()) || 'Starting position'));
  if (done) {
    q.appendChild(mk('div', 'el-fb ok', dr.misses === 0 ? 'Clean. No wrong moves.' : `Finished with ${dr.misses} wrong ${dr.misses === 1 ? 'try' : 'tries'}. Run it again until it's clean.`));
  } else if (dr.wrongHere) {
    q.appendChild(mk('div', 'el-fb no', 'That isn\'t the move in this line. Try again.'));
    if (dr.wrongHere > 1) {
      const b = mk('button', 'el-link', 'Show the move');
      b.type = 'button';
      b.addEventListener('click', () => { dr.misses++; playDrillMove(dr.moves[dr.ply]); });
      q.appendChild(b);
    }
  }
  box.appendChild(q);
  const row = mk('div', 'el-drills');
  const again = mk('button', 'el-btn', 'Restart this drill');
  const all = mk('button', 'el-btn', 'All drills');
  again.type = all.type = 'button';
  again.addEventListener('click', () => startDrill(dr.i));
  all.addEventListener('click', () => { E.drill = null; sync(false); });
  row.append(again, all);
  box.appendChild(row);
  $('next').disabled = true;
  $('next').textContent = done ? 'Pick another drill' : 'Your move';
  $('back').disabled = false;
  $('pos').textContent = `Move ${Math.min(dr.ply, dr.moves.length)} of ${dr.moves.length}`;
  markTabs();
  if (done && dr.misses === 0) { E.doneDrills[drillKey(dr.i)] = true; save(); }
}

function playDrillMove(san) {
  const dr = E.drill;
  E.last = E.game.move(san);
  moveSound(E.last, E.game.inCheck());
  dr.ply++;
  dr.wrongHere = 0;
  E.sel = null;
  drawBoard();
  animateLast();
  setTimeout(() => { if (E.drill === dr) advanceDrill(true); }, REDUCED ? 0 : 320);
}

function drillTap(sq) {
  const dr = E.drill;
  if (dr.ply >= dr.moves.length || E.game.turn() !== E.lesson.side) return;
  const mv = pickMove(sq);
  if (!mv) return;
  const want = new Chess(E.game.fen()).move(dr.moves[dr.ply]);
  if (want.from === mv.from && want.to === mv.to) return playDrillMove(want.san);
  dr.misses++;
  dr.wrongHere++;
  E.sel = null;
  sfx('bad');
  renderDrill(false);
  missAt(mv.to);
}

/* ---------- watching a line ---------- */
function startWatch(i, ply = 0) {
  stopAuto();
  E.drill = null;
  E.watch = { i, moves: moveList(tier().drills[i].moves), ply };
  renderWatch();
}

function leaveWatch() {
  E.watch = null;
  sync(false);
}

function stepWatch(by) {
  const w = E.watch;
  const ply = Math.max(0, Math.min(w.moves.length, w.ply + by));
  if (ply === w.ply) return;
  w.ply = ply;
  renderWatch(by > 0);
  if (by > 0) moveSound(E.last, E.game.inCheck());
}

function renderWatch(animate) {
  const t = tier(), w = E.watch, d = t.drills[w.i];
  E.game = startGame(d);
  E.last = null;
  w.moves.slice(0, w.ply).forEach((m) => { E.last = E.game.move(m); });
  E.sel = null;
  drawBoard();
  drawArrows();
  if (animate) animateLast();
  $('eyebrow').textContent = `${t.elo} Elo, watch`;
  $('title').textContent = d.name;
  const box = $('scroll');
  box.textContent = '';
  const list = mk('div', 'el-line');
  const base = startPly(d);
  w.moves.forEach((san, i) => {
    const ply = base + i;
    const n = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0 || i === 0) list.appendChild(mk('span', 'el-num', ply % 2 === 0 ? `${n}.` : `${n}...`));
    const b = mk('button', `el-mv${i + 1 === w.ply ? ' on' : ''}`, san);
    b.type = 'button';
    b.addEventListener('click', () => { stopAuto(); w.ply = i + 1; renderWatch(); });
    list.appendChild(b);
  });
  const row = mk('div', 'el-drills');
  const play = mk('button', 'el-btn', 'Play it yourself');
  const all = mk('button', 'el-btn', 'Back to summary');
  play.type = all.type = 'button';
  play.addEventListener('click', () => { const i = w.i; E.watch = null; startDrill(i); });
  all.addEventListener('click', () => { stopAuto(); leaveWatch(); });
  row.append(play, all);
  box.append(list, row);
  list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  $('next').disabled = w.ply >= w.moves.length;
  $('next').textContent = w.ply >= w.moves.length ? 'End of line' : 'Next move';
  $('back').disabled = false;
  $('pos').textContent = `Move ${w.ply} of ${w.moves.length}`;
  markTabs();
}

/* ---------- auto-play ---------- */
function stopAuto() {
  clearTimeout(E.auto);
  E.auto = null;
  $('auto').textContent = 'Auto-play';
}
function tickAuto() {
  if (!E.auto) return;
  if (E.watch) {
    if (E.watch.ply >= E.watch.moves.length) return stopAuto();
    E.auto = setTimeout(() => { stepWatch(1); tickAuto(); }, 1100);
    return;
  }
  if (E.drill || onWrap() || openQuiz()) return stopAuto();
  const st = scene().steps[E.step];
  E.auto = setTimeout(() => { next(); tickAuto(); }, 1400 + st.say.length * 42 + moveList(st.play).length * 500);
}
function toggleAuto() {
  if (E.auto) return stopAuto();
  if (E.watch && E.watch.ply >= E.watch.moves.length) { E.watch.ply = 0; renderWatch(); }
  E.auto = 1;
  $('auto').textContent = 'Pause';
  tickAuto();
}

/* ---------- boot ---------- */
async function selectOpening(id) {
  const pick = ++E.pick;   // a slow fetch must not override a later choice
  if (E.busy) cancelAnim();
  stopAuto();
  E.drill = null;
  E.watch = null;
  E.misses = 0;
  const entry = CATALOG.find((c) => c.id === id);
  pauseWalkthrough();
  E.walking = !!entry.walk;
  showWalk(E.walking);
  if (entry.walk) {
    E.id = id;
    E.lastIn[entry.group] = id;
    E.lesson = null;
    renderPicker();
    markTabs();
    save();
    const openPane = (type) => document.dispatchEvent(new CustomEvent(type, { detail: entry.walk }));
    // No four-level lesson for this opening? Its drill is the Openings tab's Train pane.
    return openWalkthrough($('walk'), entry.walk, { drill: () => (entry.drill ? drillSetup(entry.drill) : openPane('chess:open-train')), plan: () => openPane('chess:open-plan'), play: (end) => document.dispatchEvent(new CustomEvent('chess:play-from', { detail: { moves: end.playFrom, side: entry.side } })) });
  }
  try {
    if (!E.cache[id]) {
      const r = await fetch(`elo-lessons/${id}.json`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      E.cache[id] = await r.json();
    }
  } catch (err) {
    if (pick !== E.pick) return;
    $('title').textContent = `Couldn't load the ${entry.name} lesson`;
    $('scroll').textContent = err instanceof TypeError ? 'The lesson file could not be reached. On this computer the app server has probably stopped: run start-chess.cmd, then reopen the app. On the website, check your internet connection.' : String(err.message || err);
    // Coming from a walkthrough there is no lesson behind these controls.
    if (!E.lesson) { $('tiers').textContent = ''; ['next', 'back', 'auto'].forEach((k) => { $(k).disabled = true; }); }
    return;
  }
  if (pick !== E.pick) return;
  $('auto').disabled = false;
  E.id = id;
  E.lastIn[entry.group] = id;
  E.lesson = E.cache[id];
  renderPicker();
  const tabs = $('tiers');
  tabs.textContent = '';
  E.lesson.tiers.forEach((t, i) => {
    const b = mk('button', 'el-tier');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.append(mk('b', '', t.elo), mk('span', '', t.name), mk('small', '', t.hook));
    b.addEventListener('click', () => setTier(i));
    tabs.appendChild(b);
  });
  const [t, sc, st] = E.places[id] || [0, 0, 0];
  const T = E.lesson.tiers[t];
  const validScene = T && sc <= T.scenes.length;
  E.tier = T ? t : 0;
  E.scene = validScene ? sc : 0;
  E.step = validScene && T.scenes[sc]?.steps[st] ? st : 0;
  sync(false);
}

function showWalk(on) {
  $('walk').classList.toggle('hidden', !on);
  $('tiers').classList.toggle('hidden', on);
  $('stage').classList.toggle('hidden', on);
}

// From a walkthrough's last screen: the lesson's first level, on its practice page.
async function drillSetup(id) {
  await selectOpening(id);
  if (!E.lesson) return;   // the lesson didn't load, and the stage says so
  E.tier = 0; E.scene = tier().scenes.length; E.step = 0;
  sync(false);
}

// Openings and Danya's topics share one picker; the switch only changes which entries it lists.
function renderPicker() {
  const group = groupOf(E.id);
  [...$('groups').children].forEach((b) => b.classList.toggle('active', b.dataset.group === group));
  $('credit').innerHTML = CATALOG.find((c) => c.id === E.id)?.credit || CREDITS[group];
  const box = $('picker');
  box.textContent = '';
  CATALOG.filter((c) => c.group === group).forEach((c) => {
    const b = mk('button', 'el-pick');
    b.type = 'button';
    b.dataset.id = c.id;
    b.setAttribute('role', 'tab');
    const icon = mk('img');
    icon.src = `pieces/${c.side}K.svg`;
    icon.alt = c.side === 'w' ? 'White' : 'Black';
    const text = mk('span');
    text.append(mk('b', '', c.name), mk('small', '', c.role));
    b.append(icon, text);
    b.addEventListener('click', () => selectOpening(c.id));
    box.appendChild(b);
  });
}

function build(root) {
  E.root = root;
  root.innerHTML = `
    <div class="seg el-groups" data-el="groups"></div>
    <div class="el-picker" role="tablist" aria-label="Lesson" data-el="picker"></div>
    <div class="el-tiers" role="tablist" aria-label="Level" data-el="tiers"></div>
    <div class="el-walk hidden" data-el="walk"></div>
    <div class="el-stage" data-el="stage">
      <section class="el-left">
        <div class="el-board-wrap">
          <div class="el-board" data-el="board"></div>
          <svg class="el-arrows" data-el="arrows" viewBox="0 0 8 8" aria-hidden="true"></svg>
        </div>
        <div class="el-controls">
          <button class="el-btn" data-el="back" title="Left arrow">Back</button>
          <button class="el-btn primary" data-el="next" title="Right arrow">Next</button>
          <button class="el-btn" data-el="auto">Auto-play</button>
          <span class="el-pos" data-el="pos"></span>
        </div>
      </section>
      <section class="el-talk" aria-live="polite">
        <div class="el-head">
          <div class="eyebrow" data-el="eyebrow"></div>
          <h2 data-el="title"></h2>
        </div>
        <div class="el-scroll" data-el="scroll"></div>
      </section>
    </div>
    <footer class="el-credit" data-el="credit"></footer>`;
  E.arrows = userArrows($('board').parentElement);   // right-drag to draw your own arrows
  GROUPS.forEach(([g, label]) => {
    const b = mk('button', 'seg-btn', label);
    b.type = 'button';
    b.dataset.group = g;
    // Reopen the last lesson used in that group, else its first entry
    b.addEventListener('click', () => selectOpening(E.lastIn[g] || CATALOG.find((c) => c.group === g).id));
    $('groups').appendChild(b);
  });
  $('next').addEventListener('click', () => { stopAuto(); next(); });
  $('back').addEventListener('click', back);
  $('auto').addEventListener('click', toggleAuto);
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.tab !== 'elo' || e.target.closest('input, textarea, select') || e.ctrlKey || e.altKey || e.metaKey) return;
    if (E.walking) return walkthroughKey(e);
    if (e.key === 'ArrowRight' && !$('next').disabled) { stopAuto(); next(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' && !$('back').disabled) { back(); e.preventDefault(); }
  });
  // A walkthrough stops talking when you leave the tab.
  new MutationObserver(() => { if (document.body.dataset.tab !== 'elo') pauseWalkthrough(); }).observe(document.body, { attributes: true, attributeFilter: ['data-tab'] });
}

// at = { id, tier } jumps straight to one level, for a lesson opened from the coach's library.
export async function openLessons(root, at) {
  const first = !E.ready;
  if (first) {
    E.ready = true;
    load();
    build(root);
  }
  if (at) {
    await selectOpening(at.id);
    if (!E.walking) setTier(at.tier);
  } else if (first) selectOpening(E.id);
}
