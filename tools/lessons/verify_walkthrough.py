"""Check static/walkthroughs/*.json: every move legal, every mark on a real square, eval claims honest.

Usage (from the project root, with python-chess importable):
    py tools/lessons/verify_walkthrough.py [id ...]
Fails on an illegal move, a bad square, a beat with nothing to say, or a "checks" entry more than
0.45 off the engine. A check may claim "eval", "min", "max" or "mate", as in verify_elo.py.
Also fails on a move "Drill it" would ask you to find (your side's, in a beat without "drill": false)
that leaves you worse by 1.5+ after losing 1.5+: a mistake shown on purpose must say "drill": false.
"""
import json, re, sys
from pathlib import Path
import chess, chess.engine

ROOT = Path(__file__).resolve().parents[2]
ENG = ROOT / 'engine' / 'stockfish' / 'stockfish-windows-x86-64-universal.exe'
SQ = re.compile(r'^[a-h][1-8]$')
TOLERANCE = 0.45
DRILL_LIMIT = chess.engine.Limit(depth=12)
MAX_SAY = 220           # a long utterance can be cut off by some browser voices
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


def drill_score(b, me):
    if b.is_checkmate():
        return -10000 if b.turn == me else 10000
    return eng.analyse(b, DRILL_LIMIT)['score'].pov(me).score(mate_score=10000)


def check_drill(b, moves, me, where, seen):
    """b is the position before `moves`; leaves it unchanged."""
    b = b.copy()
    for s in moves.split():
        try:
            mv = b.parse_san(s)
        except ValueError:
            return
        if b.turn == me and (b.fen(), s) not in seen:
            seen.add((b.fen(), s))
            before = drill_score(b, me)
            b.push(mv)
            after = drill_score(b, me)
            if after < -150 and before - after > 150:
                err(f'{where}: drilled move {s} goes {before} -> {after} cp; mark the beat "drill": false')
        else:
            b.push(mv)


def check_marks(beat, where):
    squares = beat.get('circle', []) + beat.get('shade', []) + beat.get('cross', [])
    if 'word' in beat:
        squares.append(beat['word'][0])
    for a in beat.get('arrows', []):
        squares += a[:2]
        if a[0] == a[1]:
            err(f'{where}: arrow goes nowhere {a}')
    for s in squares:
        if not SQ.match(s):
            err(f'{where}: bad square {s}')


eng = chess.engine.SimpleEngine.popen_uci(str(ENG))
eng.configure({'Threads': 6, 'Hash': 256})
wanted = sys.argv[1:]
for path in sorted((ROOT / 'static' / 'walkthroughs').glob('*.json')):
    W = json.loads(path.read_text(encoding='utf-8'))
    if wanted and W['id'] not in wanted:
        continue
    print('\n#####', W['title'])
    me = chess.BLACK if W.get('side') == 'b' else chess.WHITE
    seen = set()
    for ch in W['chapters']:
        b = chess.Board()
        push(b, ch.get('from', ''), ch['title'])
        print('==', ch['title'], f"({len(ch['beats'])} beats)")
        for i, beat in enumerate(ch['beats']):
            where = f"{ch['title']} beat {i}"
            if 'reset' in beat:
                b = chess.Board()
                push(b, beat['reset'], where)
            if beat.get('drill') is not False:
                check_drill(b, beat.get('play', ''), me, where, seen)
            push(b, beat.get('play', ''), where)
            check_marks(beat, where)
            say = beat.get('say', '')
            if not say:
                err(f'{where}: nothing to say')
            if len(say) > MAX_SAY:
                err(f'{where}: {len(say)} characters, over {MAX_SAY}')
    print('== checks')
    for c in W.get('checks', []):
        b = chess.Board()
        if not push(b, c['moves'], c['name']):
            continue
        if c.get('mate'):
            print(f"  mate={b.is_checkmate()} {c['name']}")
            if not b.is_checkmate():
                err(f"{c['name']}: not mate")
            continue
        got = eng.analyse(b, chess.engine.Limit(time=1.5))['score'].white().score(mate_score=10000) / 100
        low = c.get('min', c['eval'] - TOLERANCE if 'eval' in c else None)
        high = c.get('max', c['eval'] + TOLERANCE if 'eval' in c else None)
        off = (low is not None and got < low) or (high is not None and got > high)
        print(f"  {got:+.2f} (claim {low}..{high}) {c['name']}{' <-- OFF' if off else ''}")
        if off:
            err(f"{c['name']}: claim {low}..{high}, engine {got:+.2f}")
eng.quit()
print('\nerrors:', errors)
sys.exit(1 if errors else 0)
