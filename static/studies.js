// Lichess studies in the repertoire. Each study in STUDIES is downloaded from lichess.org in the
// browser, turned into families + lines by lichess.js and appended to FAMILIES / OPENINGS / STUDY
// before app.js reads them, so Study, Learn, Drill and the review schedule all just work.
// The study text is the author's: it is fetched live from Lichess and kept in this browser's
// cache, never copied into this repo. Imported by app.js; its top-level await holds the app
// until the lines are in (instant from the cache, a few seconds the first time). A study that
// isn't ready in time is skipped; its download carries on and is used from the next start.
import { FAMILIES, OPENINGS } from './openings.js';
import { STUDY } from './study.js';
import { parseStudyPgn, studyToRepertoire } from './lichess.js';

export const STUDIES = [
  {
    id: '8Uztu7Xx', side: 'b', label: 'Caro-Kann study', topic: 'carokann',
    level: (group) => (group === 'Guides' ? 1 : /Middlegame|Instructive/.test(group) ? 3 : 2),
  },
];

const VERSION = 2;              // bump when lichess.js output changes, so caches rebuild
const REFRESH_DAYS = 3;         // re-download in the background after this long
const FIRST_WAIT_MS = 15000;    // how long the app waits for a study it has never cached
const RETRY_WAIT_MS = 3000;     // ...if the last try failed within the hour (offline, captive portal)
const CACHE = 'lichess-studies';
const FAIL_KEY = 'chess-coach-study-fail';

const cacheKey = (id) => `https://cache.local/lichess-study/${id}/v${VERSION}.json`;
const usable = (rep) => Array.isArray(rep?.families) && Array.isArray(rep?.lines) && rep.lines.length > 0 && rep.study && typeof rep.study === 'object';

async function cacheGet(id) {
  try {
    const c = await caches.open(CACHE);
    const r = await c.match(cacheKey(id));
    const hit = r ? await r.json() : null;
    return hit && usable(hit.rep) ? hit : null;
  } catch { return null; }   // no Cache API (plain http) or a private window
}

async function cachePut(id, value) {
  try {
    const c = await caches.open(CACHE);
    await c.put(cacheKey(id), new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* the next start just downloads again */ }
}

function failedRecently() {
  try { return Date.now() - Number(localStorage.getItem(FAIL_KEY) || 0) < 36e5; } catch { return false; }
}
function markFailed(failed) {
  try { failed ? localStorage.setItem(FAIL_KEY, String(Date.now())) : localStorage.removeItem(FAIL_KEY); } catch { /* ignore */ }
}

async function download(cfg) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  try {
    const r = await fetch(`https://lichess.org/api/study/${cfg.id}.pgn?comments=true&variations=true&clocks=false`, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rep = studyToRepertoire(cfg, parseStudyPgn(await r.text()));
    if (!usable(rep)) throw new Error('no lines in the study');   // never cache an empty or cut-off download
    await cachePut(cfg.id, { at: Date.now(), rep });
    markFailed(false);
    return rep;
  } catch (e) { markFailed(true); throw e; } finally { clearTimeout(timer); }
}

async function load(cfg) {
  const hit = await cacheGet(cfg.id);
  if (hit) {
    if (Date.now() - hit.at > REFRESH_DAYS * 864e5) download(cfg).catch(() => {});   // used from the next start
    return hit.rep;
  }
  const wait = failedRecently() ? RETRY_WAIT_MS : FIRST_WAIT_MS;
  const dl = download(cfg);
  dl.catch(() => {});
  return Promise.race([dl, new Promise((_, no) => setTimeout(() => no(new Error(`not ready after ${wait / 1000}s`)), wait))]);
}

export const LOADED = [];   // { cfg, families, lines } for the studies that made it in

const results = await Promise.allSettled(STUDIES.map(load));
results.forEach((res, i) => {
  if (res.status !== 'fulfilled') { console.warn(`Lichess study ${STUDIES[i].id} not loaded:`, res.reason); return; }
  const { families, lines, study } = res.value;
  const knownLines = new Set(OPENINGS.map((o) => o.id)), knownFams = new Set(FAMILIES.map((f) => f.id));
  const fresh = lines.filter((o) => !knownLines.has(o.id));
  const ids = new Set(fresh.map((o) => o.id));
  const fams = families.filter((f) => !knownFams.has(f.id))
    .map((f) => ({ ...f, lines: f.lines.filter((id) => ids.has(id)) })).filter((f) => f.lines.length);
  const famIds = new Set(fams.map((f) => f.id));
  const kept = fresh.filter((o) => famIds.has(o.family));
  FAMILIES.push(...fams);
  OPENINGS.push(...kept);
  for (const o of kept) STUDY[o.id] = study[o.id];
  LOADED.push({ cfg: STUDIES[i], families: fams, lines: kept });
});
