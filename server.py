"""Chess Coach local server.

Serves the web app from static/, runs Stockfish over UCI for analysis and as the
sparring opponent, and forwards "Ask the coach" questions to Claude (if credentials
are set) or the local Qwen server (tools/llm/start-qwen.cmd).

Also keeps your progress (XP, streak, opening reviews, puzzle rating, games) in
data/profile.json and proxies puzzles from the Lichess puzzle API.

Run:  py server.py        opens the app in its own window once the server is up
      py server.py --no-browser
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Started with pyw (no console): send prints and request logs to server.log.
HEADLESS = sys.stdout is None
if HEADLESS:
    _log = ROOT / "server.log"
    if _log.exists() and _log.stat().st_size > 1_000_000:
        _log.unlink()
    sys.stdout = sys.stderr = open(_log, "a", encoding="utf-8", buffering=1)
STATIC = ROOT / "static"
DATA = Path(os.environ.get("CHESS_DATA_DIR") or ROOT / "data")
PROFILE = DATA / "profile.json"
PROFILE_MAX = 2_000_000   # bytes; a year of heavy use is well under this
PUZZLE_DIFFICULTY = {"easiest", "easier", "normal", "harder", "hardest"}
PUZZLE_ANGLE = re.compile(r"^[A-Za-z0-9]{1,40}$")
IDLE_SHUTDOWN = 600   # seconds without a ping from any app window before an app-mode server exits
ENGINE_PATH = os.environ.get("STOCKFISH_PATH") or str(
    ROOT / "engine" / "stockfish" / "stockfish-windows-x86-64-universal.exe"
)
PORT = int(os.environ.get("CHESS_PORT", "8765"))
LOCAL_LLM_URL = os.environ.get("LOCAL_LLM_URL", "http://127.0.0.1:8080/v1")
CLAUDE_MODEL = os.environ.get("CHESS_CLAUDE_MODEL", "claude-opus-5-5")

FEN_RE = re.compile(r"^[pnbrqkPNBRQK1-8/]+ [wb] (-|[KQkq]+) (-|[a-h][36]) \d+ \d+$")

# The coach's instructions live in static/coaches.json (shared with the hosted version's
# backend.js): a base prompt plus optional styles. A style with "lessons": "<slug>" also gets
# that grandmaster's distilled lesson notes from static/lessons/<slug>.json.
SLUG_RE = re.compile(r"^[a-z0-9-]{1,40}$")


def coach_system(style):
    coaches = json.loads((STATIC / "coaches.json").read_text(encoding="utf-8"))
    st = coaches["styles"].get(style) or coaches["styles"]["standard"]
    parts = [coaches["base"]]
    if st.get("prompt"):
        parts.append(st["prompt"])
    if SLUG_RE.match(str(st.get("lessons", ""))):
        parts.append(lesson_notes(st["lessons"]))
    return "\n\n".join(parts)


def lesson_notes(slug):
    """A GM's lesson library as plain text for the system prompt (titles + text, no links)."""
    data = json.loads((STATIC / "lessons" / f"{slug}.json").read_text(encoding="utf-8"))
    out = [f"LESSON NOTES (paraphrased from {data['short']}'s videos)"]
    for theme in data.get("themes", []):
        out.append(f"## {theme['name']}")
        out += [f"- {l['title']}: {l['text']}" for l in theme.get("lessons", [])]
    return "\n".join(out)


# ---------------------------------------------------------------- Stockfish ---

class Engine:
    """One long-lived Stockfish process; calls are serialised with a lock."""

    def __init__(self, path, options):
        self.path, self.options = path, options
        self.lock = threading.Lock()
        self._start()

    def _start(self):
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        self.proc = subprocess.Popen(
            [self.path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, bufsize=1, creationflags=flags,
        )
        self.name = "Stockfish"
        self.elo_min, self.elo_max = 1320, 3190
        options = self.options
        self._send("uci")
        for line in self._read_until("uciok"):
            if line.startswith("id name "):
                self.name = line[8:].strip()
            m = re.match(r"option name UCI_Elo type spin default \d+ min (\d+) max (\d+)", line)
            if m:
                self.elo_min, self.elo_max = int(m.group(1)), int(m.group(2))
        for key, value in options.items():
            self._send(f"setoption name {key} value {value}")
        self._ready()

    def _send(self, cmd):
        self.proc.stdin.write(cmd + "\n")
        self.proc.stdin.flush()

    def _read_until(self, prefix):
        lines = []
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError("Stockfish exited unexpectedly")
            line = line.strip()
            lines.append(line)
            if line.startswith(prefix):
                return lines

    def _ready(self):
        self._send("isready")
        self._read_until("readyok")

    def search(self, fen, movetime=800, multipv=1, options=None):
        """Return {bestmove, lines:[{multipv, depth, cp|mate, pv}]}; scores are White-POV."""
        with self.lock:
            try:
                for key, value in (options or {}).items():
                    self._send(f"setoption name {key} value {value}")
                self._send(f"setoption name MultiPV value {multipv}")
                self._ready()
                self._send(f"position fen {fen}")
                self._send(f"go movetime {movetime}")
                output = self._read_until("bestmove")
            except (RuntimeError, OSError, ValueError):
                # Stockfish died (e.g. on an impossible position): start a fresh one for the next call
                try:
                    self.proc.kill()
                except OSError:
                    pass
                self._start()
                raise RuntimeError("Stockfish crashed on that position and was restarted")

        white_to_move = fen.split()[1] == "w"
        lines = {}
        for line in output:
            if not line.startswith("info ") or " pv " not in line or " score " not in line:
                continue
            if "lowerbound" in line or "upperbound" in line:
                continue
            tok = line.split()
            info = {"multipv": 1}
            i = 1
            while i < len(tok):
                t = tok[i]
                if t == "depth":
                    info["depth"] = int(tok[i + 1]); i += 2
                elif t == "multipv":
                    info["multipv"] = int(tok[i + 1]); i += 2
                elif t == "score":
                    kind, val = tok[i + 1], int(tok[i + 2])
                    if not white_to_move:
                        val = -val
                    info["cp" if kind == "cp" else "mate"] = val
                    i += 3
                elif t == "pv":
                    info["pv"] = tok[i + 1:]
                    break
                else:
                    i += 1
            lines[info["multipv"]] = info  # later lines are deeper, so overwrite

        best = output[-1].split()
        bestmove = best[1] if len(best) > 1 and best[1] != "(none)" else None
        return {"bestmove": bestmove, "lines": [lines[k] for k in sorted(lines)]}


ANALYSER = None   # full strength, multi-threaded
OPPONENT = None   # strength-limited sparring partner


def start_engines():
    global ANALYSER, OPPONENT
    if not Path(ENGINE_PATH).exists():
        sys.exit(f"Stockfish not found at {ENGINE_PATH}. Set STOCKFISH_PATH or re-download (see README).")
    threads = max(1, min(8, (os.cpu_count() or 2) // 2))
    ANALYSER = Engine(ENGINE_PATH, {"Threads": threads, "Hash": 256})
    OPPONENT = Engine(ENGINE_PATH, {"Threads": 1, "Hash": 64})


# --------------------------------------------------------------------- LLMs ---

def claude_available():
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        return False
    try:
        import anthropic  # noqa: F401
        return True
    except ImportError:
        return False


def local_available():
    try:
        with urllib.request.urlopen(LOCAL_LLM_URL + "/models", timeout=1.5) as r:
            return r.status == 200
    except Exception:
        return False


def ask_claude(messages, system):
    import anthropic
    client = anthropic.Anthropic()
    resp = client.beta.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=4000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "low"},
        system=system,
        messages=messages,
    )
    if resp.stop_reason == "refusal":
        return "The model declined to answer that one. Try rephrasing the question."
    return "".join(b.text for b in resp.content if b.type == "text").strip()


def ask_local(messages, system):
    body = json.dumps({
        "model": "local",
        "messages": [{"role": "system", "content": system}] + messages,
        "max_tokens": 900,
        "temperature": 0.5,
    }).encode()
    req = urllib.request.Request(
        LOCAL_LLM_URL + "/chat/completions", data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.load(r)
    text = data["choices"][0]["message"].get("content") or ""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()


def build_messages(history, question, context):
    """History is [{role, content}] from the browser; keep it alternating and short."""
    msgs = []
    for turn in history[-10:]:
        role, content = turn.get("role"), str(turn.get("content", ""))[:4000]
        if role not in ("user", "assistant") or not content:
            continue
        if msgs and msgs[-1]["role"] == role:
            msgs[-1]["content"] += "\n\n" + content
        else:
            msgs.append({"role": role, "content": content})
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    user = f"POSITION CONTEXT\n{context[:6000]}\n\nQUESTION\n{question[:2000]}"
    if msgs and msgs[-1]["role"] == "user":
        msgs[-1]["content"] += "\n\n" + user
    else:
        msgs.append({"role": "user", "content": user})
    return msgs


# --------------------------------------------------------- profile + puzzles ---

PROFILE_LOCK = threading.Lock()


def read_profile():
    try:
        return json.loads(PROFILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def write_profile(profile):
    """Atomic write: a crash mid-save can't leave a half-written file."""
    DATA.mkdir(exist_ok=True)
    tmp = PROFILE.with_suffix(".tmp")
    with PROFILE_LOCK:
        tmp.write_text(json.dumps(profile, separators=(",", ":")), encoding="utf-8")
        os.replace(tmp, PROFILE)


def fetch_puzzle(difficulty, angle):
    """One puzzle from Lichess. Anonymous calls are fine for personal use."""
    q = {"difficulty": difficulty if difficulty in PUZZLE_DIFFICULTY else "normal"}
    if angle and angle != "mix" and PUZZLE_ANGLE.match(angle):
        q["angle"] = angle
    req = urllib.request.Request(
        "https://lichess.org/api/puzzle/next?" + urllib.parse.urlencode(q),
        headers={"Accept": "application/json", "User-Agent": "chess-coach-local/1.0"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.load(r)
    p, g = data["puzzle"], data["game"]
    return {"id": str(p["id"])[:20], "rating": int(p["rating"]), "themes": [str(t)[:40] for t in p.get("themes", [])],
            "solution": [str(m)[:5] for m in p["solution"]], "initialPly": int(p["initialPly"]), "pgn": str(g["pgn"])}


# ------------------------------------------------------------------- HTTP ---

LAST_PING = time.monotonic()


class Server(ThreadingHTTPServer):
    """Refuses to share the port: on Windows SO_REUSEADDR would let a second copy bind it too."""
    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def log_message(self, fmt, *args):
        if args and "/api/" in str(args[0]):
            return
        super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, code, payload):
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/status":
            return self._json(200, {
                "engine": ANALYSER.name,
                "eloMin": OPPONENT.elo_min,
                "eloMax": OPPONENT.elo_max,
                "claude": claude_available(),
                "claudeModel": CLAUDE_MODEL,
                "local": local_available(),
            })
        if self.path == "/api/ping":
            global LAST_PING
            LAST_PING = time.monotonic()
            return self._json(200, {"ok": True})
        if self.path == "/api/profile":
            return self._json(200, read_profile())
        if self.path.startswith("/api/puzzle"):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                return self._json(200, fetch_puzzle(q.get("difficulty", ["normal"])[0], q.get("angle", ["mix"])[0]))
            except Exception as e:
                return self._json(502, {"error": f"Lichess puzzles unreachable ({type(e).__name__})"})
        return super().do_GET()

    def do_POST(self):
        origin = self.headers.get("Origin")
        if origin and origin not in (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"):
            return self._json(403, {"error": "cross-origin request refused"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length < 0 or length > PROFILE_MAX:
                return self._json(413, {"error": "request too large"})
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "bad JSON"})

        try:
            if self.path == "/api/profile":
                if not isinstance(body, dict) or body.get("v") != 1:
                    return self._json(400, {"error": "bad profile"})
                write_profile(body)
                return self._json(200, {"ok": True})

            if self.path == "/api/analyse":
                fen = str(body.get("fen", ""))
                if not FEN_RE.match(fen):
                    return self._json(400, {"error": "bad FEN"})
                movetime = max(50, min(10000, int(body.get("movetime", 800))))
                multipv = max(1, min(5, int(body.get("multipv", 3))))
                return self._json(200, ANALYSER.search(fen, movetime, multipv))

            if self.path == "/api/move":
                fen = str(body.get("fen", ""))
                if not FEN_RE.match(fen):
                    return self._json(400, {"error": "bad FEN"})
                elo = int(body.get("elo", 1500))
                if elo >= OPPONENT.elo_max:
                    opts = {"UCI_LimitStrength": "false"}
                else:
                    opts = {"UCI_LimitStrength": "true",
                            "UCI_Elo": max(OPPONENT.elo_min, elo)}
                movetime = max(100, min(5000, int(body.get("movetime", 600))))
                return self._json(200, OPPONENT.search(fen, movetime, 1, opts))

            if self.path == "/api/ask":
                question = str(body.get("question", "")).strip()
                if not question:
                    return self._json(400, {"error": "empty question"})
                msgs = build_messages(body.get("history") or [], question, str(body.get("context", "")))
                system = coach_system(str(body.get("style", "standard")))
                provider = body.get("provider", "auto")
                if provider == "auto":
                    provider = "claude" if claude_available() else "local"
                if provider == "claude":
                    if not claude_available():
                        return self._json(503, {"error": "Claude is not set up: pip install anthropic and set ANTHROPIC_API_KEY, then restart."})
                    answer = ask_claude(msgs, system)
                    label = CLAUDE_MODEL
                else:
                    try:
                        answer = ask_local(msgs, system)
                    except urllib.error.HTTPError as e:
                        return self._json(502, {"error": f"Local model returned HTTP {e.code}. Check the llama.cpp window."})
                    except urllib.error.URLError:
                        return self._json(503, {"error": "Local model is not running. Start it with C:\\Artificial\\tools\\llm\\start-qwen.cmd"})
                    label = "local Qwen"
                return self._json(200, {"answer": answer, "provider": label})
        except Exception as e:  # surface engine/LLM failures to the UI instead of a dead socket
            return self._json(500, {"error": f"{type(e).__name__}: {e}"})

        return self._json(404, {"error": "not found"})


def open_app_window(url):
    """Edge/Chrome --app gives a standalone window (no tabs, no address bar)."""
    candidates = [
        shutil.which("msedge"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        shutil.which("chrome"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
    ]
    for exe in candidates:
        if exe and Path(exe).exists():
            subprocess.Popen([exe, f"--app={url}", "--start-maximized"])
            return
    webbrowser.open(url)


def fail(msg):
    """Without a console nobody would see the error, so show a message box too."""
    print(msg)
    if HEADLESS and sys.platform == "win32":
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, msg, "Chess Coach", 0x10)
    sys.exit(1)


def idle_watchdog():
    """App windows ping every 30 s; once none has for IDLE_SHUTDOWN seconds, stop server + engines."""
    while True:
        time.sleep(30)
        if time.monotonic() - LAST_PING > IDLE_SHUTDOWN:
            print("No app window for a while; shutting down.")
            for eng in (ANALYSER, OPPONENT):
                try:
                    eng.proc.kill()
                except Exception:
                    pass
            os._exit(0)


def main():
    url = f"http://127.0.0.1:{PORT}"
    browser = "--no-browser" not in sys.argv
    try:
        server = Server(("127.0.0.1", PORT), Handler)
    except OSError:   # already running: just bring up a window on the existing server
        print(f"Chess Coach is already running on {url}")
        if browser:
            open_app_window(url)
        return
    try:
        start_engines()
    except SystemExit as e:
        fail(str(e))
    except Exception as e:
        fail(f"Stockfish failed to start: {e}")
    print(f"{ANALYSER.name} ready. Claude: {'yes' if claude_available() else 'no'}  Local LLM: {'yes' if local_available() else 'no'}")
    print(f"Chess Coach on {url}")
    if browser:
        open_app_window(url)   # only now: the server is bound and the engines are up
        threading.Thread(target=idle_watchdog, daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
