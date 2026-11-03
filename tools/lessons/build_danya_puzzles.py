"""Build static/lessons/naroditsky-puzzles.json from danya_puzzles.src.json and the note text in lessons/naroditsky.json.

Usage: py tools/lessons/build_danya_puzzles.py   (python-chess is in C:/Artificial/.venvs/common)
Every move must be legal and Stockfish must agree the answer is sound: within MARGIN of its best move.
Accepted alternatives ("also") have to pass the same test. Prints each puzzle's engine view; errors stop the build.
"""
import json, os, sys
from pathlib import Path
import chess, chess.engine

ROOT = Path(__file__).resolve().parents[2]
ENG = ROOT / 'engine' / 'stockfish' / 'stockfish-windows-x86-64-universal.exe'
MARGIN = 0.40
src = json.loads((ROOT / 'tools/lessons/danya_puzzles.src.json').read_text(encoding='utf-8'))
lib = json.loads((ROOT / 'static/lessons/naroditsky.json').read_text(encoding='utf-8'))
eng = chess.engine.SimpleEngine.popen_uci(str(ENG))
eng.configure({'Threads': max(2, (os.cpu_count() or 4) // 2), 'Hash': 256})
out, errors = [], 0


def cp(b, turn):
    i = eng.analyse(b, chess.engine.Limit(time=1.0))
    return i['score'].pov(turn).score(mate_score=10000) / 100


for p in src:
    b = chess.Board()
    for s in p['moves'].split():
        b.push_san(s)
    turn = b.turn
    top = eng.analyse(b, chess.engine.Limit(time=1.5), multipv=3)
    best = top[0]['score'].pov(turn).score(mate_score=10000) / 100
    view = ' '.join(f"{b.san(i['pv'][0])}={i['score'].pov(turn).score(mate_score=10000) / 100:+.2f}" for i in top)
    accept, bad = [], []
    for san in [p['answer']] + p.get('also', []):
        m = b.parse_san(san)
        b.push(m)
        got = 100.0 if b.is_checkmate() else cp(b, turn)
        b.pop()
        accept.append(m.uci())
        if got < best - MARGIN:
            bad.append(f'{san}={got:+.2f}')
    print(f"{'BAD ' if bad else 'ok  '}{p['id']:18} {p['answer']:6} | {view} {bad or ''}")
    if bad:
        errors += 1
    note = lib['openings'][p['family']][p['note']]
    out.append({'id': p['id'], 'family': p['family'], 'pgn': p['moves'], 'solution': accept[0], 'accept': accept,
                'ask': p['ask'], 'text': note['text'], 'sources': note['sources']})
eng.quit()
print('puzzles', len(out), 'errors', errors)
if errors:
    sys.exit(1)
(ROOT / 'static/lessons/naroditsky-puzzles.json').write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
