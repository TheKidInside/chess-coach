// What to do once the opening is over: per opening (keyed by FAMILY id), the pawn structure,
// both sides' plans, the typical piece routes and pawn breaks, and the classic errors.
// `you` is always the repertoire side (the family's `side`); `them` is the opponent.
// `lines` adds one sentence for a variation whose middlegame differs from the main line.
// Hand-written, not generated. Lichess-study families fall back to their `topic` (e.g. carokann).

export const MIDDLEGAMES = {
  italian: {
    structure: 'Slow centre: c3-d3-e4 against ...d6-e5. Nobody can break through quickly, so the game is won by the side with the better plan and the better-placed pieces.',
    you: [
      'Re-route the queen\'s knight Nb1-d2-f1-g3: it is your main kingside attacker (Nf5 is the dream square).',
      'Prepare d3-d4 with c3 and Re1 already in place; strike in the centre only when e4 is fully protected.',
      'Gain queenside space with a4 (a4-a5 bothers ...b5 and the Ba7).',
      'Trade off Black\'s strong Ba7 with Be3 when it eyes f2.',
    ],
    them: [
      'The same knight trip, ...Ne7-g6, and ...Nh5-f4 when you allow it.',
      '...c6 and ...d5 to free the centre; ...Be6 to trade your Bb3.',
    ],
    pieces: [
      'Breaks: d3-d4 for you, ...d6-d5 for Black.',
      'Bb3-c2 keeps the light bishop aimed at the kingside after ...Be6 or ...Na5.',
      'Nh4-f5 when the g-pawn cannot chase it.',
    ],
    avoid: [
      'd4 before Re1 and Nbd2: after ...exd4 cxd4 the e4-pawn hangs.',
      'Bg5 pins that ...h6 and ...g5 simply kick away while your kingside loosens.',
    ],
    lines: {
      'italian-twoknights': 'Black grabs queenside space with ...Na5, ...b5 and ...c5 and hunts your bishop: keep it on c2, run Nbd2-f1-g3, and play d4 or a4 when Black overreaches.',
      evans: 'You are a pawn down for a big lead in development: open lines fast with d4, Qb3 (hitting f7), Ba3 (stopping ...castling) and Re1. Taking the pawn back slowly loses the point of the gambit.',
      'italian-classical': 'You have an isolated d-pawn: keep pieces on, use Qb3 and Ne5 against f7, put rooks on the e- and c-files, and push d4-d5 when it opens lines. Every trade helps Black.',
    },
  },

  ruy: {
    structure: 'Closed Ruy Lopez: a pawn chain c3-d4-e4 (after d4) against Black\'s ...b5-d6-e5. Space on both wings and a long manoeuvring fight.',
    you: [
      'Play d2-d4 to build the big centre, then the knight tour Nbd2-f1-g3.',
      'Choose a wing: d4-d5 closes the centre and lets you attack on the kingside (Nh2-g4, f4) or open the queenside with a4.',
      'a2-a4 is the standard lever against ...b5: it opens the a-file for your rook.',
      'Keep the bishop: Bb3-c2 when ...Na5 attacks it; it is your best kingside attacker.',
    ],
    them: [
      '...Na5 and ...c5 to grab queenside space and swap your Spanish bishop.',
      '...Bb7, ...Re8 and ...Bf8 to pile up on e4; the ...exd4 and ...d5 break.',
    ],
    pieces: [
      'Knight route: Nb1-d2-f1-g3 (or e3) toward f5 and h5.',
      'Breaks: d4 and a4 for you; ...c5, ...d5 and ...f5 for Black.',
      'Pawn structure decides the plan: closed centre = attack on a wing; open centre = piece play on the d-file.',
    ],
    avoid: [
      'd4 before the e4-pawn is defended: ...exd4 and ...Nxe4.',
      'Letting ...Na5 swap your bishop for free: retreat it to c2 in time.',
    ],
    lines: {
      'ruy-berlin': 'The Anti-Berlin plays like a slow Italian: Ba4-c2, Nbd2-f1-g3, then d3-d4 or Nh4-f5 when the pieces are ready.',
      'ruy-exch': 'You have a healthy 4-against-3 kingside majority, Black has the bishop pair. Aim for an endgame: trade pieces, push f4 and e5 to make a passed pawn.',
      'ruy-open': 'Black\'s pieces are active but the d5-pawn is a target: chase the e4-knight with Nbd2, plant a knight on d4, aim Bc2 and Qe2 at the kingside, and press d5 and e6.',
    },
  },

  qgd: {
    structure: 'Queen\'s Gambit Declined: Black\'s solid d5-e6 against your d4. Watch for the ...c5 break: it leads to hanging pawns or an isolated pawn.',
    you: [
      'Rc1 and Bd3: pressure on the c-file and the b1-h7 diagonal.',
      'If the c-pawns swap off on d5 (Carlsbad structure: your d4/e3 against d5/c6), run the minority attack b2-b4-b5 to give Black a weak c-pawn.',
      'If Black gets hanging pawns on c5 and d5, pressure them with Rc1, Rd1 and Qe2, then attack with e4 or b4.',
    ],
    them: [
      '...c5 to free the game; ...Bb7 on the long diagonal; ...Ne4 to swap pieces and breathe.',
    ],
    pieces: [
      'Breaks: e3-e4 (central), b4-b5 (minority attack).',
      'The dark bishop: Bh4-g3 keeps the pin, Bxf6 gives up the bishop to weaken the d5-pawn.',
    ],
    avoid: [
      'Letting ...c5 and ...dxc4 free Black for nothing: keep the pressure on d5 so the break costs something.',
      'Drifting into symmetrical endgames where Black has no weakness.',
    ],
    lines: {
      'qgd-qga': 'An isolated d-pawn is likely after ...cxd4 exd4: Bc2 and Qd3 aim at h7, a knight goes to e5, and d4-d5 is your break. Trades help Black.',
      'qgd-slav': 'You won the bishop pair with Nxg6: open the centre with e3-e4 (prepare with Qc2 and Rd1) so the bishops breathe. Black\'s open h-file means be careful with your king.',
    },
  },

  london: {
    structure: 'London pyramid c3-d4-e3 with the bishop outside on f4. Safe and flexible: the plan comes from where Black puts the pieces.',
    you: [
      'Ne5 is your outpost; back it with f4 for a Stonewall-style kingside attack.',
      'If Black castles short: Qf3 or Qh3, g4-g5, and look for Bxh7+ sacrifices.',
      'Keep the bishop when ...Bd6 offers a trade: Bg3, and if ...Bxg3 then hxg3 gives you the h-file.',
    ],
    them: [
      '...Qb6 against b2; ...Nh5 to swap your Bf4; the ...c5 and ...e5 breaks.',
    ],
    pieces: [
      'Bd3 + Qc2: battery on h7.',
      'Breaks: e3-e4 in the centre, g4-g5 on the kingside.',
    ],
    avoid: [
      'Forgetting b2 after ...Qb6: answer with Qb3 or Qc1.',
      'Letting ...e5 happen for free: it takes your centre and kicks the bishop.',
    ],
    lines: {
      'london-kid': 'Against the King\'s Indian set-up Black wants ...e5: keep h3 and c3 so the bishop has h2, then either exchange on e5 and play on the queenside or grab the centre with e4.',
      'london-c5': 'After ...cxd4 exd4 the e-file is yours: plant Ne5, put rooks on e1, and use Qb3 against b7 and d5. Black\'s counter is the minority attack ...b5-b4.',
      'london-qb6': 'Queens are off and your b-pawns are doubled: use the half-open a-file and grab queenside space with b4-b5. Centralise the king; it is already an endgame.',
    },
  },

  scotch: {
    structure: 'Mieses Scotch: your e5-pawn and c4 grip the centre; Black has doubled c-pawns and an isolated a-pawn that become targets later.',
    you: [
      'Keep the e5-pawn: it cramps Black\'s kingside and takes f6 and d6 from the pieces.',
      'Develop with g3 and Bg2 or b3 and Bb2; trade queens if it lets you attack Black\'s broken queenside.',
      'Head for an endgame: Black\'s pawn islands are the long-term edge.',
    ],
    them: [
      '...d6 to undermine e5; ...Ba6 to pin the c4-pawn; ...Nb6 and ...Qe6 hitting c4.',
    ],
    pieces: [
      'Nd2-f3 or Nc3 supports e5.',
      'Breaks: f4 to support e5, c5 to cramp Black further.',
    ],
    avoid: [
      'Overextending: the e5- and c4-pawns need defenders before you push more.',
    ],
    lines: {
      'scotch-classical': 'After ...dxc6 you have a healthy 4-against-3 kingside majority. Push f4 and e5 for space, trade the dark bishops to blunt Black\'s activity, and aim for the endgame.',
      'scotch-steinitz': 'You gave the e4-pawn for development and Black\'s king is stuck on d8: open lines with Re1, Bf3 and Bf4 (hitting c7) and attack before Black untangles.',
    },
  },

  najdorf: {
    structure: 'English Attack with opposite-side castling: White is on the queenside with g4-g5 coming, you are on the kingside. A pure race.',
    you: [
      '...b5-b4 storm: kick the c3-knight and open lines at White\'s king.',
      '...Rc8 and ...Qc7: the c-file is your highway, and ...Rxc3 is the standard exchange sacrifice.',
      '...Nb6-c4 (or -a4) hitting Be3 and Qd2.',
      '...d5 break when it is safe: it opens the centre while White\'s pieces face the kingside.',
    ],
    them: [
      'g4-g5 to kick the f6-knight, h4-h5, and a knight on d5.',
    ],
    pieces: [
      'Control d5: ...Be6 and ...Nbd7-b6 so a white knight never settles there.',
      'Breaks: ...b5-b4 and ...d5.',
    ],
    avoid: [
      'Slow moves: in a race one tempo decides. Every move should attack or stop a white attack.',
      'Leaving a white knight on d5: trade it with ...Bxd5 or ...Nxd5.',
    ],
    lines: {
      'najdorf-bb5': 'The Moscow line ends in a French-style structure (d5 against e5): hit e5 with ...f6, use the half-open c-file, and post a knight on e4 or b4.',
      'najdorf-bg5': 'White has castled long and is pushing g4-g5: ...b5-b4, ...Bb7 against e4, ...Nc5 and ...Rc8; the ...Rxc3 sacrifice is often the fastest way in.',
      'najdorf-be2': 'A quieter positional game about the d5 square: ...Be6, ...Rc8, ...Nb6 and queenside space with ...b5 or ...a5-a4; play ...d5 once you control it.',
    },
  },

  jobava: {
    structure: 'Knight on c3, bishop on f4, pawns on d4 and e3. If the light bishops were traded on d3 you have doubled d-pawns that control e4 and c4.',
    you: [
      'Nb5 whenever c7 is thin: with Bf4 it hits c7 twice, and a knight on b5 leaves a Black knight stuck on a6.',
      'After cxd3: Rc1 on the open file, Qb3 against b7, and Ne5 backed by f3 or f4.',
      'If Black castles short, Bg3 and h4 use the half-open h-file after any trade on g3.',
    ],
    them: [
      '...a6 or ...c6 to keep the knight out of b5, ...Bd6 to trade your bishop, and the ...c5 break.',
      '...Qb6 against b2: ...Qxb2 is a real threat once ...a6 has taken b5 away, so a3 and Na4 is the usual answer.',
    ],
    pieces: [
      'Breaks: e3-e4 once f3 is in, and dxc5 when it wins time on the f8-bishop.',
      'The c-pawn is blocked, so the knight, not a pawn, fights for d5 and e4.',
    ],
    avoid: [
      'Recapturing on d3 with the queen by habit: cxd3 is the point of the system.',
      'Playing Nb5 when ...c6 or ...a6 simply kicks it and you lose two moves.',
    ],
    lines: {},
  },

  'caro-advance': {
    structure: 'Pawns on c6, d5 and e6 against d4 and e5. Your bishop is outside the chain; White has space, and d4 is the base you attack.',
    you: [
      '...c5, ...Nc6 and ...Qb6 pile on d4. Trade on d4 only when it opens the c-file for your rook.',
      '...Ne7 to f5 or g6, hitting d4 and h4.',
      '...f6 is the second break, against e5, when your king is safe.',
    ],
    them: [
      'Nbd2-b3 to hold d4, Be3, and queenside or kingside pawn pushes: h4 and g4 chase your bishop.',
    ],
    pieces: [
      'Keep ...h6 ready so the f5-bishop has h7. If h4 comes, ...h5 stops it.',
      'Breaks: ...c5 first, ...f6 second.',
    ],
    avoid: [
      'Delaying ...c5: without it the position goes stale and White expands.',
      'Taking on b2 without checking that the queen can get home.',
    ],
    lines: {},
  },

  'caro-exchange': {
    structure: 'After exd5 cxd5: a symmetrical pawn structure with White\'s pawn on d4 and yours on d5. With c4 (the Panov) White gets an isolated d-pawn.',
    you: [
      '...Nc6, ...Nf6, ...Bg4 and ...e6, in that order, so the bishop gets out before ...e6.',
      'Against c3: the minority attack with ...b5-b4 and ...Rc8.',
      'Against the isolated pawn: put a knight on d5, swap minor pieces, then press d4.',
    ],
    them: [
      'Bf4, Bd3 and Qb3 against b7; Ne5 and a kingside attack with the bishop on d3.',
    ],
    pieces: [
      'Good squares: d5 for a knight, c4 after ...b5.',
      'The c-file is open: your rook belongs on c8.',
    ],
    avoid: [
      '...e6 before ...Bg4, which shuts the bishop in.',
      'Trading on c4 too soon in the Panov: it hands White\'s bishop a tempo.',
    ],
    lines: {},
  },

  carokann: {
    structure: 'Classical Caro-Kann: solid c6-e6 against d4. White\'s h5-pawn takes space and White usually castles long; you have no weaknesses and a free game.',
    you: [
      '...Ngf6, ...Qc7 (or ...Qa5) and ...O-O-O: long castling is usually safer than walking into the h5-pawn.',
      'Break with ...c6-c5 to challenge d4: your main source of play.',
      '...Bd6 to trade the dark-squared bishops; later the h5-pawn can become a target.',
    ],
    them: [
      'Bd2, Qe2, O-O-O; knights to e4 and e5; the d4-d5 break; g4 on the kingside.',
    ],
    pieces: [
      'Breaks: ...c5 (main), ...e5 (rare, after full development).',
      'Good squares: d5 and f6 for your knights; c7 or a5 for the queen.',
    ],
    avoid: [
      'Castling short into the h5-pawn and a g4-g5 storm.',
      'Passive play without ...c5: the position goes stale and White grows.',
    ],
    lines: {
      'carokann-twoknights': 'White has the bishop pair, you have the centre. Fix it with ...e5 or ...d4 to blunt the bishops, and keep your pieces on dark squares.',
      'carokann-bh5': 'After ...Kf7 your king is safe on f7 and the h-file is open for your rook: ...Bd6, ...Nge7 and ...Rh8 use it.',
      'carokann-adv': 'A French-style structure: hit d4 with ...c5, ...Nc6 and ...Qb6, and keep ...f6 as the second break against e5.',
      'carokann-exch': 'A reversed Carlsbad: play the minority attack ...b5-b4 and use the c-file with ...Rc8. White aims for Ne5 and a kingside attack.',
      'carokann-karpov': 'Solid ...Nd7 set-up: finish with ...O-O, ...b6 and ...Bb7, then break with ...c5.',
      'carokann-karpov-bc4': 'Win back the c5-pawn with ...Nxc5 or ...Bxc5, then develop with ...b6, ...Bb7, ...Qc7 and ...O-O.',
    },
  },

  french: {
    structure: 'French Advance: a locked centre. Your queenside chain ends on c4 and gives you space there; White\'s e5-pawn gives White space on the kingside.',
    you: [
      'Play on the queenside: ...Na5-b3, ...Bd7, ...Ne7-c6 or -f5.',
      'Trade your bad light-squared bishop: ...Bd7-b5.',
      'Keep ...f6 in reserve to strike at e5 once the kingside is safe.',
    ],
    them: [
      'g3 and h4 kingside expansion, Nf1-e3, and b3 to attack your c4-pawn.',
    ],
    pieces: [
      'Breaks: ...f6 (against e5), ...b5-b4 (queenside).',
      'Your knights want f5 and b3.',
    ],
    avoid: [
      'Opening the f-file toward your own king.',
      'Keeping the bad bishop locked behind e6 and d5.',
    ],
    lines: {
      winawer: 'White ate kingside pawns: play ...Nbc6, ...Bd7, ...O-O-O and roll the centre with ...dxc3 and ...d4. Blockade White\'s passed h-pawn.',
      'french-tarrasch': 'After ...f6 exf6 Nxf6 you have active pieces and a weak e6-pawn: ...O-O, ...Qc7 and the ...e5 break free the game. White wants to blockade on e5.',
      'french-exch': 'Symmetrical: use the e4 square, put rooks on e8, and go for the kingside with ...Nf5 or ...Ng6.',
    },
  },

  kid: {
    structure: 'Mar del Plata King\'s Indian: centre locked with d5. Black attacks on the kingside, White on the queenside. Whoever is faster wins.',
    you: [
      '...Nd7 (or ...Ne8) to free the f-pawn, then ...f5.',
      '...f4 and ...g5-g4: the pawn storm at White\'s king.',
      'Bring the pieces over: ...Ng6, ...Rf6-h6 or ...Rf7, ...Bf8 for defence.',
    ],
    them: [
      'c4-c5, b4, Nd2-c4 or Ne1-d3: break through on the queenside.',
    ],
    pieces: [
      'Breaks: ...f5 then ...g5-g4.',
      'The Bg7 looks blocked but defends your king and comes alive when the centre opens.',
    ],
    avoid: [
      'Slow moves on the queenside: you attack where you have space.',
      'Trading the g7-bishop for nothing.',
    ],
    lines: {
      'kid-fianchetto': 'After ...exd4 and ...Re8 play against the e4-pawn: ...Nc5, ...a5 to anchor the knight, and ...c6 to keep the tension.',
      'kid-samisch': 'The Panno: ...b5 (prepared by ...Rb8 and ...a6) opens the queenside while White storms with h4-h5. Meet the storm with ...h5.',
      'kid-four-pawns': 'A Benoni structure: ...Re8 against e4, the ...b5 break, and ...Bg4xf3 to stop e4-e5. Blockade e5 if it comes.',
    },
  },

  slav: {
    structure: 'Slav with ...Bf5 outside the pawn chain: solid and comfortable. The question is when you break with ...e5 or ...c5.',
    you: [
      '...Nbd7 and ...Qe7, then ...e6-e5: the main freeing break.',
      '...Bg6 when White plays Nh4, so the knight does not grab the bishop.',
      '...c5 when the centre opens.',
    ],
    them: [
      'e3-e4 with Qe2 and Rd1; Nh4 to win the bishop pair.',
    ],
    pieces: [
      'Breaks: ...e5 (main) and ...c5.',
      'The Bb4 pins the c3-knight and slows e4.',
    ],
    avoid: [
      'Letting Nh4xf5 happen for free.',
      'Sitting passively without ...e5 or ...c5.',
    ],
    lines: {
      'slav-exchange': 'A symmetrical c-file battle: contest it with ...Rc8, put a knight on e4, and watch for Bb5 pins on c6.',
      'slav-e3': 'You gave the bishop pair for the open h-file: ...Qc7 or ...Bd6 against h2, then ...dxc4 and ...e5.',
      'slav-5e3': 'Your ...b5-b4 grabbed space and sent the knight to a2: play ...Bb7 and break with ...c5.',
    },
  },

  vienna: {
    structure: 'Vienna Gambit with fxe5: your e5-pawn and the half-open f-file. The kingside is where you play.',
    you: [
      'Castle, then aim at the kingside: Qe1-h4 or Qe2, and pressure on the f-file.',
      'Bd3 against h7; Ne2-f4 or Ng5 ideas.',
      'Keep the e5 spearhead supported with d4 and Nf3.',
    ],
    them: [
      '...f6 and ...c5 to break your centre; ...Nxc3 bxc3 to double your pawns.',
    ],
    pieces: [
      'f-file + Bd3 + Qh4: the attacking trio.',
      'Breaks: c4 to undermine d5 if Black keeps it.',
    ],
    avoid: [
      'Overextending the centre with no pieces behind it.',
      'Letting ...f6 open lines toward your own king.',
    ],
    lines: {
      'vienna-nc6': 'A closed Vienna-Italian with f4: play f4-f5, Qe1-g3 or -h4, and open the f-file against the king.',
      'vienna-accepted': 'You castled long and got the pawn back: use the e-file, Bd3 and Rhe1, and storm the kingside if Black castles there.',
    },
  },

  kingsgambit: {
    structure: 'Kieseritzky King\'s Gambit: open lines, the f-file, and a fight for the f4- and g4-pawns.',
    you: [
      'Win back material on f4 and g4 while developing: Bf4, Nc3, Be2.',
      'Open the f-file and aim at f7.',
      'Castle quickly: your king is the one with fewer defenders.',
    ],
    them: [
      '...Qe7, ...Bg7, and holding on to the extra pawn.',
    ],
    pieces: [
      'Rook to f1 or e1 on the open files; queen to d2 or e2.',
    ],
    avoid: [
      'Leaving the king in the centre after the e-file opens.',
    ],
    lines: {
      'kingsgambit-declined': 'A Classical-style centre: d4, Bd3 and castling, then e5 for space or the f-file for attack.',
      'kingsgambit-modern': 'An open centre with the pawn regained on f4: Nc3, Qd2, Rae1, and pressure on f7 along the f-file.',
    },
  },

  alapin: {
    structure: 'Alapin with ...Nf6: your d4-e5 centre against a knight on d5. If the centre is exchanged, you get an isolated d-pawn with active pieces.',
    you: [
      'Chase the d5-knight with Bc4-b3 and Nc3.',
      'Keep the e5 wedge: it takes f6 and d6 away.',
      'If the centre opens, play the isolated d-pawn: Qe2, Rd1, Ne5, and the d4-d5 break.',
    ],
    them: [
      '...d6 to hit e5; ...Nc6 and ...Bg4 against d4.',
    ],
    pieces: [
      'Bb3 + Qe2 + Rd1: the standard set-up.',
    ],
    avoid: [
      'Letting the e5-pawn be undermined without support.',
    ],
    lines: {
      'alapin-d5': 'An isolated d-pawn: Nc3 gains time on the queen, then Bd3, Qe2, Rd1, Ne5, the d4-d5 break and a kingside attack.',
      'alapin-nf6-e6': 'A French-like structure: keep e5 with Qe2 and Rd1, and trade the d5-knight with Nc3 when it suits you.',
    },
  },

  caroadv: {
    structure: 'Caro-Kann Advance, Short System: your e5-pawn gives you kingside space; Black\'s structure is solid but cramped.',
    you: [
      'Chase the Bf5: Nh4 or g4 at the right moment.',
      'Queenside: c3, Nbd2-b3; after ...c5, take on c5 and blockade d4 with pieces.',
      'c4 to open the centre on your terms.',
    ],
    them: [
      '...c5, ...Nc6 and ...Qb6 against d4 and b2; ...f6 against e5.',
    ],
    pieces: [
      'Breaks: c4 (yours), ...c5 and ...f6 (Black\'s).',
      'The d4 square: put a knight or bishop there if the d-pawn leaves.',
    ],
    avoid: [
      'Leaving b2 hanging against ...Qb6.',
    ],
    lines: {
      'caroadv-c5': 'You own e5 and the d4 square, and a3-b4 pushed the bishop back: finish with Nbd2 and Re1, keep Black\'s knights off d4, and aim the Bd3 at the kingside.',
      'caroadv-nd7': 'Black delays ...c5: grab queenside space with Nb3 and a4-a5 so ...c5 never comes, and use c4 to open the centre.',
      'caroadv-cxd4': 'An open c-file: blockade on d4 with the bishop, trade light bishops with Bd3, and keep Black\'s rooks out of c2.',
    },
  },

  catalan: {
    structure: 'Open Catalan: your Bg2 rakes the long diagonal at b7 and a8. Black\'s queenside pawns are the target.',
    you: [
      'Pressure the queenside: Rc1, Bf4 or Bd2, Nbd2-b3.',
      'a2-a4 against ...b5.',
      'Use the c-file against c7 and c6.',
    ],
    them: [
      '...c5 to free the game; ...Nbd7; ...Be4 to swap your Bg2.',
    ],
    pieces: [
      'Bg2 is the star: never swap it cheaply.',
      'Breaks: a4 (yours), ...c5 (Black\'s).',
    ],
    avoid: [
      'Letting ...c5 free Black without a fight.',
    ],
    lines: {
      'catalan-bb4': 'Black aims ...Ba6 at c4: Bf4, Rc1, cxd5, and e4 once Qc2 and Nbd2 support it.',
      'catalan-closed': 'With e4 played, push e5 for space or keep the tension; meet ...c5 and ...dxe4 with Rd1 and Bb2.',
    },
  },

  english: {
    structure: 'Reversed Sicilian Dragon: you are the Dragon with an extra tempo. Your play is on the queenside.',
    you: [
      'Rb1, a3 and b4-b5: queenside space that kicks the c6-knight.',
      'Be3, Rc1 and Na4-c5 against the queenside.',
    ],
    them: [
      '...f5 and kingside play; ...Be6; ...a5 to stop b4.',
    ],
    pieces: [
      'Bg2 on the long diagonal backs everything up.',
      'Breaks: b4-b5 (yours), ...f5-f4 (Black\'s).',
    ],
    avoid: [
      'Letting ...a5 stop b4 for free: prepare it with a3 and Rb1.',
    ],
    lines: {
      'english-symmetrical': 'An open, Hedgehog-like centre: pressure b7 and d6, play Rd1, Be3, and look for c5 to break.',
      'english-kid': 'Rb1 and b4 for queenside space; f4 later; Black goes ...f5 on the kingside.',
    },
  },

  dragon: {
    structure: 'Yugoslav Attack: opposite-side castling. White storms with h4-h5, you attack down the c-file. A pure race.',
    you: [
      '...Nc4 hitting Qd2 and Be3.',
      '...Rxc3: the exchange sacrifice that wrecks White\'s king.',
      '...Qa5, ...b5-b4.',
    ],
    them: [
      'h4-h5 to open the h-file, Bh6 to trade the Bg7, Nd5.',
    ],
    pieces: [
      'Defend with ...h5 (Soltis) when the h-file threat is near.',
    ],
    avoid: [
      'Letting Bh6 trade the Bg7 for free: it is your best defender.',
      'Slow moves: the race decides.',
    ],
    lines: {
      'dragon-classical': 'White castled short: ...Na5-c4 and ...Bc4 to trade bishops, ...Rc8, ...b5, and pressure on e4.',
      'dragon-d5': 'The centre is open: active pieces matter. ...Nxc3 and pressure on the c3-pawn with ...Qc7, ...Be6, ...Rb8.',
    },
  },

  twoknights: {
    structure: 'Two Knights with ...Na5: you are a pawn down for a lead in development and space after ...e4.',
    you: [
      '...Bd6, ...Qc7, ...O-O: develop fast and keep the initiative.',
      'Use the e4-pawn: it cramps White.',
      'Bring the a5-knight back via b7 and c5.',
    ],
    them: [
      'd4, Nc4 or Ng4 to trade, consolidate the extra pawn.',
    ],
    pieces: [
      'Rooks to b8 and e8.',
    ],
    avoid: [
      'Slow moves: the pawn only pays off if you keep the initiative.',
    ],
    lines: {
      'twoknights-d3': 'A quiet Italian from Black\'s side: ...Re8, ...Be6 to trade the Bb3, ...Ne7-g6, and ...d5.',
      'twoknights-d4': 'Your knight goes to g5 and e6; then ...O-O and ...f6 against e5, with the bishop pair.',
    },
  },

  petrov: {
    structure: 'Classical Petrov: symmetrical and solid. Your e4-knight is the outpost; equality is the floor, so play for small edges.',
    you: [
      '...Nb4 to hit Bd3; ...Be6 or ...Bf5; ...dxc4 and ...c6.',
      'Keep the e4-knight supported.',
    ],
    them: [
      'Nc3, a3, Re1, c5 for space.',
    ],
    pieces: [
      'The d5-pawn anchors your play; trade pieces to reach equal endgames.',
    ],
    avoid: [
      'Allowing Re1 pressure on e4 without support.',
    ],
    lines: {
      'petrov-d4': 'After Qh5 watch h7: ...Nf6 or ...g6 defends; then ...Re8 and ...Bg4 to trade pieces.',
      'petrov-nc3': 'White castled long: ...b5-b4 or ...Qa5 with ...c5 for counterplay against White\'s h4-g4 storm.',
    },
  },

  scandi: {
    structure: 'Scandinavian with ...Qa5 and ...Bf5: a Caro-like set-up with the queen out early. Solid if you finish development.',
    you: [
      '...Bb4, ...Nbd7, ...O-O or ...O-O-O, ...Qc7.',
      '...c5 break once developed.',
    ],
    them: [
      'Nd5 tricks with Bd2 (discovering on your queen), Ne5, g4 to chase the bishop.',
    ],
    pieces: [
      'The queen often drops back to c7 or b6.',
    ],
    avoid: [
      'Leaving the queen exposed to Nd5 discoveries.',
    ],
    lines: {
      'scandi-nf3': 'Your king is long: develop ...Nf6 and ...Bc5 and use the open d-file.',
      'scandi-ne5': 'White pushed g4: ...e6, ...Bd6, ...Qc7, and ...h5 to undermine the overextended kingside.',
    },
  },

  pirc: {
    structure: 'Classical Pirc: White has the big centre, you have a solid fianchetto and plan to break it.',
    you: [
      '...b5 or ...a6 on the queenside.',
      '...Nbd7 and ...e5: strike the centre.',
      '...Bg4 to trade the Nf3 defender.',
    ],
    them: [
      'e5 push, h3, central space.',
    ],
    pieces: [
      'Bg7 aims at d4 and b2.',
    ],
    avoid: [
      'Passivity: without ...e5 or ...c5 White just grows.',
    ],
    lines: {
      'pirc-austrian': 'White pushed f4: ...Qa5, ...Bg4 pin, ...Nc6; watch for e5 and f5 breaks.',
      'pirc-150': '...Qc7, ...a6, ...Re8; White\'s Bh6 and h4 are blunted as long as g6 holds.',
    },
  },

  berlin: {
    structure: 'Berlin endgame: queens off, your king on d8, bishop pair against White\'s kingside majority.',
    you: [
      '...h6 and ...Ke8 or ...Kc8: tuck the king.',
      '...Be6 or ...Be7, ...Kc8-b7.',
      'Blockade the kingside majority: ...Ne7 and ...h5.',
    ],
    them: [
      'Nc3, Rd1+, h3, g4 to push e5 and f4-f5.',
    ],
    pieces: [
      'Bishop pair: open lines help them.',
    ],
    avoid: [
      'Letting f4-f5 run unopposed.',
    ],
    lines: {
      'berlin-anti-d3': 'An Italian-like structure: ...Ne7-g6, ...c6 and ...d5, ...Be6.',
      'berlin-re1': 'Equal and symmetrical: ...Re8, ...d5, ...Nf5.',
    },
  },

  nimzo: {
    structure: 'Rubinstein Nimzo: after ...dxc4 and ...cxd4 an isolated d-pawn (or hanging pawns) often appears. You blockade.',
    you: [
      'Blockade d5 with a knight: ...Nb4-d5.',
      '...b6 and ...Bb7: control d5.',
      'Trade pieces: the isolated pawn gets weaker in the endgame.',
    ],
    them: [
      'd4-d5 break; kingside attack with Bd3, Qd3, Ne5.',
    ],
    pieces: [
      'd5 is your key square.',
    ],
    avoid: [
      'Allowing d4-d5 to open lines.',
    ],
    lines: {
      'nimzo-qc2': 'With ...b6, ...Ba6 and ...c5 in, finish with ...Nbd7 and ...Rc8: the c-file and the light squares are yours.',
      'nimzo-samisch': 'The doubled c-pawns are the target: ...Ne8-d6 and ...Ba6 against c4, ...Na5. White storms with f3, e4-e5 and f4-f5.',
    },
  },

  grunfeld: {
    structure: 'Exchange Grünfeld: White\'s big centre against your pressure. In the endgame your queenside majority is the trump.',
    you: [
      '...cxd4 and ...Qa5+; ...Bg4 and ...Nc6 against d4.',
      'Trade queens: your queenside pawns run in the endgame.',
      '...b6 or ...e6 to restrain d5.',
    ],
    them: [
      'd5 push; Rb1 against b7.',
    ],
    pieces: [
      'Bg7 on the long diagonal is your main piece.',
    ],
    avoid: [
      'Letting d5 run free without counterplay.',
    ],
    lines: {
      'grunfeld-bf4': '...Qxc5, ...Rd8, ...Nc6, ...Be6: open lines and active pieces.',
      'grunfeld-russian': 'Hit d4 with ...Nc6, ...Bxf3 and ...Bg7; ...f5 or ...e5 can break.',
      'grunfeld-bc4': '...Bg4 and ...Na5 against Bc4; ...cxd4 then ...Qd7 or ...Rd8 against d4.',
    },
  },

  dutch: {
    structure: 'Leningrad Dutch: your f5 and Bg7. The ...e5 break is your central plan.',
    you: [
      '...e5 (prepared with ...Qe8 and ...Nc6 or ...Na6).',
      '...Qh5 and ...f4 kingside play.',
    ],
    them: [
      'b4 and c5, d5, e4.',
    ],
    pieces: [
      'Bg7 on the long diagonal.',
    ],
    avoid: [
      'Leaving e6 weak once ...e5 is not possible.',
    ],
    lines: {
      'dutch-bg5': 'Your central pawns are the asset: ...Nf6, ...O-O, ...e5. Watch the e-file and e7.',
      'dutch-staunton': 'White castled long: ...Be6, ...Qe7, ...O-O; you have the bishop pair while White presses d5 and e6.',
    },
  },

  benoni: {
    structure: 'Modern Benoni: White has a central majority and d5, you have a queenside majority and active pieces.',
    you: [
      '...Re8 against e4; ...Nbd7-e5.',
      '...a6 and ...b5: your queenside majority break.',
      '...Nh5 and ...f5 ideas.',
    ],
    them: [
      'e5 break; Nd2-c4 hitting d6.',
    ],
    pieces: [
      'Bg7 on the long diagonal.',
    ],
    avoid: [
      'Allowing e4-e5 to open lines.',
    ],
    lines: {
      'benoni-fianchetto': '...Re8, ...Nbd7-e5, ...Rb8 and ...b5; White\'s Nd2-c4 hits d6.',
      'benoni-taimanov': 'White threatens e5: ...Na6-c7 or -b4, ...Re8, ...Nf6, and blockade e5.',
    },
  },
};
