"""Check static/elo-lessons/*.json: every move legal, quizzes on the right side's turn, eval claims honest.

Usage (from the project root, with python-chess importable):
    py tools/lessons/verify_elo.py [lesson-id ...]
Prints the engine's view at each quiz and scene end, and fails on illegal moves or a "checks"
entry more than 0.45 off the engine. A scene, drill or check may start from "fen"; a check may
also claim "min" or "max" (a floor or ceiling, for won and lost endings the engine scores as mate).
"""
import json, os, re, sys
from pathlib import Path
import chess, chess.engine

ROOT = Path(__file__).resolve().parents[2]
ENG = ROOT / 'engine' / 'stockfish' / 'stockfish-windows-x86-64-universal.exe'
SQ = re.compile(r'^[a-h][1-8]$')
TOLERANCE = 0.45
errors = 0


def err(msg):
    global errors
    errors += 1
    print('  ERROR', msg)


def push(b, moves, where):
    for s in moves.split():
        try:
            b.push_san(s)
        except ValueError as e:
            err(f'{where}: {s}: {e}')
            return False
    return True


eng = chess.engine.SimpleEngine.popen_uci(str(ENG))
eng.configure({'Threads': max(2, (os.cpu_count() or 4) // 2), 'Hash': 256})


def score(b):
    return eng.analyse(b, chess.engine.Limit(time=1.2))['score'].white().score(mate_score=10000) / 100


def start(o):
    return chess.Board(o['fen']) if o.get('fen') else chess.Board()


def ev(b):
    return b.result() if b.is_game_over() else f'{score(b):+.2f}'


wanted = sys.argv[1:]
for path in sorted((ROOT / 'static' / 'elo-lessons').glob('*.json')):
    L = json.loads(path.read_text(encoding='utf-8'))
    if wanted and L['id'] not in wanted:
        continue
    print('\n#####', L['name'])
    side = chess.WHITE if L['side'] == 'w' else chess.BLACK
    if len(L['tiers']) != 4:
        err('needs four tiers')
    for t in L['tiers']:
        print('==', t['elo'], t['name'])
        for sc in t['scenes']:
            b = start(sc)
            push(b, sc.get('from', ''), sc['title'])
            for i, st in enumerate(sc['steps']):
                where = f"{sc['title']} step {i}"
                if 'play' in st:
                    push(b, st['play'], where)
                for a in st.get('arrows', []):
                    if not (SQ.match(a[0]) and SQ.match(a[1]) and a[2] in ('good', 'bad', 'alt') and a[0] != a[1]):
                        err(f'{where}: bad arrow {a}')
                for m in st.get('marks', []):
                    if not SQ.match(m):
                        err(f'{where}: bad mark {m}')
                tb = st.get('table')
                if tb and any(len(r) != len(tb['head']) for r in tb['rows']):
                    err(f'{where}: table row width')
                q = st.get('quiz')
                if not q:
                    continue
                if q['kind'] == 'move':
                    if b.turn != side:
                        err(f'{where}: quiz move on the wrong turn')
                    print(f"  quiz {q['answer']:8} before {ev(b)}", end='')
                    push(b, q['answer'], where)
                    print(f' after {ev(b)}')
                elif q['kind'] == 'square':
                    print(f"  quiz sq {q['answer']} holds {b.piece_at(chess.parse_square(q['answer']))}")
                elif sum(o['ok'] for o in q['options']) != 1:
                    err(f'{where}: choice needs exactly one right answer')
            print(f"  [{ev(b):>7}] {sc['title']} | to move {'W' if b.turn else 'B'}")
        for d in t['drills']:
            b = start(d)
            if push(b, d['moves'], 'drill ' + d['name']):
                print(f"  [{ev(b):>7}] drill {d['name']}")
    print('== checks')
    for c in L.get('checks', []):
        b = start(c)
        if not push(b, c['moves'], c['name']):
            continue
        if c.get('mate'):
            print(f"  mate={b.is_checkmate()} {c['name']}")
            if not b.is_checkmate():
                err(f"{c['name']}: not mate")
            continue
        got = score(b)
        low, high = c.get('min', c['eval'] - TOLERANCE if 'eval' in c else None), c.get('max', c['eval'] + TOLERANCE if 'eval' in c else None)
        flag = ''
        if (low is not None and got < low) or (high is not None and got > high):
            flag = ' <-- OFF'
            err(f"{c['name']}: claim {low}..{high}, engine {got:+.2f}")
        print(f"  {got:+.2f} (claim {low}..{high}) {c['name']}{flag}")
eng.quit()
print('\nerrors:', errors)
sys.exit(1 if errors else 0)
