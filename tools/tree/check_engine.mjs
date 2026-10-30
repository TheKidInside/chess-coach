// Usage: node tools/tree/check_engine.mjs <agent-output.json>      (checks every line that has its own "moves")
//        node tools/tree/check_engine.mjs --ids italian ruy ...       (checks existing lines in openings.js)
// Plays each line through Stockfish 19 and reports, per ply, how many centipawns the
// move gave away compared with Stockfish's best move (from the mover's point of view).
// Anything flagged >= 100 cp needs a reason (a known gambit) or a different move.
// Training lines are read from the original 28-line repertoire (base_openings.js), not static/openings.js,
// which already holds the merged drafts; that keeps a rebuild from drafts repeatable.
const BASE = fileURLToPath(new URL('./base_openings.js', import.meta.url));
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { Chess } = await import(pathToFileURL(root + 'static/vendor/chess.js').href);
const { OPENINGS } = await import(pathToFileURL(BASE).href);
const ENGINE = root + 'engine/stockfish/stockfish-windows-x86-64-universal.exe';
const MOVETIME = 250;

const sf = spawn(ENGINE, [], { stdio: ['pipe', 'pipe', 'ignore'] });
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
function until(pred) { return new Promise((res) => { waiter = (l) => { if (pred(l)) { waiter = null; res(l); } }; }); }

async function evalFen(fen) {    // score from the side to move's view, in cp (mate = ±10000)
  let score = 0, best = '';
  send(`position fen ${fen}`);
  send(`go movetime ${MOVETIME}`);
  await until((l) => {
    const m = l.match(/ score (cp|mate) (-?\d+)/);
    if (m && !/bound/.test(l)) score = m[1] === 'cp' ? +m[2] : (+m[2] > 0 ? 10000 : -10000);
    const pv = l.match(/ pv (\S+)/); if (pv) best = pv[1];
    return l.startsWith('bestmove');
  });
  return { score, best };
}

send('uci'); await until((l) => l === 'uciok');
send('isready'); await until((l) => l === 'readyok');

let lines = [];
const args = process.argv.slice(2);
if (args[0] === '--ids') lines = args.slice(1).map((id) => OPENINGS.find((o) => o.id === id)).filter(Boolean).map((o) => ({ id: o.id, moves: o.moves, gambit: [] }));
else for (const f of args) {
  const data = JSON.parse(readFileSync(f, 'utf8'));
  for (const [id, l] of Object.entries(data.lines || {})) {
    const moves = l.moves || OPENINGS.find((o) => o.id === id)?.moves;
    if (moves) lines.push({ id, moves, gambit: l.gambitPlies || [] });
  }
}

for (const l of lines) {
  const g = new Chess();
  const out = [];
  for (let i = 0; i < l.moves.length; i++) {
    const fen = g.fen();
    const before = await evalFen(fen);
    let mv;
    try { mv = g.move(l.moves[i]); } catch { out.push(`  ply ${i} ${l.moves[i]}: ILLEGAL`); break; }
    const after = await evalFen(g.fen());
    const loss = before.score - (-after.score);
    if (loss >= 100) {
      const tag = l.gambit.includes(i) ? ' (declared gambit)' : '';
      out.push(`  ply ${i} ${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'}${mv.san}: gives away ~${loss} cp; Stockfish preferred ${before.best}${tag}`);
    }
  }
  const final = await evalFen(g.fen());
  const white = g.turn() === 'w' ? final.score : -final.score;
  console.log(`${l.id}: final eval ${(white / 100).toFixed(2)} (White's view)${out.length ? '\n' + out.join('\n') : ', no flags'}`);
}
send('quit');
