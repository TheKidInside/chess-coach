// Builds static/eco.json from the Lichess chess-openings TSVs (a.tsv..e.tsv).
// Usage: node tools/build_eco.mjs <folder-with-tsvs>
// Keyed by position (first 4 FEN fields) so transpositions are recognised.
import { readFileSync, writeFileSync } from 'node:fs';
import { Chess } from '../static/vendor/chess.js';

const dir = process.argv[2];
const out = {};
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const rows = readFileSync(`${dir}/${f}.tsv`, 'utf8').trim().split('\n').slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    const g = new Chess();
    for (const tok of pgn.trim().split(/\s+/)) if (!/^\d+\.+$/.test(tok)) g.move(tok);
    const key = g.fen().split(' ').slice(0, 4).join(' ');
    // keep the entry with the shortest move order (the canonical name for that position)
    const plies = g.history().length;
    if (!out[key] || plies < out[key][2]) out[key] = [eco, name, plies];
  }
}
for (const k in out) out[k] = out[k].slice(0, 2);
writeFileSync(new URL('../static/eco.json', import.meta.url), JSON.stringify(out));
console.log(Object.keys(out).length, 'positions');
