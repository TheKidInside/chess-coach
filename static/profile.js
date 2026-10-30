// Player profile: XP + levels, daily goal + streak, spaced-repetition reviews for
// opening lines and your own mistakes, puzzle rating, and a game log.
// Saved to the server (data/profile.json) with a localStorage mirror as fallback.

import { hasServer } from './backend.js';

const MIRROR = 'chess-coach-profile';
let serverSync = false;   // false on static hosting: the browser copy is the only copy
export const INTERVALS = [0, 1, 3, 7, 14, 30];   // days until the next review, by box 0..5
export const MASTERED_BOX = 4;

export function today(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return today(new Date(y, m - 1, d + n));
}

function fresh() {
  return {
    v: 1, xp: 0, goal: 60,
    days: {},                                  // 'YYYY-MM-DD' -> XP earned that day
    streak: { cur: 0, best: 0, last: null },   // days in a row the daily goal was hit
    openings: {},                              // id -> {runs, clean, box, due}
    puzzles: { rating: 1200, solved: 0, failed: 0, run: 0, bestRun: 0, history: [], seen: [] },
    mistakes: [],                              // {id, fen, best, played, label, cls, date, box, due}
    games: [],                                 // newest first
    settings: { sound: true, theme: 'system', coachOpen: true, coachStyle: 'standard', repOpen: true, elo: 1500, color: 'w', coach: true },
    savedAt: 0,
  };
}

export const P = { data: fresh() };
const listeners = [];
export function onEvent(fn) { listeners.push(fn); }
function emit(ev) { for (const fn of listeners) fn(ev); }

// ------------------------------------------------------------------ storage ---

let saveTimer = null;
function push() {
  saveTimer = null;
  if (!serverSync) return;
  // keepalive lets the request finish even if the window is closing
  fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(P.data), keepalive: true })
    .catch(() => {});
}
export function save() {
  P.data.savedAt = Date.now();
  try { localStorage.setItem(MIRROR, JSON.stringify(P.data)); } catch { /* private mode */ }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(push, 400);
}
addEventListener('pagehide', () => { if (saveTimer) { clearTimeout(saveTimer); push(); } });

function merge(base, saved) {   // fill fields added in later versions
  const out = { ...base, ...saved };
  for (const k of ['streak', 'puzzles', 'settings']) out[k] = { ...base[k], ...(saved[k] || {}) };
  return out;
}

export async function loadProfile() {
  let server = null, local = null;
  serverSync = await hasServer;
  if (serverSync) try {
    const r = await fetch('/api/profile');
    if (r.ok) { const j = await r.json(); if (j && j.v === 1) server = j; }
  } catch { /* server offline */ }
  try { const j = JSON.parse(localStorage.getItem(MIRROR) || 'null'); if (j && j.v === 1) local = j; } catch { /* ignore */ }
  // whichever copy was saved last wins (the browser copy can be newer if a save never reached the server)
  const saved = server && local ? ((local.savedAt || 0) > (server.savedAt || 0) ? local : server) : server || local;
  P.data = saved ? merge(fresh(), saved) : fresh();
  if (saved === local && local && local !== server) save();   // push the newer copy back to the server
  migrateOldProgress();
  return P.data;
}

// The first version kept {id: {runs, clean}} under 'chess-coach-progress'.
function migrateOldProgress() {
  let old;
  try { old = JSON.parse(localStorage.getItem('chess-coach-progress') || 'null'); } catch { return; }
  if (!old) return;
  for (const [id, p] of Object.entries(old)) {
    if (P.data.openings[id]) continue;
    P.data.openings[id] = { runs: p.runs || 0, clean: p.clean || 0, box: Math.min(p.clean || 0, 5), due: today() };
  }
  try { localStorage.removeItem('chess-coach-progress'); } catch { /* ignore */ }
  save();
}

// ------------------------------------------------------------- XP + streak ---

export function levelStart(level) { return 25 * (level - 1) * level; }   // 0, 50, 150, 300, 500...
export function levelOf(xp) {
  let l = 1;
  while (levelStart(l + 1) <= xp) l++;
  return l;
}

export function todayXp() { return P.data.days[today()] || 0; }

export function streakNow() {   // a streak survives until the end of the day after it was last extended
  const s = P.data.streak;
  return s.last === today() || s.last === addDays(today(), -1) ? s.cur : 0;
}

export function addXp(amount, reason) {
  if (!amount) return;
  const d = P.data;
  const day = today();
  const beforeLevel = levelOf(d.xp);
  const beforeDay = d.days[day] || 0;
  d.xp += amount;
  d.days[day] = beforeDay + amount;
  emit({ type: 'xp', amount, reason });
  checkGoal();
  const afterLevel = levelOf(d.xp);
  if (afterLevel > beforeLevel) emit({ type: 'level', level: afterLevel });
  save();
}

// Extend the streak the first time today's XP is at or over the goal (also run when the goal changes).
export function checkGoal() {
  const d = P.data, day = today(), s = d.streak;
  if ((d.days[day] || 0) < d.goal || s.last === day) return;
  s.cur = s.last === addDays(day, -1) ? s.cur + 1 : 1;
  s.last = day;
  s.best = Math.max(s.best, s.cur);
  save();
  emit({ type: 'goal', streak: s.cur });
}

// ------------------------------------------------------- spaced repetition ---

function schedule(item, ok) {
  item.box = ok ? Math.min(5, (item.box || 0) + 1) : Math.max(0, (item.box || 0) - 2);
  item.due = addDays(today(), ok ? INTERVALS[item.box] : 1);
}

export function openingStat(id) { return P.data.openings[id] || null; }

// Only a drill on a due (or brand-new) line moves it between boxes; drilling early
// is practice and can't fast-track a line to "mastered". A slip always counts.
// Returns {ok, wasDue, isNew, moved, box, firstToday} so the UI can phrase the result and pay XP.
export function recordOpening(id, mode, slips) {
  const isNew = !P.data.openings[id];
  const o = P.data.openings[id] || (P.data.openings[id] = { runs: 0, clean: 0, box: 0, due: addDays(today(), 1) });
  const wasDue = !isNew && o.due <= today();
  const firstToday = o.practised !== today();
  o.practised = today();
  o.runs++;
  let moved = false;
  if (mode === 'drill') {
    const firstClean = o.clean === 0;   // the drill right after Learn counts: box 0 -> 1
    if (slips === 0) o.clean++;
    if (wasDue || isNew || firstClean || slips > 0) { schedule(o, slips === 0); moved = true; }
  }
  save();
  return { ok: slips === 0, wasDue, isNew, moved, box: o.box, due: o.due, firstToday };
}

export function dueOpenings(all) {
  const t = today();
  return all.filter((o) => P.data.openings[o.id] && P.data.openings[o.id].due <= t);
}

export function addMistake(m) {
  const list = P.data.mistakes;
  if (list.some((x) => x.fen === m.fen)) return;
  list.unshift({ ...m, id: Date.now().toString(36), date: today(), box: 0, due: today() });
  if (list.length > 300) list.length = 300;
  save();
}

export function dueMistakes() {
  const t = today();
  return P.data.mistakes.filter((m) => m.due <= t);
}

export function recordMistakeReview(id, ok) {
  const m = P.data.mistakes.find((x) => x.id === id);
  if (!m) return;
  schedule(m, ok);
  save();
}

// ------------------------------------------------------------------ puzzles ---

export function recordPuzzle(puzzle, solved) {
  const p = P.data.puzzles;
  const expected = 1 / (1 + 10 ** ((puzzle.rating - p.rating) / 400));
  const k = p.solved + p.failed < 30 ? 40 : 20;     // move faster while the rating is new
  const delta = Math.round(k * ((solved ? 1 : 0) - expected));
  p.rating = Math.max(400, p.rating + delta);
  if (solved) { p.solved++; p.run++; p.bestRun = Math.max(p.bestRun, p.run); } else { p.failed++; p.run = 0; }
  p.history.push([today(), p.rating]);
  if (p.history.length > 400) p.history.splice(0, p.history.length - 400);
  p.seen.push(puzzle.id);
  if (p.seen.length > 500) p.seen.splice(0, p.seen.length - 500);
  save();
  return delta;
}

// Lichess's anonymous puzzle feed centres on ~1500; step the difficulty to track the player.
export function puzzleDifficulty() {
  const r = P.data.puzzles.rating;
  return r < 1050 ? 'easiest' : r < 1300 ? 'easier' : r < 1650 ? 'normal' : r < 1950 ? 'harder' : 'hardest';
}

// -------------------------------------------------------------------- games ---

// Lichess-style per-move accuracy from the drop in winning chances (0-100).
export function moveAccuracy(loss) {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
}

export function recordGame(g) {
  P.data.games.unshift({ ...g, date: today() });
  if (P.data.games.length > 200) P.data.games.length = 200;
  save();
}
