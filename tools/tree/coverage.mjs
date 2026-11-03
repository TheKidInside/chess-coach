// Usage: node tools/tree/coverage.mjs <family-id,family-id> [--share 0.03] [--games 80] [--seed "d4 d5 Bf4"] [--lines <file.json>] [--study <file.pgn>]
// How much of what real opponents play does a repertoire answer? Walks the given families' lines
// through static/explorer.json by position (so transpositions count). At every covered position
// where the opponent is to move, each reply over the thresholds that leaves the repertoire is a gap.
// --seed starts the walk at a position even if no line passes through it yet (repeatable, | separated).
// --study also counts the lines a Lichess study PGN gives (that text is never saved in this repo).
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../static/', import.meta.url));
const { Chess } = await import(pathToFileURL(root + 'vendor/chess.js').href);
const { FAMILIES, OPENINGS } = await import(pathToFileURL(root + 'openings.js').href);
const ex = JSON.parse(readFileSync(root + 'explorer.json', 'utf8'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const fams = args[0].split(',');
const SHARE = +opt('share', 0.03), GAMES = +opt('games', 80);
const key = (f) => f.split(' ').slice(0, 4).join(' ');
const sum = (r) => r.slice(1).reduce((a, x) => a + x, 0);

const lines = OPENINGS.filter((o) => fams.includes(o.family));
const side = FAMILIES.find((f) => f.id === fams[0])?.side || opt('side', 'w');
let extra = [];
if (opt('study')) {
  const { parseStudyPgn, studyToRepertoire } = await import(pathToFileURL(root + 'lichess.js').href);
  const rep = studyToRepertoire({ id: 'x', side, label: 'x', topic: 'x', level: () => 1 }, parseStudyPgn(readFileSync(opt('study'), 'utf8')));
  extra = rep.lines.map((l) => l.moves);
  console.log(`study: ${extra.length} lines`);
}
// Every position the repertoire reaches, with one move path to it (for printing the gap).
const covered = new Map([[key(new Chess().fen()), []]]);
const addPath = (moves) => {
  const g = new Chess();
  const path = [];
  for (const m of moves) { const mv = g.move(m); path.push(mv.san); if (!covered.has(key(g.fen()))) covered.set(key(g.fen()), [...path]); }
};
for (const l of lines) addPath(l.moves);
for (const m of extra) addPath(m);
for (const s of (opt('seed', '') || '').split('|').filter(Boolean)) addPath(s.trim().split(/\s+/));
// --lines <file>: planned lines not merged yet ({ lines: { id: { family?, moves: "e4 c6 ..." or [...] } } }).
if (opt('lines')) for (const l of Object.values(JSON.parse(readFileSync(opt('lines'), 'utf8')).lines)) {
  if (!l.family || fams.includes(l.family)) addPath(typeof l.moves === 'string' ? l.moves.trim().split(/\s+/) : l.moves);
}

let gaps = [], hits = 0, oppNodes = 0;
for (const [k, path] of covered) {
  const stm = k.split(' ')[1];
  if (stm === side) continue;
  const rows = ex.pos[k];
  if (!rows) continue;
  const n = rows.reduce((a, r) => a + sum(r), 0);
  oppNodes++;
  for (const r of rows) {
    if (sum(r) < GAMES || sum(r) / n < SHARE) continue;
    const t = new Chess(k + ' 0 1');
    t.move(r[0]);
    if (!path.length) continue;   // White's first move is not a reply to the repertoire
    if (covered.has(key(t.fen()))) hits++;
    else gaps.push({ path, move: r[0], games: sum(r), share: sum(r) / n, ply: path.length });
  }
}
gaps.sort((a, b) => b.games - a.games);
console.log(`${fams}: ${lines.length} lines, ${covered.size} positions, ${oppNodes} opponent decision points with data`);
console.log(`replies over ${SHARE * 100}% and ${GAMES} games: ${hits} answered, ${gaps.length} not (${(100 * hits / Math.max(1, hits + gaps.length)).toFixed(0)}%)`);
for (const g of gaps) console.log(`${String(g.games).padStart(6)} ${(g.share * 100).toFixed(0).padStart(3)}%  ${g.path.join(' ')} -> ${g.move}`);
process.exit(0);
