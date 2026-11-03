// One-off: create drafts/g7.json with the split London / Caro-Kann families and the Jobava, and move
// the existing lines that now belong to them. Safe to re-run (it rebuilds g7 families from scratch).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../drafts/', import.meta.url));
const read = (f) => JSON.parse(readFileSync(dir + f, 'utf8'));
const write = (f, d) => {
  const raw = readFileSync(dir + f, 'utf8');
  const indent = (raw.match(/\n( +)"/) || [, '  '])[1].length;
  writeFileSync(dir + f, JSON.stringify(d, null, indent).replace(/\n/g, raw.includes('\r\n') ? '\r\n' : '\n') + (raw.includes('\r\n') ? '\r\n' : '\n'));
};

const g2 = read('g2.json'), g4 = read('g4.json');
const g7 = existsSync(dir + 'g7.json') ? read('g7.json') : { families: [], lines: {} };

const FAMS = [
  { id: 'london-nf6', topic: 'london', after: 'london', name: 'London System: 1...Nf6', side: 'w',
    idea: 'The same pyramid against 1...Nf6. What changes is the ...g6 and ...d6 set-ups: h3 saves your bishop from ...Nh5, Be2 replaces Bd3, and when ...e5 comes the bishop drops to h2 and c4 takes space.',
    masters: ['Against King\'s Indian set-ups the London is at its most flexible: White can choose between the pyramid and a c4 plan after seeing what Black does.'],
    move: { 'london-kid': 'main' } },
  { id: 'london-side', topic: 'london', after: 'london-nf6', name: 'London System: other first moves', side: 'w',
    idea: 'Every other reply to 1.d4. Most of them transpose to the pyramid after 2.Bf4; 1...c5 gets 2.d5, and 1...e5 is the Englund Gambit, where one trap decides everything.',
    masters: ['The Englund Gambit is unsound, but its trap has won a huge number of games at club level, so learning the single correct reply is worth your time.'],
    move: {} },
  { id: 'jobava', topic: 'london', after: 'london-side', name: 'Jobava London', side: 'w',
    idea: 'Nc3 and Bf4 instead of the pyramid. The knight blocks the c-pawn but aims at b5, where with the bishop it hits c7. If Black trades bishops on d3, recapture with the c-pawn for control of e4 and c4, the c-file and b3 for the queen.',
    masters: [
      'Named after the Georgian grandmaster Baadur Jobava, and also called the Rapport-Jobava system after Richard Rapport, who has also used it at elite level.',
      'Compared with the pyramid London it is sharper and asks Black concrete questions from move three: ...c5 and ...Be7 both run into Nb5.',
    ],
    move: {} },
  { id: 'caro-advance', topic: 'carokann', after: 'carokann', name: 'Caro-Kann: Advance', side: 'b',
    idea: 'White gets space with 3.e5. Your bishop goes to f5 before ...e6, then ...c5 and ...Qb6 attack the d4 chain from its base, and ...Ne7 goes to f5 or g6.',
    masters: ['Short and Tal popularised two very different White plans here: the quiet Nf3 and Be2, and the h4 and g4 pawn chase.'],
    move: { 'carokann-adv': 'main', 'carokann-g4': 'variation' } },
  { id: 'caro-exchange', topic: 'carokann', after: 'caro-advance', name: 'Caro-Kann: Exchange and Panov', side: 'b',
    idea: 'After 3.exd5 cxd5 the structure is symmetrical. Develop with ...Nc6, ...Nf6, ...Bg4 and ...e6, and against c4 (the Panov) blockade the isolated d-pawn and swap pieces.',
    masters: ['Botvinnik played the Panov as White in his world title matches, so its isolated-pawn plans are some of the best studied of all.'],
    move: { 'carokann-exch': 'main' } },
  { id: 'caro-side', topic: 'carokann', after: 'caro-exchange', name: 'Caro-Kann: other White systems', side: 'b',
    idea: 'Everything else: the Two Knights, 2.Nf3, 2.Bc4, 2.f4, the King\'s Indian Attack with 2.d3, 2.c4, 2.e5 and the Fantasy with 3.f3. The reply is nearly always ...d5, then the same bishop-first development.',
    masters: ['Bobby Fischer played the Two Knights with 3.Nf3 against the Caro-Kann, and ...Bg4 is still the principled reply.'],
    move: { 'carokann-twoknights': 'main', 'carokann-bh5': 'variation' } },
];

const take = (draft, id, kind) => {
  const entry = draft.data.lines[id];
  if (!entry) throw new Error('no line ' + id);
  delete draft.data.lines[id];
  for (const f of draft.data.families) f.lines = f.lines.filter((x) => x !== id);
  return { ...entry, kind };
};

const keep = new Map(g7.families.map((f) => [f.id, f.lines]));
g7.families = FAMS.map(({ move, ...f }) => {
  const lines = Object.keys(move);
  for (const [id, kind] of Object.entries(move)) {
    const from = g2.lines[id] ? { data: g2 } : g4.lines[id] ? { data: g4 } : null;
    if (from) g7.lines[id] = take(from, id, kind);
  }
  return { ...f, lines: [...new Set([...lines, ...(keep.get(f.id) || [])])] };
});
write('g2.json', g2);
write('g4.json', g4);
if (!existsSync(dir + 'g7.json')) writeFileSync(dir + 'g7.json', '{\n "families": []\n}\n');
write('g7.json', g7);
console.log('g7 families:', g7.families.map((f) => `${f.id}(${f.lines.length})`).join(' '));
