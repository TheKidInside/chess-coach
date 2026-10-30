// Usage: node tools/tree/print_line.mjs <opening-id> [<opening-id> ...]
// Prints every ply of a Chess Coach training line: SAN, the existing short note,
// the FEN and an ASCII board AFTER the move, so commentary can be checked against
// the real position instead of memory.
// Training lines are read from the original 28-line repertoire (base_openings.js), not static/openings.js,
// which already holds the merged drafts; that keeps a rebuild from drafts repeatable.
const BASE = fileURLToPath(new URL('./base_openings.js', import.meta.url));
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../static/', import.meta.url));
const { Chess } = await import(pathToFileURL(root + 'vendor/chess.js').href);
const { OPENINGS } = await import(pathToFileURL(BASE).href);

// node tools/tree/print_line.mjs --file tools/tree/drafts/g1.json <new-id> ...   prints lines from a draft JSON too
let ids = process.argv.slice(2), extra = {};
if (ids[0] === '--file') {
  const { readFileSync } = await import('node:fs');
  for (const [id, l] of Object.entries(JSON.parse(readFileSync(ids[1], 'utf8')).lines || {})) if (l.moves) extra[id] = { id, side: '?', ...l };
  ids = ids.slice(2);
}
if (!ids.length) { console.log(OPENINGS.map((o) => o.id).join(' ')); process.exit(0); }
for (const id of ids) {
  const o = OPENINGS.find((x) => x.id === id) || extra[id];
  if (!o) { console.log(`unknown id ${id}`); continue; }
  console.log(`\n==== ${o.id}: ${o.name} (${o.eco}) — student plays ${o.side === 'w' ? 'White' : 'Black'}, ${o.moves.length} plies`);
  console.log(`idea: ${o.idea}`);
  const g = new Chess();
  o.moves.forEach((san, i) => {
    const mv = g.move(san);
    const label = `${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'}${mv.san}`;
    console.log(`\n-- ply ${i}: ${label} (${mv.color === 'w' ? 'White' : 'Black'} ${mv.piece.toUpperCase()} ${mv.from}-${mv.to}${mv.captured ? ' captures ' + mv.captured : ''})`);
    console.log(`note: ${o.notes[i]}`);
    console.log(`fen:  ${g.fen()}`);
    console.log(g.ascii());
  });
}
