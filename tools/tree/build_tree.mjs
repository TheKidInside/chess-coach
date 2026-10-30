// Usage: node tools/tree/build_tree.mjs [--write] tools/tree/drafts/g1.json tools/tree/drafts/g2.json ...
// Merges the opening-tree drafts into the app's data files:
//   static/openings.js  FAMILIES + OPENINGS (existing lines keep their ids, so progress carries over)
//   static/study.js     STUDY commentary per line (why / gm / show)
// Without --write it prints a summary only. Lines not covered by any draft stay as one-line families.
// Training lines are read from the original 28-line repertoire (base_openings.js), not static/openings.js,
// which already holds the merged drafts; that keeps a rebuild from drafts repeatable.
const BASE = fileURLToPath(new URL('./base_openings.js', import.meta.url));
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../static/', import.meta.url));
const { OPENINGS: OLD } = await import(pathToFileURL(BASE).href + '?' + Date.now());
// --out <dir>: write the two files there instead of the repo's static/ (for a test copy)
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const outDir = outAt >= 0 ? args.splice(outAt, 2)[1].replace(/\/?$/, '/') : root;
const write = args[0] === '--write' || outAt >= 0;
const files = args.filter((a) => a !== '--write');

const lines = new Map(OLD.map((o) => [o.id, { ...o }]));
const study = {};
const families = [];
for (const f of files) {
  const data = JSON.parse(readFileSync(f, 'utf8'));
  for (const fam of data.families) families.push({ ...fam });
  for (const [id, l] of Object.entries(data.lines)) {
    const fam = data.families.find((x) => x.lines.includes(id));
    const base = lines.get(id) || { id, side: fam.side };
    const merged = { ...base, family: fam.id, branch: l.branch, kind: l.kind };
    for (const k of ['name', 'eco', 'level', 'idea', 'moves', 'notes', 'joins']) if (l[k] !== undefined) merged[k] = l[k];
    lines.set(id, merged);
    study[id] = { why: l.why, ...(l.gm && Object.keys(l.gm).length ? { gm: l.gm } : {}), ...(l.show && Object.keys(l.show).length ? { show: l.show } : {}) };
  }
}
// Old lines no draft claimed: their own one-line family.
for (const o of OLD) {
  if (lines.get(o.id).family) continue;
  families.push({ id: o.id, name: o.name, side: o.side, idea: o.idea, masters: [], lines: [o.id] });
  Object.assign(lines.get(o.id), { family: o.id, branch: 'Main line', kind: 'main' });
}
// Families in the old list order of their main line (keeps the White e4 / d4, Black e4 / d4 grouping).
const rank = (fam) => { const i = OLD.findIndex((o) => fam.lines.includes(o.id)); return i < 0 ? 999 : i; };
families.sort((a, b) => rank(a) - rank(b));

const q = JSON.stringify;
const ind = (n) => ' '.repeat(n);
let out = `// Opening repertoire, organised as FAMILIES (main openings), each a main line plus branches.
// Line fields: \`side\` is the colour the student plays; \`moves\` is the line in SAN from move 1;
// \`notes[i]\` explains moves[i] (ply i); \`level\` 1 beginner-friendly, 2 intermediate, 3 sharp.
// \`family\` + \`branch\` place it in the tree; \`kind\` is main | variation | transposition, and a
// transposition's \`joins\` names the line whose position it reaches by another move order.
// The longer Study-mode commentary (why, master callouts, idea arrows) lives in study.js.
export const FAMILIES = [\n`;
for (const f of families) {
  out += `${ind(2)}{\n${ind(4)}id: ${q(f.id)}, name: ${q(f.name)}, side: ${q(f.side)},\n${ind(4)}idea: ${q(f.idea)},\n`;
  out += `${ind(4)}masters: [\n${f.masters.map((m) => `${ind(6)}${q(m)},\n`).join('')}${ind(4)}],\n`;
  out += `${ind(4)}lines: [${f.lines.map(q).join(', ')}],\n${ind(2)}},\n`;
}
out += '];\n\nexport const OPENINGS = [\n';
for (const f of families) {
  out += `${ind(2)}// ---- ${f.name} ----\n`;
  for (const id of f.lines) {
    const o = lines.get(id);
    out += `${ind(2)}{\n${ind(4)}id: ${q(o.id)}, family: ${q(o.family)}, kind: ${q(o.kind)}, branch: ${q(o.branch)},${o.joins ? ` joins: ${q(o.joins)},` : ''}\n`;
    out += `${ind(4)}name: ${q(o.name)}, eco: ${q(o.eco)}, side: ${q(o.side)}, level: ${o.level},\n`;
    out += `${ind(4)}idea: ${q(o.idea)},\n${ind(4)}moves: [${o.moves.map(q).join(', ')}],\n`;
    out += `${ind(4)}notes: [\n${o.notes.map((n) => `${ind(6)}${q(n)},\n`).join('')}${ind(4)}],\n${ind(2)}},\n`;
  }
}
out += '];\n';

let st = `// Study-mode commentary, keyed by line id (see openings.js). why[i] expands on the line's
// notes[i] (ply i); gm: { ply: master callout }; show: { ply: ["c4f7"] } idea arrows drawn after that ply.
export const STUDY = {\n`;
for (const f of families) for (const id of f.lines) {
  const s = study[id];
  if (!s) continue;
  st += `${ind(2)}${/^[a-z][a-z0-9]*$/.test(id) ? id : q(id)}: {\n${ind(4)}why: [\n${s.why.map((w) => `${ind(6)}${q(w)},\n`).join('')}${ind(4)}],\n`;
  if (s.gm) st += `${ind(4)}gm: {\n${Object.entries(s.gm).map(([k, v]) => `${ind(6)}${+k}: ${q(v)},\n`).join('')}${ind(4)}},\n`;
  if (s.show) st += `${ind(4)}show: { ${Object.entries(s.show).map(([k, v]) => `${+k}: [${v.map(q).join(', ')}]`).join(', ')} },\n`;
  st += `${ind(2)}},\n`;
}
st += '};\n';

const nLines = families.reduce((n, f) => n + f.lines.length, 0);
console.log(`${families.length} families, ${nLines} lines (${nLines - OLD.length} new), commentary for ${Object.keys(study).length} lines`);
if (write) {
  writeFileSync(outDir + 'openings.js', out);
  writeFileSync(outDir + 'study.js', st);
  console.log(`wrote openings.js (${(out.length / 1024).toFixed(0)} KB) and study.js (${(st.length / 1024).toFixed(0)} KB)`);
}
