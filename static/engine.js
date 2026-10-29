// Stockfish in the browser: a WASM web worker (Stockfish 19 "lite", single-threaded,
// so it runs on plain static hosting like GitHub Pages — no special headers needed).
// search() returns the same shape as server.py's /api/analyse and /api/move:
//   { bestmove, lines: [{ multipv, depth, cp | mate, pv: [uci...] }] }  — scores from White's view.

const ENGINE_URL = new URL('./vendor/stockfish/stockfish-19-lite-single.js', import.meta.url);

class BrowserEngine {
  constructor(options = {}) {
    this.name = 'Stockfish 19 (browser)';
    this.eloMin = 1320;
    this.eloMax = 3190;
    this.options = options;
    this.queue = Promise.resolve();  // one search at a time per worker
    this._start();
  }

  // (Re)create the worker. Called at startup and after a crash or a stalled search,
  // like server.py restarting a dead Stockfish process.
  _start() {
    if (this.worker) this.worker.terminate();
    this.waiters = [];               // [{ prefix, lines, resolve, reject }]
    this.failed = null;
    this.worker = new Worker(ENGINE_URL);
    this.worker.onmessage = (e) => {
      for (const line of String(e.data).split('\n')) if (line.trim()) this._line(line.trim());
    };
    this.worker.onerror = (e) => this._fail(new Error(`Stockfish worker failed: ${e.message || 'could not load'}`));
    this.ready = this._init(this.options);
    this.ready.catch(() => {});
  }

  _fail(err) {
    for (const w of this.waiters.splice(0)) w.reject(err);
    this.failed = err;
  }

  _line(line) {
    for (const w of [...this.waiters]) {
      w.lines.push(line);
      if (line.startsWith(w.prefix)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(w.lines);
      }
    }
  }

  _until(prefix) {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => this.waiters.push({ prefix, lines: [], resolve, reject }));
  }

  _send(cmd) { this.worker.postMessage(cmd); }

  async _isready() {
    const p = this._until('readyok');
    this._send('isready');
    await p;
  }

  async _init(options) {
    const p = this._until('uciok');
    this._send('uci');
    for (const line of await p) {
      if (line.startsWith('id name ')) this.name = `${line.slice(8).trim()} (browser)`;
      const m = line.match(/option name UCI_Elo type spin default \d+ min (\d+) max (\d+)/);
      if (m) { this.eloMin = +m[1]; this.eloMax = +m[2]; }
    }
    for (const [k, v] of Object.entries(options)) this._send(`setoption name ${k} value ${v}`);
    await this._isready();
  }

  search(fen, movetime = 800, multipv = 1, options = {}) {
    const run = async () => {
      if (this.failed) this._start();
      const timer = setTimeout(() => this._fail(new Error('Stockfish stopped responding')), movetime + 8000);
      try { return await this._search(fen, movetime, multipv, options); }
      catch (e) { this._start(); throw e; }   // fresh worker for the next request
      finally { clearTimeout(timer); }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async _search(fen, movetime, multipv, options) {
    {
      await this.ready;
      for (const [k, v] of Object.entries(options)) this._send(`setoption name ${k} value ${v}`);
      this._send(`setoption name MultiPV value ${multipv}`);
      await this._isready();
      const p = this._until('bestmove');
      this._send(`position fen ${fen}`);
      this._send(`go movetime ${movetime}`);
      return parseSearch(fen, await p);
    }
  }
}

function parseSearch(fen, output) {
  const whiteToMove = fen.split(' ')[1] === 'w';
  const lines = {};
  for (const line of output) {
    if (!line.startsWith('info ') || !line.includes(' pv ') || !line.includes(' score ')) continue;
    if (line.includes('lowerbound') || line.includes('upperbound')) continue;
    const tok = line.split(/\s+/);
    const info = { multipv: 1 };
    for (let i = 1; i < tok.length; i++) {
      const t = tok[i];
      if (t === 'depth') info.depth = +tok[++i];
      else if (t === 'multipv') info.multipv = +tok[++i];
      else if (t === 'score') {
        const kind = tok[i + 1];
        let val = +tok[i + 2];
        if (!whiteToMove) val = -val;          // engine scores are side-to-move; flip to White's view
        info[kind === 'cp' ? 'cp' : 'mate'] = val;
        i += 2;
      } else if (t === 'pv') { info.pv = tok.slice(i + 1); break; }
    }
    lines[info.multipv] = info;                // later lines are deeper, so overwrite
  }
  const best = output[output.length - 1].split(/\s+/);
  const bestmove = best[1] && best[1] !== '(none)' ? best[1] : null;
  return { bestmove, lines: Object.keys(lines).sort((a, b) => a - b).map((k) => lines[k]) };
}

// Two workers, each started on first use: a full-strength analyser and an
// Elo-limited sparring partner (only needed once you play a game).
let analyser = null, opponent = null;
const getAnalyser = () => (analyser ||= new BrowserEngine({ Hash: 32 }));
const getOpponent = () => (opponent ||= new BrowserEngine({ Hash: 16 }));

// Same check as server.py: never hand the engine a malformed position.
const FEN_RE = /^[pnbrqkPNBRQK1-8/]+ [wb] (-|[KQkq]+) (-|[a-h][36]) \d+ \d+$/;
function checkFen(fen) {
  if (!FEN_RE.test(String(fen))) throw new Error('bad FEN');
}

export async function browserStatus() {
  const a = getAnalyser();
  await a.ready;
  return { engine: a.name, eloMin: a.eloMin, eloMax: a.eloMax };
}

export async function browserAnalyse(fen, movetime = 800, multipv = 3) {
  checkFen(fen);
  return getAnalyser().search(fen, movetime, Math.max(1, Math.min(5, multipv)));
}

export async function browserMove(fen, elo, movetime = 600) {
  checkFen(fen);
  const o = getOpponent();
  await o.ready;                    // Elo range comes from the engine's uci reply
  const opts = elo >= o.eloMax
    ? { UCI_LimitStrength: 'false' }
    : { UCI_LimitStrength: 'true', UCI_Elo: Math.max(o.eloMin, elo) };
  return o.search(fen, movetime, 1, opts);
}
