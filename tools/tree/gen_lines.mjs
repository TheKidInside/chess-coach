// Usage: node tools/tree/gen_lines.mjs <family> [--n 8] [--share 0.05] [--games 150] [--plies 14] [--from-ply n] [--out <moves.json>]
// Proposes new lines for one opening from its biggest coverage gaps (the same walk as coverage.mjs):
// each gap's path is followed past the uncovered reply, the opponent playing the move real players
// choose most (explorer.json) and you playing the most popular move Stockfish rates within 35 cp of
// its best (else Stockfish's move). Once the explorer runs out, Stockfish plays both sides, until
// the line has `--plies` moves past the gap. A gap a generated line already reaches is skipped, and
// so is any gap before the moves all the opening's lines share (--from-ply overrides that ply).
// Prints the lines; with --out, merges them into that moves.json ({ lines: { id: { family, moves } } }).
// Ids are <family>-<gap move> (+ a number if taken). The words still have to be written by hand.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { Chess } = await import(pathToFileURL(root + 'static/vendor/chess.js').href);
const { FAMILIES, OPENINGS } = await import(pathToFileURL(root + 'static/openings.js').href);
const ex = JSON.parse(readFileSync(root + 'static/explorer.json', 'utf8'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const fam = FAMILIES.find((f) => f.id === args[0]);
if (!fam) { console.log(`no family ${args[0]}`); process.exit(1); }
const N = +opt('n', 8), SHARE = +opt('share', 0.05), GAMES = +opt('games', 150), PLIES = +opt('plies', 14);
const OK_LOSS = 35, OPP_LOSS = 80, MOVETIME = 400;
const key = (f) => f.split(' ').slice(0, 4).join(' ');
const games = (r) => r.slice(1).reduce((a, x) => a + x, 0);

// ---- Stockfish
const sf = spawn(root + 'engine/stockfish/stockfish-windows-x86-64-universal.exe', [], { stdio: ['pipe', 'pipe', 'ignore'] });
let buf = '', waiter = null;
sf.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (waiter) waiter(l); }
});
const send = (s) => sf.stdin.write(s + '\n');
const until = (pred) => new Promise((res) => { waiter = (l) => { if (pred(l)) { waiter = null; res(l); } }; });
const cache = new Map();
async function multi(fen) {   // { uci: cp } for the top 5 moves, side to move's view
  if (cache.has(fen)) return cache.get(fen);
  const out = {};
  send('setoption name MultiPV value 5');
  send(`position fen ${fen}`);
  send(`go movetime ${MOVETIME}`);
  await until((l) => {
    const m = l.match(/ multipv (\d+).*? score (cp|mate) (-?\d+).*? pv (\S+)/);
    if (m && !/bound/.test(l)) out[m[4]] = m[2] === 'cp' ? +m[3] : (+m[3] > 0 ? 10000 : -10000);
    return l.startsWith('bestmove');
  });
  cache.set(fen, out);
  return out;
}
async function scoreOf(fen, san) {   // cp for one move, side to move's view (searched alone if not in the top 5)
  const g = new Chess(fen);
  const mv = g.move(san);
  const uci = mv.from + mv.to + (mv.promotion || '');
  const top = await multi(fen);
  if (top[uci] !== undefined) return top[uci];
  const after = await multi(g.fen());
  const best = Math.max(...Object.values(after));
  return -best;
}
send('uci'); await until((l) => l === 'uciok');
send('setoption name Threads value 6');
send('isready'); await until((l) => l === 'readyok');

// ---- coverage walk (as coverage.mjs)
const covered = new Map([[key(new Chess().fen()), []]]);
const addPath = (moves) => {
  const g = new Chess(), path = [];
  for (const m of moves) { const mv = g.move(m); path.push(mv.san); if (!covered.has(key(g.fen()))) covered.set(key(g.fen()), [...path]); }
};
const own = OPENINGS.filter((x) => x.family === fam.id);
for (const o of own) addPath(o.moves);
// Only gaps at or past the moves every line shares (the Slav starts after 1.d4 d5 2.c4 c6), so a
// reply to the opening proper, not to some earlier move order the opening never meant to cover.
const core = own.filter((o) => o.kind !== 'transposition');
let pre = 0;
while (core.every((o) => o.moves[pre] && o.moves[pre] === core[0].moves[pre])) pre++;
const FROM = +opt('from-ply', pre);
const STEM = core[0].moves.slice(0, FROM);   // and only down the opening's own move order
function gaps() {
  const out = [];
  for (const [k, path] of covered) {
    if (k.split(' ')[1] === fam.side || !path.length || path.length < FROM || STEM.some((m, i) => path[i] !== m)) continue;
    const rows = ex.pos[k];
    if (!rows) continue;
    const n = rows.reduce((a, r) => a + games(r), 0);
    for (const r of rows) {
      if (games(r) < GAMES || games(r) / n < SHARE) continue;
      const t = new Chess(k + ' 0 1');
      t.move(r[0]);
      if (!covered.has(key(t.fen()))) out.push({ path, move: r[0], games: games(r) });
    }
  }
  return out.sort((a, b) => b.games - a.games);
}

async function extend(start) {
  const g = new Chess();
  for (const m of start) g.move(m);
  const moves = [...start];
  let offBook = 0;   // plies since the explorer ran out: Stockfish alone gets 6, enough to show the idea
  while (moves.length < start.length + PLIES && !g.isGameOver() && !(offBook >= 6 && moves.length >= start.length + 8)) {
    const fen = g.fen();
    const top = await multi(fen);
    const best = Math.max(...Object.values(top));
    const bestUci = Object.keys(top).find((u) => top[u] === best);
    const mine = g.turn() === fam.side;
    const rows = (ex.pos[key(fen)] || []).filter((r) => games(r) >= 30).sort((a, b) => games(b) - games(a));
    offBook = rows.length ? 0 : offBook + 1;
    let pick = null;
    for (const r of rows.slice(0, 4)) {
      const sc = await scoreOf(fen, r[0]);
      if (best - sc <= (mine ? OK_LOSS : OPP_LOSS)) { pick = r[0]; break; }
    }
    if (!pick) pick = g.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] }).san, g.undo();
    moves.push(g.move(pick).san);
  }
  if (g.turn() === fam.side && !g.isGameOver()) {   // end on your move, not on the opponent's
    const top = await multi(g.fen());
    const u = Object.keys(top).sort((a, b) => top[b] - top[a])[0];
    if (u) moves.push(g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
  }
  return moves;
}

const outFile = opt('out');
const store = outFile && existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : { lines: {} };
const taken = new Set([...OPENINGS.map((o) => o.id), ...Object.keys(store.lines)]);
const made = [];
for (let k = 0; k < N; k++) {
  const gap = gaps()[0];
  if (!gap) break;
  const moves = await extend([...gap.path, gap.move]);
  addPath(moves);
  let id = `${fam.id}-${gap.move.replace(/[+#x=]/g, '').toLowerCase()}`;
  for (let i = 2; taken.has(id); i++) id = `${fam.id}-${gap.move.replace(/[+#x=]/g, '').toLowerCase()}${i}`;
  taken.add(id);
  made.push(id);
  store.lines[id] = { family: fam.id, moves: moves.join(' ') };
  console.log(`${id} (gap ${gap.games} games after ${gap.path.join(' ')}): ${moves.join(' ')}`);
}
const left = gaps();
console.log(`${fam.id}: ${made.length} new lines; ${left.length} gaps left over ${SHARE * 100}% and ${GAMES} games`);
if (outFile) writeFileSync(outFile, JSON.stringify(store, null, 1));
send('quit');
process.exit(0);
