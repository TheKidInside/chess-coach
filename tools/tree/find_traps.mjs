// Usage: node tools/tree/find_traps.mjs "e4 e5 Nf3 Nc6 d4" [--cp 150] [--games 20] [--share 0.02] [--ms 200]
// Which real-game moves from this position are actually traps? Walks static/explorer.json down from the
// seed moves, searches each position with Stockfish and lists every move players really choose (at least
// --games games and --share of the position) that throws away --cp centipawns or more compared with
// Stockfish's best. Printed most-played first, with the refutation Stockfish gives. A candidate list for
// topic "trap" / "mistake" lines, not the lines themselves: read each one and write it up by hand.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { Chess } = await import(pathToFileURL(root + 'static/vendor/chess.js').href);
const ex = JSON.parse(readFileSync(root + 'static/explorer.json', 'utf8'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? +args[i + 1] : d; };
const CP = opt('cp', 150), GAMES = opt('games', 20), SHARE = opt('share', 0.02), MS = opt('ms', 200);
const key = (f) => f.split(' ').slice(0, 4).join(' ');
const sum = (r) => r.slice(1).reduce((a, x) => a + x, 0);
const sideOf = (fen) => fen.split(' ')[1];

const sf = spawn(root + 'engine/stockfish/stockfish-windows-x86-64-universal.exe', [], { stdio: ['pipe', 'pipe', 'ignore'] });
let buf = '', waiter = null;
sf.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (waiter) waiter(line);
  }
});
const send = (s) => sf.stdin.write(s + '\n');
const until = (pred) => new Promise((res) => { waiter = (l) => { if (pred(l)) { waiter = null; res(l); } }; });

const seen = new Map();
async function evalFen(fen) {   // from the side to move's view, cp (mate = +-10000), with the principal variation
  if (seen.has(fen)) return seen.get(fen);
  const g = new Chess(fen);
  if (g.isCheckmate()) return { score: -10000, pv: [] };
  if (g.isGameOver()) return { score: 0, pv: [] };
  let score = 0, pv = [];
  send(`position fen ${fen}`);
  send(`go movetime ${MS}`);
  await until((l) => {
    const m = l.match(/ score (cp|mate) (-?\d+)/);
    if (m && !/bound/.test(l)) {
      score = m[1] === 'cp' ? +m[2] : (+m[2] > 0 ? 10000 : -10000);
      const p = l.match(/ pv (.+)$/); if (p) pv = p[1].split(' ');
    }
    return l.startsWith('bestmove');
  });
  const out = { score, pv };
  seen.set(fen, out);
  return out;
}
const pvSan = (fen, pv, n = 7) => {
  const g = new Chess(fen), out = [];
  for (const u of pv.slice(0, n)) {
    try { out.push(g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch { break; }
  }
  return out.join(' ');
};

send('uci'); await until((l) => l === 'uciok');
send('setoption name Threads value 6');
send('isready'); await until((l) => l === 'readyok');

const start = new Chess();
const seed = (args[0] || '').trim().split(/\s+/).filter(Boolean);
for (const m of seed) start.move(m);
const queue = [{ fen: start.fen(), path: seed }];
const visited = new Set();
const found = [];
let walked = 0;
while (queue.length) {
  const { fen, path } = queue.shift();
  const k = key(fen);
  if (visited.has(k)) continue;
  visited.add(k);
  const rows = ex.pos[k];
  if (!rows) continue;
  walked++;
  const before = await evalFen(fen);
  const total = rows.reduce((a, r) => a + sum(r), 0);
  for (const r of rows) {
    const g = new Chess(fen);
    const n = sum(r);
    try { g.move(r[0]); } catch { continue; }
    if (n >= GAMES && n / total >= SHARE) {
      const after = await evalFen(g.fen());
      const loss = before.score - (-after.score);
      if (loss >= CP) {
        found.push({
          n, share: n / total, loss, path, san: r[0], side: sideOf(fen),
          best: pvSan(fen, before.pv, 1), refute: pvSan(g.fen(), after.pv),
          white: sideOf(g.fen()) === 'w' ? after.score : -after.score,
        });
      }
    }
    queue.push({ fen: g.fen(), path: [...path, r[0]] });
  }
}
found.sort((a, b) => b.n - a.n);
console.log(`${walked} positions walked, ${found.length} moves lose ${CP}+ cp`);
for (const f of found) {
  console.log(`${f.side === 'w' ? 'WHITE errs' : 'BLACK errs'} ${f.n}g ${(f.share * 100).toFixed(0)}% -${f.loss}cp eval ${(f.white / 100).toFixed(1)} | ${f.path.slice(4).join(' ')} ?${f.san} | best ${f.best} | ${f.refute}`);
}
send('quit');
