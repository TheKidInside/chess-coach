# How Chess Coach Works

A walkthrough of the code, written so you can learn from it and change it.

## The big picture

Think of it as a chess club with four staff members:

| Role | Who | Where |
|---|---|---|
| The **referee**: knows the rules, keeps the scoresheet | chess.js | browser (`static/vendor/chess.js`) |
| The **grandmaster**: calculates, never explains | Stockfish 19 | `engine/` run by `server.py` |
| The **teacher**: explains in words | Claude or local Qwen | called by `server.py` |
| The **trainer**: keeps your logbook, decides what you review today | `profile.js` | browser, saved by `server.py` to `data/profile.json` |

The browser (`static/app.js`) is the club manager. It shows the board, asks the referee whether a move is legal, asks the grandmaster how good it was, and when you ask a question it hands the teacher the grandmaster's notes so the teacher does not have to guess. Everything you finish (a drilled line, a solved puzzle, a game) goes to the trainer, who pays you XP and schedules what comes back.

```
browser (app.js + chess.js + profile.js)
   │  POST /api/analyse  {fen}               → Stockfish (full strength) → top lines + evals
   │  POST /api/move     {fen, elo}          → Stockfish (Elo-limited)   → its move
   │  POST /api/ask      {question, context} → Claude or Qwen            → answer text
   │  GET  /api/puzzle   ?difficulty&angle   → lichess.org puzzle API    → one puzzle
   │  GET/POST /api/profile                  → data/profile.json         → your progress
   ▼
server.py  (Python standard library only; the anthropic SDK is optional)
```

## Files

| File | Job |
|---|---|
| `server.py` | HTTP server, Stockfish wrapper (`Engine`), AI bridge, profile storage, Lichess puzzle proxy, opens the app window |
| `start-chess.cmd` | Starts `server.py` in a minimised console; the server opens the app once it is ready |
| `static/index.html` | Layout: header (tabs + XP/streak HUD), board column, side column (feedback banner, tab panel, moves, coach) |
| `static/style.css` | Look. Colour tokens at the top; light/dark via `prefers-color-scheme` or the theme button (`data-theme`) |
| `static/app.js` | All behaviour: board, the five tabs, coach verdicts, puzzles, chat |
| `static/profile.js` | XP + levels, daily goal + streak, spaced repetition, puzzle rating, game log, saving |
| `static/progress.js` | The Progress tab: level card, stat tiles, activity heatmap, rating chart, games table |
| `static/sound.js` | Move/capture/check/reward sounds, synthesised with Web Audio (no audio files) |
| `static/openings.js` | The training repertoire: 28 lines (12 White, 16 Black) with a note for every move and a difficulty `level` |
| `static/eco.json` | Opening-name lookup: ~3,900 positions → ECO code + name (built by `tools/build_eco.mjs`, Lichess, CC0) |
| `static/fonts/` | Bricolage Grotesque (headings, numbers), IBM Plex Sans (text), IBM Plex Mono (notation). SIL OFL, self-hosted so it works offline |

## server.py

### Talking to Stockfish (UCI)

Stockfish is a command-line program that speaks UCI, a plain-text protocol. `Engine` keeps one process alive and writes commands to its stdin:

```
setoption name MultiPV value 3     # give me the 3 best moves
isready → readyok                  # wait until options are applied
position fen <fen>
go movetime 800                    # think for 0.8 s
info depth 18 multipv 1 score cp 27 pv e7e5 g1f3 ...
bestmove e7e5
```

`Engine.search()` reads lines until `bestmove`, keeps the deepest `info` line for each `multipv`, and skips `lowerbound`/`upperbound` lines (those are provisional). **Stockfish reports scores from the side-to-move's point of view**; the server flips them so every score the browser sees is from White's view (+ = White better). `cp` is centipawns (100 = one pawn); `mate` is moves to mate.

Two engines run side by side:
- `ANALYSER`: full strength, several threads. Judges moves and powers the Analyze tab.
- `OPPONENT`: one thread, `UCI_LimitStrength` + `UCI_Elo` (1320–3190). Your sparring partner. At the slider's maximum the limit is switched off.

Each engine has a lock, because the HTTP server is threaded and a UCI process can only think about one position at a time.

### The AI bridge

`build_messages()` cleans the chat history (alternating user/assistant, last 10 turns) and appends the new question with the POSITION CONTEXT block. `COACH_SYSTEM` tells the model that Stockfish is the source of truth, to explain plans in human terms, and to avoid illegal moves.

- **Claude**: used when `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) is set and the `anthropic` package is installed. Model `claude-opus-5-5`, effort `low`, with server-side refusal fallback enabled.
- **Local Qwen**: llama.cpp's OpenAI-compatible endpoint at `127.0.0.1:8080/v1/chat/completions`. Free, private, weaker; the engine lines in the context are what keep it honest.

### Profile and puzzles

- `/api/profile`: GET returns `data/profile.json` (or `{}`); POST replaces it. Writes go to a `.tmp` file first and are swapped in with `os.replace`, so a crash mid-save can't corrupt it. Bodies over 2 MB are refused. Set `CHESS_DATA_DIR` to keep a separate profile (handy for testing).
- `/api/puzzle`: forwards to `https://lichess.org/api/puzzle/next` with a whitelisted `difficulty` and a theme (`angle`), and returns only what the app needs: id, rating, themes, solution (UCI moves), and the game PGN that leads to the puzzle.

### Startup

`main()` binds the port **first**, exclusively (`SO_EXCLUSIVEADDRUSE`; plain Windows sockets would let a second copy share the port). If the port is taken, Chess Coach is already running, so it just opens a window on it and exits. Otherwise it starts both engines and only then opens Edge (or Chrome) maximised with `--app=`, a standalone window with no tabs or address bar. `--no-browser` skips that.

`start-chess.cmd` runs the server with `pyw` (no console). Output goes to `server.log`, and a startup failure such as a missing Stockfish shows a message box. Each app window pings `/api/ping` every 30 s; when started with a window, the server shuts itself and both Stockfish processes down 10 minutes after the last ping (the slack covers Edge throttling timers in minimised windows). If Stockfish crashes mid-search, `Engine.search()` restarts it and the next request works.

## profile.js — the trainer

One object `P.data`, saved 400 ms after the last change (debounced) to the server, with a `localStorage` copy as a fallback. Each save stamps `savedAt`; on load the newer of the two copies wins, and a pending save is flushed with `keepalive` when the window closes, so closing right after a puzzle doesn't lose it.

- **XP and levels.** `addXp(amount, reason)` is the only way XP enters. Level *L* starts at `25·(L−1)·L` XP (0, 50, 150, 300, 500…), so each level takes a bit longer than the last.
- **Daily goal and streak.** XP is also logged per day (`days['2026-10-29']`). The first time today's XP is at or over the goal (`checkGoal()`, also run when you change the goal), the streak extends: +1 if the last goal day was yesterday, otherwise it restarts at 1. `streakNow()` shows 0 once a full day has been missed. Like a gym punch card: one stamp per day, and missing a day resets the card.
- **Spaced repetition (Leitner boxes).** Every opening line you have practised, and every mistake from your games, sits in a box 0–5. A clean drill moves it up one box; a miss drops it two. The box sets the next review date: `INTERVALS = [0, 1, 3, 7, 14, 30]` days. Box 4+ counts as mastered. Strong memories come back rarely, shaky ones come back tomorrow, so review time goes where you're weakest. Only a drill on a **due** line (or the very first clean drill after Learn) moves it up; drilling early is practice and can't fast-track a line to mastered. A slip always counts.
- **Puzzle rating.** Plain Elo against the puzzle's Lichess rating: `expected = 1 / (1 + 10^((puzzle − you)/400))`, change = `K · (result − expected)`, K = 40 for your first 30 puzzles, then 20. `puzzleDifficulty()` maps your rating to Lichess's `easiest … hardest` buckets so puzzles stay near your level.
- **Game accuracy.** Lichess's per-move curve, `103.17·e^(−0.04354·loss) − 3.17`, where `loss` is the winning-chances drop from `judge()`. The game score is the average over your moves.
- **Migration.** The first version kept `{id: {runs, clean}}` under `localStorage['chess-coach-progress']`; on first load those lines are converted into boxes and the old key is removed.

XP is paid for **finishing** things, and repeats pay less, so grinding one action is not worth it:

| Action | XP |
|---|---|
| Learn a new line (first time only) | 10 |
| First clean drill of a line | 20 |
| Clean drill of a **due** line | 35 |
| Clean drill of a line that isn't due (practice) | 5, once per line per day |
| Drill with slips | 0 |
| Puzzle solved first try | 12, +2 per puzzle in your current run (max +12) |
| Puzzle finished after a miss | 3 |
| Mistake fixed first try (no hint) | 15 |
| Game finished (10+ of your moves, not resigned) | 15 + 25 win / 10 draw + accuracy ÷ 10, halved if you used take-backs |

## app.js

### State

Everything lives in one object `S`: the current `game` (a chess.js instance), the tab, board orientation, the opening being trained, arrows, move tags (`?!`, `?`, `??`), the puzzle in progress (`S.pz`), plus these guards:

- `S.epoch`: a counter bumped on every reset (new game, tab switch, take back, new puzzle). Each async call remembers the epoch it started in and throws its result away if the epoch moved on. That stops a slow engine reply from landing on a board you already reset.
- `S.busy` / `S.paused`: lock the board while the engine or scripted opponent is moving, or while the coach waits for you to decide what to do about a mistake.
- `S.viewPly`: `null` means you see the live position. A number means you are looking back at an earlier move (arrow keys, the ⏮ ◀ ▶ ⏭ buttons, or clicking a move). `viewGame()` builds that position from a copy, so browsing never touches the real game, and the board is locked until you return to live.
- `S.saved`: when you leave Play or Puzzles, the game is parked there and the other tab gets a copy. Coming back resumes it. A puzzle step that was mid-flight (the opponent's reply, or taking back a wrong move) is recorded in `S.pz.pending` and finished by `settlePuzzle()` on return, so the board can't get stuck on the wrong side to move.
- Play verdicts are written to the game they were judged for (checked against that move's FEN), not "whatever is on the board now", so a tab switch or take-back can't drop or misplace a mistake.

### The board

`render()` rebuilds 64 `div.sq` elements from the displayed position, adds highlight classes (last move, selection, check, legal-move dots, hint pulse, green/red flash) and piece `<img>`s. Arrows are an SVG overlay with an 8×8 viewBox, so a square centre is just `(col + 0.5, row + 0.5)`.

Every move that isn't dragged by hand goes through `applyMove()`: it plays the move, sets `S.anim` so the next render slides the piece from its old square (Web Animations API, 190 ms), and plays the right sound (move, capture, check). Dragged moves skip the slide because your hand already moved the piece.

Input: `pointerdown` on one of your pieces selects it and starts a drag; dropping on a square (or clicking a second square) calls `tryMove()`, which asks chess.js for the legal moves and dispatches to the current tab's handler. Promotions auto-queen.

### Judging a move — `judge()`

1. Analyse the position **before** your move: the best you could have got.
2. Analyse the position **after** your move: what you actually have.
3. Convert both evaluations to **winning chances** with Lichess's formula `50 + 50·(2/(1+e^(−0.00368·cp)) − 1)` and take the drop from your side's view.
4. Drop ≥ 30 → blunder, ≥ 20 → mistake, ≥ 10 → inaccuracy; matching Stockfish's move → best.

Why win% instead of raw centipawns: losing 2 pawns when you are already 9 pawns up changes nothing; losing 2 pawns in an equal position is a disaster. Win% captures that, centipawns do not.

The "before" analysis is prefetched as soon as it becomes your turn, so verdicts usually appear instantly. Results are cached per FEN.

### Naming the opening you're in

Two different opening lists exist, on purpose:
- `openings.js`: the **lessons**, a few lines with notes, used for training.
- `eco.json`: the **dictionary**, thousands of named positions, used to put a name on whatever you actually played.

The dictionary is keyed by **position**, not move order (the first four FEN fields). That handles transpositions: 1.Nf3 d5 2.d4 Nf6 3.c4 e6 4.Nc3 is correctly named "Queen's Gambit Declined: Three Knights Variation" even though it didn't start with 1.d4. `gameOpening()` walks the history, keeps the last position found, and reports where you left theory. The name shows above the board, book moves are greyed in the move list, and the name goes to the coach AI.

### Openings tab

The strip at the top is the hook: **"N lines due for review → Review now"** runs every due line in Drill mode back to back. The list shows each line's difficulty (or a **Due** flag) and five dots for its box. The current step is simply `game.history().length`, so there is no separate pointer to keep in sync.
- **Learn**: a green arrow shows your next book move; the opponent's book replies are played after a short pause; notes explain each move. Finishing a new line puts it in box 0, due tomorrow.
- **Drill**: no arrows. A wrong move is taken back, the book move is shown, and Stockfish says whether your move was actually bad or just a playable sideline. A clean run moves the line up a box.
- "Play on vs Stockfish" carries the position into the Play tab.

### Puzzles tab

`loadPuzzle()` fetches a Lichess puzzle (the next one is prefetched while you solve, so "Next" is instant), replays the game PGN, and rewinds one move so the opponent's last move can be animated in. The solution is a list of UCI moves: yours, theirs, yours… `onPuzzleMove()` accepts the expected move, or any move that gives checkmate. The **first** miss, hint or "Show solution" is what counts against your rating (`puzzleFailed()` runs once per puzzle); you can still finish it.

**My mistakes** is the same board fed from your own games: every mistake or blunder in Play is saved with the position and Stockfish's best move. To fix it you play the best move, or any move Stockfish rates within 8% winning chances of it. Skip rotates to the next due mistake. Under-promotions in puzzle answers are played with the right piece (`promotionFor()`); everywhere else promotions auto-queen.

### Play tab

Choose White, Black or Random and the opponent strength (remembered between sessions, like the coach switch) (named tiers: Casual, Club, Strong club, Expert, Master, full strength). Every one of your moves is judged, even with the coach off, so the game gets an accuracy score. With the coach **on**, a mistake or blunder pauses the game with Take back / Show better move / Ask the coach why / Play on. When the game ends (or you resign), `finishGame()` snapshots the game, waits for the last verdict, logs it (even if you've already moved on), pays XP and shows the summary: accuracy, inaccuracies, mistakes, XP, plus a button to fix those mistakes in the Puzzles tab. Restart and New game ask before abandoning a game in progress.

### Analyze tab

Keeps whatever position you were in and lets you move both sides. Shows Stockfish's top 3 lines in SAN (`pvToSan`) with arrows for the top two; clicking a line plays its first move. Paste a FEN or PGN to load a game; copy the current FEN or the PGN. Clicking a row in Progress → Recent games opens that game here.

### Ask the coach

`buildContext()` assembles: FEN, side to move, the mode (and the line being taught), the moves so far, the last coach verdict (flagged if you took it back), and fresh Stockfish top-3 lines. During an unsolved puzzle it leaves the engine lines out and tells the model not to reveal the answer. The suggestion chips change with the tab and situation. `mdToHtml()` escapes the answer before adding bold/bullets, so model output can't inject HTML.

### Keyboard

← → step through moves, Home/End jump to the start/live position, F flips the board, Esc clears a selection, Enter loads the next puzzle once one is done.

## The hosted version (GitHub Pages)

Live at https://thekidinside.github.io/chess-coach/ — repo `TheKidInside/chess-coach`. Every push to `main` runs `.github/workflows/pages.yml`, which publishes the `static/` folder as-is. There is no Python there, so the club loses its back office and the browser does the work itself.

The switch is one file, `static/backend.js`. Everything in `app.js` calls `api('/api/...')`; `backend.js` decides who answers:

| Request | Laptop (`server.py` on 127.0.0.1) | Hosted (GitHub Pages) |
|---|---|---|
| `/api/analyse`, `/api/move` | native Stockfish 19 | `engine.js`: Stockfish 19 **lite** as a WASM web worker |
| `/api/puzzle` | server proxies Lichess | browser calls `lichess.org/api/puzzle/next` directly (Lichess allows it) |
| `/api/ask` | Claude or local Qwen | local Qwen at `127.0.0.1:8080`, straight from the browser |
| `/api/profile` | `data/profile.json` | skipped — the localStorage copy is the only copy |
| `/api/status`, `/api/ping` | server | answered in the browser / no-op |

It only probes for `server.py` when the page itself is on `127.0.0.1`/`localhost`, so the live site never makes a pointless request.

**engine.js** wraps the worker in the same UCI conversation `server.py` has with the native binary (`uci` → `setoption` → `isready` → `position` → `go movetime` → `bestmove`) and parses the output into the identical `{bestmove, lines}` shape, scores flipped to White's view. Two workers, each started on first use: a full-strength analyser and an Elo-limited opponent. Searches are queued one at a time per worker; a crash or a search that never answers (movetime + 8 s) terminates the worker and starts a fresh one — the browser twin of the server restarting a dead process.

Why the *lite, single-threaded* build: the full engine is ~94 MB (slow to load, especially on a phone), and the multi-threaded builds need two security headers (COOP/COEP) that GitHub Pages can't send. Lite is ~1.8 MB and still far stronger than any human.

**Coach chat online** works only on a computer running `start-qwen.cmd`. Chrome treats a public site calling `127.0.0.1` as "local network access" and asks permission once — choose Allow. On a phone there is no Qwen, so the chat explains that instead.

## Changing things

- **Add an opening**: append an object to `OPENINGS` in `openings.js` (`moves` and `notes` must be the same length; set `level` 1-3). It lands in the right list group automatically. Validate the SAN by playing it through chess.js; an illegal move would break the drill.
- **Rewards**: the XP numbers live at the call sites of `addXp()` in `app.js`; the level curve is `levelStart()` and the review spacing is `INTERVALS` in `profile.js`. The default daily goal is set in `fresh()` and can be changed from the Progress tab.
- **Mistake thresholds**: the `30 / 20 / 10` numbers in `judge()`.
- **Engine thinking time**: `analyse(fen, movetime, multipv)` calls in `app.js`; opponent time in `engineReply()`.
- **Coach personality**: `COACH_SYSTEM` in `server.py`.
- **Colours**: the tokens at the top of `style.css` (light block, then the dark block twice: once for "system dark", once for the dark theme button).
