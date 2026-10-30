# Chess Coach

Chess trainer: learn openings and keep them with spaced-repetition reviews, solve rated Lichess puzzles, play Stockfish with a coach that catches your mistakes (and turns them into review puzzles), and ask an AI about any position. XP, levels, a daily goal and a day streak keep you coming back.

**Play online:** https://thekidinside.github.io/chess-coach/ (free, any device; see "Hosted version" below).

## Start (laptop, full strength)

1. (Optional, for the free local AI) run `C:\Artificial\tools\llm\start-qwen.cmd`
2. Double-click `start-chess.cmd`. The server starts in the background (no console) and opens the app in its own Edge window when it's ready. It stops itself about 10 minutes after you close the last app window. Log: `server.log`.
   - Already running? Double-clicking again just opens another window.
   - Manual: `py server.py` (or `py server.py --no-browser`, then open http://127.0.0.1:8765)

Your progress lives in `data/profile.json` (with a browser copy as backup). Puzzles need an internet connection (they come from lichess.org); everything else works offline.

## Hosted version (GitHub Pages)

Every push to `main` publishes `static/` to GitHub Pages (`.github/workflows/pages.yml`). With no server behind it, `static/backend.js` answers the app's requests in the browser:

- **Engine**: Stockfish 19 *lite*, single-threaded WASM (`static/vendor/stockfish/`, via `static/engine.js`). Weaker than the laptop's full engine but still far beyond any human, and it needs no special server headers.
- **Puzzles**: straight from the Lichess API.
- **Progress**: saved in that browser only (each device keeps its own).
- **Coach chat**: only on a computer running the local Qwen (`start-qwen.cmd`); Chrome may ask to allow local network access. Not available on a phone. Claude is never used online, so the hosted site costs nothing.

## Use Claude instead of the local model

1. `py -m pip install anthropic`
2. Set `ANTHROPIC_API_KEY` (User environment variable), then restart `start-chess.cmd`
3. The coach dropdown's "Auto" now uses Claude. Model: `claude-opus-5-5` (override with `CHESS_CLAUDE_MODEL`).

## What's inside

- **Engine (laptop)**: Stockfish 19 official Windows x86-64 build. Not in the repo (over GitHub's 100 MB limit): download `stockfish-windows-x86-64-universal.zip` from https://github.com/official-stockfish/Stockfish/releases and unzip it into `engine/stockfish/`, or set `STOCKFISH_PATH`.
- **Engine (browser)**: Stockfish.js 19 lite by Nathan Rugg (https://github.com/nmrugg/stockfish.js), GPLv3; source for Stockfish itself: https://github.com/official-stockfish/Stockfish.
- **Moves/rules**: chess.js 1.4.0 (`static/vendor/chess.js`).
- **Pieces**: cburnett set from Lichess, by Colin M.L. Burnett, CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/).
- **Puzzles**: Lichess puzzle API (`/api/puzzle/next`, anonymous), proxied by `server.py` on the laptop, called directly online.
- **Opening names**: Lichess chess-openings dataset (CC0), ~3,900 named positions in `static/eco.json`. Rebuild: `node tools/build_eco.mjs tools/eco-data`.
- **Training repertoire**: 26 openings, 114 lines (main line, variations, transpositions, trap lines) in `static/openings.js`, with Study-mode commentary in `static/study.js`. Both are generated from `tools/tree/drafts/` by `tools/tree/build_tree.mjs` (check with `validate_study.mjs`).
- **Coach styles**: `static/coaches.json`; a grandmaster style reads its paraphrased lesson library from `static/lessons/<slug>.json`.
- **Fonts**: Bricolage Grotesque, IBM Plex Sans, IBM Plex Mono (SIL Open Font License), self-hosted in `static/fonts/` via Fontsource.
- **Coach AI**: Claude if a key is set, else the local Qwen at `127.0.0.1:8080`. Every question carries fresh Stockfish lines so the AI explains the engine's verdict instead of guessing.

Settings via env vars: `CHESS_PORT` (8765), `STOCKFISH_PATH`, `LOCAL_LLM_URL` (`http://127.0.0.1:8080/v1`), `CHESS_CLAUDE_MODEL`, `CHESS_DATA_DIR` (where `profile.json` lives; default `data/`).

How it works in detail: [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).

## Licence

GPL-3.0 (see `LICENSE`), because the app ships Stockfish, which is GPLv3. Bundled third-party parts keep their own licences: chess.js (BSD-2-Clause), cburnett pieces (CC BY-SA 3.0), Lichess openings data (CC0), fonts (SIL OFL 1.1).
