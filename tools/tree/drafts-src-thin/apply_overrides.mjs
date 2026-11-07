// Run after write_lines.mjs --src drafts-src-thin --write: replaces the words named in
// overrides.json (moves explained only by a line of the other colour) in lines.gen.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (f) => fileURLToPath(new URL(f, import.meta.url));
const gen = JSON.parse(readFileSync(at('./lines.gen.json'), 'utf8'));
const over = JSON.parse(readFileSync(at('./overrides.json'), 'utf8'));
let n = 0;
for (const [id, plies] of Object.entries(over)) {
  if (id.startsWith('_')) continue;
  if (!gen[id]) { console.log(`no line ${id}`); process.exitCode = 1; continue; }
  for (const [ply, note] of Object.entries(plies)) { gen[id].notes[+ply] = note; gen[id].why[+ply] = note; n++; }
}
writeFileSync(at('./lines.gen.json'), JSON.stringify(gen, null, 1));
console.log(`${n} notes replaced`);
