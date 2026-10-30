// One entry point for everything the app asks of "the server".
// - Laptop (start-chess.cmd): requests go to server.py — native Stockfish, Claude/Qwen, profile file.
// - Static hosting (GitHub Pages): there is no server, so the same requests are answered in the
//   browser: Stockfish runs as WASM (engine.js), puzzles come straight from Lichess, and the coach
//   chat talks to a local Qwen on this computer if one is running.
import { browserStatus, browserAnalyse, browserMove } from './engine.js';

const LOCAL_LLM = 'http://127.0.0.1:8080/v1';

// The coach's instructions are shared with server.py: coaches.json holds a base prompt and
// styles; a style with "lessons": "<slug>" also gets that GM's notes from lessons/<slug>.json.
const getJson = (f) => fetch(f).then((r) => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json(); });
async function coachSystem(style) {
  const coaches = await getJson('coaches.json');
  const st = coaches.styles[style] || coaches.styles.standard;
  const parts = [coaches.base];
  if (st.prompt) parts.push(st.prompt);
  if (/^[a-z0-9-]{1,40}$/.test(st.lessons || '')) {
    const lib = await getJson(`lessons/${st.lessons}.json`);
    parts.push([`LESSON NOTES (paraphrased from ${lib.short}'s videos)`, ...lib.themes.flatMap((t) =>
      [`## ${t.name}`, ...t.lessons.map((l) => `- ${l.title}: ${l.text}`)])].join('\n'));
  }
  return parts.join('\n\n');
}

async function serverApi(path, body) {
  const opts = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined;
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// Decided once: is server.py behind this page? It only ever runs on this computer,
// so skip the probe (and its console 404) on a real website.
const LOCALHOST = ['127.0.0.1', 'localhost'].includes(location.hostname);
const modeReady = (LOCALHOST ? fetch('/api/status') : Promise.reject(new Error('hosted')))
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => (j && j.engine ? 'server' : 'static'))
  .catch(() => 'static');

let mode = null;
modeReady.then((m) => { mode = m; });

/** Resolves to true when server.py is behind this page. */
export const hasServer = modeReady.then((m) => m === 'server');

/** True when running without server.py (e.g. GitHub Pages). Valid after the first api() call resolves. */
export const isStatic = () => mode === 'static';

export async function api(path, body) {
  if ((await modeReady) === 'server') return serverApi(path, body);
  const url = new URL(path, location.origin);
  switch (url.pathname) {
    case '/api/status': return staticStatus();
    case '/api/analyse': return browserAnalyse(body.fen, clamp(body.movetime ?? 800, 50, 10000), body.multipv ?? 3);
    case '/api/move': return browserMove(body.fen, +body.elo || 1500, clamp(body.movetime ?? 600, 100, 5000));
    case '/api/ask': return askLocal(body);
    case '/api/puzzle': return lichessPuzzle(url.searchParams.get('difficulty'), url.searchParams.get('angle'));
    case '/api/ping': return { ok: true };
    default: throw new Error(`${url.pathname} isn't available in the hosted version`);
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, +v));

async function localLlmUp() {
  try {
    const r = await fetch(`${LOCAL_LLM}/models`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

async function staticStatus() {
  const [st, local] = await Promise.all([browserStatus(), localLlmUp()]);
  return { ...st, claude: false, claudeModel: '', local, hosted: true };
}

function buildMessages(history, question, context) {
  const msgs = [];
  for (const turn of (history || []).slice(-10)) {
    const content = String(turn.content ?? '').slice(0, 4000);
    if (!['user', 'assistant'].includes(turn.role) || !content) continue;
    if (msgs.length && msgs[msgs.length - 1].role === turn.role) msgs[msgs.length - 1].content += '\n\n' + content;
    else msgs.push({ role: turn.role, content });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  const user = `POSITION CONTEXT\n${String(context ?? '').slice(0, 6000)}\n\nQUESTION\n${String(question).slice(0, 2000)}`;
  if (msgs.length && msgs[msgs.length - 1].role === 'user') msgs[msgs.length - 1].content += '\n\n' + user;
  else msgs.push({ role: 'user', content: user });
  return msgs;
}

async function askLocal({ question, history, context, style }) {
  const system = await coachSystem(style);
  let r;
  try {
    r = await fetch(`${LOCAL_LLM}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'local',
        messages: [{ role: 'system', content: system }, ...buildMessages(history, question, context)],
        max_tokens: 900,
        temperature: 0.5,
      }),
      signal: AbortSignal.timeout(180000),
    });
  } catch {
    throw new Error('The coach chat needs the local Qwen model running on this computer (tools\\llm\\start-qwen.cmd). It isn\'t available on a phone. If Chrome asked to allow local network access, choose Allow.');
  }
  if (!r.ok) throw new Error(`Local model returned HTTP ${r.status}.`);
  const data = await r.json();
  const text = data.choices?.[0]?.message?.content || '';
  return { answer: text.replace(/<think>[\s\S]*?<\/think>/g, '').trim(), provider: 'local Qwen' };
}

const DIFFICULTIES = new Set(['easiest', 'easier', 'normal', 'harder', 'hardest']);

async function lichessPuzzle(difficulty, angle) {
  const q = new URLSearchParams({ difficulty: DIFFICULTIES.has(difficulty) ? difficulty : 'normal' });
  if (angle && angle !== 'mix' && /^[A-Za-z0-9]{1,40}$/.test(angle)) q.set('angle', angle);
  let r;
  try {
    r = await fetch(`https://lichess.org/api/puzzle/next?${q}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('Lichess puzzles unreachable (are you offline?)');
  }
  if (!r.ok) throw new Error(`Lichess puzzles unreachable (HTTP ${r.status})`);
  const { puzzle: p, game: g } = await r.json();
  return {
    id: String(p.id).slice(0, 20), rating: +p.rating, themes: (p.themes || []).map((t) => String(t).slice(0, 40)),
    solution: p.solution.map((m) => String(m).slice(0, 5)), initialPly: +p.initialPly, pgn: String(g.pgn),
  };
}
