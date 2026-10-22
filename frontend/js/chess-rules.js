/*
 * chess-rules.js
 * ==============
 * The complete rules of chess, written from scratch (no libraries):
 *
 *   - FEN loading / saving
 *   - legal move generation (castling, en passant, promotion, pins, checks)
 *   - checkmate / stalemate / insufficient material / 50-move detection
 *   - SAN (Nf3, exd5, O-O, e8=Q#) creation and parsing
 *   - PGN parsing (headers, comments, variations, move numbers)
 *
 * Board layout: "0x88" mailbox. Square number = rank * 16 + file, so
 * a1 = 0, h1 = 7, a8 = 112, h8 = 119.  (sq & 0x88) != 0 means "off the board".
 *
 * Pieces are small integers:  type 1..6 = Pawn Knight Bishop Rook Queen King,
 * add 8 for black.  0 = empty square.
 */
(function (root) {
  'use strict';

  var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var FILES = 'abcdefgh';

  var P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  var WHITE = 0, BLACK = 1;
  var PIECE_CHARS = '.PNBRQK';

  // castling rights bit flags
  var CWK = 1, CWQ = 2, CBK = 4, CBQ = 8;

  // move flags
  var F_CAPTURE = 1, F_EP = 2, F_DOUBLE = 4, F_KCASTLE = 8, F_QCASTLE = 16, F_PROMO = 32;

  var KNIGHT_OFFSETS = [33, 31, 18, 14, -14, -18, -31, -33];
  var KING_OFFSETS = [1, -1, 16, -16, 15, 17, -15, -17];
  var BISHOP_DIRS = [15, 17, -15, -17];
  var ROOK_DIRS = [1, -1, 16, -16];
  var QUEEN_DIRS = [1, -1, 16, -16, 15, 17, -15, -17];

  // moving from / to one of these squares removes some castling rights
  var CASTLE_MASK = new Array(128).fill(15);
  CASTLE_MASK[0] = 15 & ~CWQ;
  CASTLE_MASK[7] = 15 & ~CWK;
  CASTLE_MASK[4] = 15 & ~(CWK | CWQ);
  CASTLE_MASK[112] = 15 & ~CBQ;
  CASTLE_MASK[119] = 15 & ~CBK;
  CASTLE_MASK[116] = 15 & ~(CBK | CBQ);

  function sqName(sq) {
    return FILES[sq & 7] + ((sq >> 4) + 1);
  }

  function nameToSq(name) {
    return (name.charCodeAt(1) - 49) * 16 + (name.charCodeAt(0) - 97);
  }

  function makeMove(from, to, piece, captured, promotion, flags) {
    return { from: from, to: to, piece: piece, captured: captured, promotion: promotion, flags: flags };
  }

  // ------------------------------------------------------------------------
  class Position {
    constructor(fen) {
      this.load(fen || START_FEN);
    }

    // ---- FEN -------------------------------------------------------------
    load(fen) {
      var parts = String(fen).trim().split(/\s+/);
      var rows = parts[0].split('/');
      if (rows.length !== 8) throw new Error('Invalid FEN: expected 8 ranks');

      this.board = new Array(128).fill(0);
      this.kingSq = [-1, -1];
      this.history = [];

      for (var r = 0; r < 8; r++) {
        var f = 0;
        for (var i = 0; i < rows[r].length; i++) {
          var ch = rows[r][i];
          if (ch >= '1' && ch <= '8') {
            f += parseInt(ch, 10);
          } else {
            var type = PIECE_CHARS.indexOf(ch.toUpperCase());
            if (type < 1 || f > 7) throw new Error('Invalid FEN piece placement');
            var color = ch === ch.toUpperCase() ? WHITE : BLACK;
            var sq = (7 - r) * 16 + f;
            this.board[sq] = type | (color << 3);
            if (type === K) this.kingSq[color] = sq;
            f++;
          }
        }
        if (f !== 8) throw new Error('Invalid FEN: rank ' + (8 - r) + ' does not have 8 files');
      }
      if (this.kingSq[0] < 0 || this.kingSq[1] < 0) throw new Error('Invalid FEN: both kings are required');

      this.turn = parts[1] === 'b' ? BLACK : WHITE;

      var c = parts[2] || '-';
      this.castling = 0;
      if (c.indexOf('K') >= 0) this.castling |= CWK;
      if (c.indexOf('Q') >= 0) this.castling |= CWQ;
      if (c.indexOf('k') >= 0) this.castling |= CBK;
      if (c.indexOf('q') >= 0) this.castling |= CBQ;
      // drop rights that do not match the pieces on the board
      var b = this.board;
      if (b[4] !== (K)) this.castling &= ~(CWK | CWQ);
      if (b[116] !== (K | 8)) this.castling &= ~(CBK | CBQ);
      if (b[7] !== R) this.castling &= ~CWK;
      if (b[0] !== R) this.castling &= ~CWQ;
      if (b[119] !== (R | 8)) this.castling &= ~CBK;
      if (b[112] !== (R | 8)) this.castling &= ~CBQ;

      this.ep = parts[3] && parts[3] !== '-' ? nameToSq(parts[3]) : -1;
      this.half = parseInt(parts[4], 10) || 0;
      this.full = parseInt(parts[5], 10) || 1;
    }

    fen() {
      var rows = [];
      for (var r = 7; r >= 0; r--) {
        var row = '', empty = 0;
        for (var f = 0; f < 8; f++) {
          var p = this.board[r * 16 + f];
          if (!p) {
            empty++;
          } else {
            if (empty) { row += empty; empty = 0; }
            var ch = PIECE_CHARS[p & 7];
            row += (p >> 3) ? ch.toLowerCase() : ch;
          }
        }
        if (empty) row += empty;
        rows.push(row);
      }
      var castling = (this.castling & CWK ? 'K' : '') + (this.castling & CWQ ? 'Q' : '') +
                     (this.castling & CBK ? 'k' : '') + (this.castling & CBQ ? 'q' : '');
      return rows.join('/') + ' ' + (this.turn ? 'b' : 'w') + ' ' + (castling || '-') + ' ' +
             (this.ep >= 0 ? sqName(this.ep) : '-') + ' ' + this.half + ' ' + this.full;
    }

    // ---- attacks ---------------------------------------------------------
    isAttacked(sq, by) {
      var b = this.board, cm = by << 3, s, i, d, p;

      // pawns
      if (by === WHITE) {
        s = sq - 15; if (!(s & 0x88) && b[s] === P) return true;
        s = sq - 17; if (!(s & 0x88) && b[s] === P) return true;
      } else {
        s = sq + 15; if (!(s & 0x88) && b[s] === (P | 8)) return true;
        s = sq + 17; if (!(s & 0x88) && b[s] === (P | 8)) return true;
      }
      // knights
      for (i = 0; i < 8; i++) {
        s = sq + KNIGHT_OFFSETS[i];
        if (!(s & 0x88) && b[s] === (N | cm)) return true;
      }
      // king
      for (i = 0; i < 8; i++) {
        s = sq + KING_OFFSETS[i];
        if (!(s & 0x88) && b[s] === (K | cm)) return true;
      }
      // bishops / queens (diagonals)
      for (i = 0; i < 4; i++) {
        d = BISHOP_DIRS[i];
        s = sq + d;
        while (!(s & 0x88)) {
          p = b[s];
          if (p) {
            if (p === (B | cm) || p === (Q | cm)) return true;
            break;
          }
          s += d;
        }
      }
      // rooks / queens (straight lines)
      for (i = 0; i < 4; i++) {
        d = ROOK_DIRS[i];
        s = sq + d;
        while (!(s & 0x88)) {
          p = b[s];
          if (p) {
            if (p === (R | cm) || p === (Q | cm)) return true;
            break;
          }
          s += d;
        }
      }
      return false;
    }

    inCheck() {
      return this.isAttacked(this.kingSq[this.turn], this.turn ^ 1);
    }

    // ---- move generation -------------------------------------------------
    /** Pseudo-legal moves (may leave own king in check). captureOnly = captures + promotions. */
    generate(captureOnly) {
      var moves = [], b = this.board, us = this.turn, them = us ^ 1;
      var fwd = us === WHITE ? 16 : -16;
      var startRank = us === WHITE ? 1 : 6;
      var promoRank = us === WHITE ? 6 : 1;
      var promoTypes = [Q, R, B, N];
      var sq, p, t, i, to, target, d, offs, dirs, rank, k;

      for (sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        p = b[sq];
        if (!p || (p >> 3) !== us) continue;
        t = p & 7;

        if (t === P) {
          rank = sq >> 4;
          // captures (including en passant)
          for (k = -1; k <= 1; k += 2) {
            to = sq + fwd + k;
            if (to & 0x88) continue;
            target = b[to];
            if (target && (target >> 3) === them) {
              if (rank === promoRank) {
                for (i = 0; i < 4; i++) moves.push(makeMove(sq, to, p, target, promoTypes[i], F_CAPTURE | F_PROMO));
              } else {
                moves.push(makeMove(sq, to, p, target, 0, F_CAPTURE));
              }
            } else if (!target && to === this.ep) {
              moves.push(makeMove(sq, to, p, P | (them << 3), 0, F_CAPTURE | F_EP));
            }
          }
          // pushes
          if (!captureOnly || rank === promoRank) {
            to = sq + fwd;
            if (!(to & 0x88) && !b[to]) {
              if (rank === promoRank) {
                for (i = 0; i < 4; i++) moves.push(makeMove(sq, to, p, 0, promoTypes[i], F_PROMO));
              } else {
                moves.push(makeMove(sq, to, p, 0, 0, 0));
                if (rank === startRank && !b[to + fwd]) moves.push(makeMove(sq, to + fwd, p, 0, 0, F_DOUBLE));
              }
            }
          }
        } else if (t === N || t === K) {
          offs = t === N ? KNIGHT_OFFSETS : KING_OFFSETS;
          for (i = 0; i < 8; i++) {
            to = sq + offs[i];
            if (to & 0x88) continue;
            target = b[to];
            if (!target) {
              if (!captureOnly) moves.push(makeMove(sq, to, p, 0, 0, 0));
            } else if ((target >> 3) === them) {
              moves.push(makeMove(sq, to, p, target, 0, F_CAPTURE));
            }
          }
          // castling
          if (t === K && !captureOnly) {
            var base = us === WHITE ? 0 : 112;
            if (sq === base + 4 && !this.isAttacked(sq, them)) {
              if ((this.castling & (us === WHITE ? CWK : CBK)) && !b[base + 5] && !b[base + 6] &&
                  !this.isAttacked(base + 5, them) && !this.isAttacked(base + 6, them)) {
                moves.push(makeMove(sq, base + 6, p, 0, 0, F_KCASTLE));
              }
              if ((this.castling & (us === WHITE ? CWQ : CBQ)) && !b[base + 3] && !b[base + 2] && !b[base + 1] &&
                  !this.isAttacked(base + 3, them) && !this.isAttacked(base + 2, them)) {
                moves.push(makeMove(sq, base + 2, p, 0, 0, F_QCASTLE));
              }
            }
          }
        } else {
          dirs = t === B ? BISHOP_DIRS : (t === R ? ROOK_DIRS : QUEEN_DIRS);
          for (i = 0; i < dirs.length; i++) {
            d = dirs[i];
            to = sq + d;
            while (!(to & 0x88)) {
              target = b[to];
              if (!target) {
                if (!captureOnly) moves.push(makeMove(sq, to, p, 0, 0, 0));
              } else {
                if ((target >> 3) === them) moves.push(makeMove(sq, to, p, target, 0, F_CAPTURE));
                break;
              }
              to += d;
            }
          }
        }
      }
      return moves;
    }

    /** Apply a move (it must come from generate()). Undo it with unmakeMove(). */
    makeMove(m) {
      var b = this.board, us = this.turn, them = us ^ 1;
      this.history.push({ move: m, castling: this.castling, ep: this.ep, half: this.half, full: this.full });

      b[m.to] = m.promotion ? (m.promotion | (us << 3)) : m.piece;
      b[m.from] = 0;
      if (m.flags & F_EP) b[m.to + (us === WHITE ? -16 : 16)] = 0;
      if (m.flags & F_KCASTLE) { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = 0; }
      if (m.flags & F_QCASTLE) { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = 0; }
      if ((m.piece & 7) === K) this.kingSq[us] = m.to;

      this.castling &= CASTLE_MASK[m.from] & CASTLE_MASK[m.to];

      // en-passant square: only remember it when an enemy pawn could really capture
      this.ep = -1;
      if (m.flags & F_DOUBLE) {
        var enemyPawn = P | (them << 3);
        var l = m.to - 1, r = m.to + 1;
        if ((!(l & 0x88) && b[l] === enemyPawn) || (!(r & 0x88) && b[r] === enemyPawn)) {
          this.ep = (m.from + m.to) >> 1;
        }
      }

      this.half = ((m.piece & 7) === P || m.captured) ? 0 : this.half + 1;
      if (us === BLACK) this.full++;
      this.turn = them;
    }

    unmakeMove() {
      var h = this.history.pop();
      var m = h.move, b = this.board;
      this.turn ^= 1;
      var us = this.turn, them = us ^ 1;

      b[m.from] = m.piece;
      if (m.flags & F_EP) {
        b[m.to] = 0;
        b[m.to + (us === WHITE ? -16 : 16)] = P | (them << 3);
      } else {
        b[m.to] = m.captured;
      }
      if (m.flags & F_KCASTLE) { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = 0; }
      if (m.flags & F_QCASTLE) { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = 0; }
      if ((m.piece & 7) === K) this.kingSq[us] = m.from;

      this.castling = h.castling;
      this.ep = h.ep;
      this.half = h.half;
      this.full = h.full;
    }

    /** Fully legal moves for the side to move. */
    legalMoves(captureOnly) {
      var out = [], us = this.turn, moves = this.generate(captureOnly);
      for (var i = 0; i < moves.length; i++) {
        this.makeMove(moves[i]);
        if (!this.isAttacked(this.kingSq[us], us ^ 1)) out.push(moves[i]);
        this.unmakeMove();
      }
      return out;
    }

    hasLegalMove() {
      var us = this.turn, moves = this.generate(false);
      for (var i = 0; i < moves.length; i++) {
        this.makeMove(moves[i]);
        var legal = !this.isAttacked(this.kingSq[us], us ^ 1);
        this.unmakeMove();
        if (legal) return true;
      }
      return false;
    }

    /** Counts leaf nodes - used to test the move generator against known values. */
    perft(depth) {
      if (depth === 0) return 1;
      var us = this.turn, moves = this.generate(false), nodes = 0;
      for (var i = 0; i < moves.length; i++) {
        this.makeMove(moves[i]);
        if (!this.isAttacked(this.kingSq[us], us ^ 1)) nodes += depth === 1 ? 1 : this.perft(depth - 1);
        this.unmakeMove();
      }
      return nodes;
    }

    // ---- game state ------------------------------------------------------
    insufficientMaterial() {
      var minors = 0, bishopColors = {}, bishops = 0;
      for (var sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        var p = this.board[sq];
        if (!p) continue;
        var t = p & 7;
        if (t === P || t === R || t === Q) return false;
        if (t === N) minors++;
        if (t === B) { minors++; bishops++; bishopColors[((sq >> 4) + (sq & 7)) & 1] = true; }
      }
      if (minors <= 1) return true;                        // K vs K, K+minor vs K
      if (minors === bishops && Object.keys(bishopColors).length === 1) return true; // only same-coloured bishops
      return false;
    }

    /** { over, result, reason }  result is '1-0', '0-1', '1/2-1/2' or null */
    status() {
      if (!this.hasLegalMove()) {
        if (this.inCheck()) return { over: true, result: this.turn === WHITE ? '0-1' : '1-0', reason: 'checkmate' };
        return { over: true, result: '1/2-1/2', reason: 'stalemate' };
      }
      if (this.insufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient material' };
      if (this.half >= 100) return { over: true, result: '1/2-1/2', reason: '50-move rule' };
      return { over: false, result: null, reason: null };
    }

    // ---- notation --------------------------------------------------------
    uci(m) {
      return sqName(m.from) + sqName(m.to) + (m.promotion ? PIECE_CHARS[m.promotion].toLowerCase() : '');
    }

    /** Find the legal move for a UCI string like 'e2e4' or 'e7e8q'. */
    moveFromUci(uci) {
      if (!uci || uci.length < 4) return null;
      var from = nameToSq(uci.slice(0, 2)), to = nameToSq(uci.slice(2, 4));
      var promo = uci.length > 4 ? PIECE_CHARS.indexOf(uci[4].toUpperCase()) : 0;
      var moves = this.legalMoves();
      for (var i = 0; i < moves.length; i++) {
        var m = moves[i];
        if (m.from === from && m.to === to && (m.promotion || 0) === promo) return m;
      }
      return null;
    }

    /** Find the legal move for the squares the user clicked ('e2','e4','q'). */
    moveFromSquares(fromName, toName, promoLetter) {
      return this.moveFromUci(fromName + toName + (promoLetter || ''));
    }

    /** Map of from-square -> list of to-squares, for highlighting on the board. */
    legalMap() {
      var map = {}, moves = this.legalMoves();
      for (var i = 0; i < moves.length; i++) {
        var from = sqName(moves[i].from), to = sqName(moves[i].to);
        if (!map[from]) map[from] = [];
        if (map[from].indexOf(to) < 0) map[from].push(to);
      }
      return map;
    }

    /** Standard Algebraic Notation of a legal move. */
    san(m, legal) {
      legal = legal || this.legalMoves();
      var s, t = m.piece & 7;

      if (m.flags & F_KCASTLE) {
        s = 'O-O';
      } else if (m.flags & F_QCASTLE) {
        s = 'O-O-O';
      } else if (t === P) {
        s = (m.captured ? FILES[m.from & 7] + 'x' : '') + sqName(m.to);
        if (m.promotion) s += '=' + PIECE_CHARS[m.promotion];
      } else {
        s = PIECE_CHARS[t];
        var rivals = legal.filter(function (o) {
          return o !== m && o.to === m.to && o.piece === m.piece && o.from !== m.from;
        });
        if (rivals.length) {
          var sameFile = rivals.some(function (o) { return (o.from & 7) === (m.from & 7); });
          var sameRank = rivals.some(function (o) { return (o.from >> 4) === (m.from >> 4); });
          if (!sameFile) s += FILES[m.from & 7];
          else if (!sameRank) s += String((m.from >> 4) + 1);
          else s += sqName(m.from);
        }
        s += (m.captured ? 'x' : '') + sqName(m.to);
      }

      this.makeMove(m);
      if (this.inCheck()) s += this.hasLegalMove() ? '+' : '#';
      this.unmakeMove();
      return s;
    }

    /** Find the legal move for a SAN string (also accepts 'e2e4', '0-0', 'e8Q'). */
    moveFromSan(san) {
      var s = String(san).trim().replace(/e\.p\.$/i, '').replace(/[+#!?]+$/g, '').replace(/0/g, 'O');
      var legal = this.legalMoves(), i, m;

      if (s === 'O-O' || s === 'O-O-O') {
        var flag = s === 'O-O' ? F_KCASTLE : F_QCASTLE;
        for (i = 0; i < legal.length; i++) if (legal[i].flags & flag) return legal[i];
        return null;
      }

      var parts = /^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([NBRQnbrq]))?$/.exec(s);
      if (!parts) return null;
      var type = parts[1] ? PIECE_CHARS.indexOf(parts[1]) : P;
      var fromFile = parts[2] ? parts[2].charCodeAt(0) - 97 : -1;
      var fromRank = parts[3] ? parseInt(parts[3], 10) - 1 : -1;
      var toSq = nameToSq(parts[4]);
      var promo = parts[5] ? PIECE_CHARS.indexOf(parts[5].toUpperCase()) : 0;

      var found = [];
      for (i = 0; i < legal.length; i++) {
        m = legal[i];
        if ((m.piece & 7) !== type || m.to !== toSq) continue;
        if (fromFile >= 0 && (m.from & 7) !== fromFile) continue;
        if (fromRank >= 0 && (m.from >> 4) !== fromRank) continue;
        if ((m.promotion || 0) !== promo) continue;
        if (type === P && fromFile < 0 && (m.from & 7) !== (m.to & 7)) continue; // "d5" is a push, not a capture
        found.push(m);
      }
      return found.length === 1 ? found[0] : null;
    }

    /** Everything the user interface needs to know about this position. */
    describe() {
      var st = this.status();
      return {
        fen: this.fen(),
        turn: this.turn === WHITE ? 'w' : 'b',
        inCheck: this.inCheck(),
        over: st.over,
        result: st.result,
        reason: st.reason,
        legal: st.over ? {} : this.legalMap()
      };
    }
  }

  // ------------------------------------------------------------------------
  // Helpers that work on FEN strings
  // ------------------------------------------------------------------------

  /** Position identity for repetition counting (first four FEN fields). */
  function positionKey(fen) {
    return fen.split(' ').slice(0, 4).join(' ');
  }

  /** Convert a list of UCI moves (engine principal variation) to SAN. */
  function uciLineToSan(fen, ucis, max) {
    var pos = new Position(fen), out = [];
    for (var i = 0; i < ucis.length && i < (max || 8); i++) {
      var m = pos.moveFromUci(ucis[i]);
      if (!m) break;
      out.push(pos.san(m));
      pos.makeMove(m);
    }
    return out;
  }

  // ------------------------------------------------------------------------
  // PGN
  // ------------------------------------------------------------------------
  function stripVariations(text) {
    var out = '', depth = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') { if (depth > 0) depth--; }
      else if (depth === 0) out += ch;
    }
    return out;
  }

  /**
   * Parse the first game of a PGN text.
   * Returns { headers, startFen, moves: [{san, uci, fen}], result, error }
   * If a move is illegal, parsing stops there and `error` explains why
   * (the moves before it are still returned).
   */
  function parsePgn(text) {
    var headers = {};
    var body = String(text || '').replace(/\r/g, '');
    var headerRe = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm;
    var match;
    while ((match = headerRe.exec(body)) !== null) {
      if (headers[match[1]] === undefined) headers[match[1]] = match[2].replace(/\\(["\\])/g, '$1');
    }

    // stop at a second game, if several were pasted
    var firstGameEnd = body.search(/\n\s*\n\s*\[Event\s/);
    if (firstGameEnd > 0) body = body.slice(0, firstGameEnd);

    var movetext = body.replace(headerRe, ' ');
    movetext = movetext.replace(/\{[^}]*\}/g, ' ');       // {comments}
    movetext = movetext.replace(/;[^\n]*/g, ' ');          // ; comments
    movetext = stripVariations(movetext);                  // (variations)
    movetext = movetext.replace(/\$\d+/g, ' ');            // $1 NAGs
    movetext = movetext.replace(/\d+\s*\.{1,3}/g, ' ');    // 12.  12...
    var tokens = movetext.split(/\s+/).filter(Boolean);

    var startFen = START_FEN;
    if (headers.FEN && (headers.SetUp === '1' || headers.SetUp === undefined)) startFen = headers.FEN;

    var result = { headers: headers, startFen: startFen, moves: [], result: headers.Result || '*', error: null };
    var pos;
    try {
      pos = new Position(startFen);
    } catch (e) {
      result.error = 'The FEN in this PGN is not valid.';
      return result;
    }

    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      if (tok === '1-0' || tok === '0-1' || tok === '1/2-1/2' || tok === '*') { result.result = tok; break; }
      var m = pos.moveFromSan(tok);
      if (!m) {
        result.error = 'Could not read move "' + tok + '" (after ' + result.moves.length + ' half-moves). The game may contain an illegal move.';
        break;
      }
      var san = pos.san(m);
      var uci = pos.uci(m);
      pos.makeMove(m);
      result.moves.push({ san: san, uci: uci, fen: pos.fen() });
    }
    return result;
  }

  root.Chess = {
    START_FEN: START_FEN,
    Position: Position,
    positionKey: positionKey,
    uciLineToSan: uciLineToSan,
    parsePgn: parsePgn,
    sqName: sqName,
    nameToSq: nameToSq,
    WHITE: WHITE, BLACK: BLACK,
    P: P, N: N, B: B, R: R, Q: Q, K: K,
    F_CAPTURE: F_CAPTURE, F_EP: F_EP, F_DOUBLE: F_DOUBLE, F_KCASTLE: F_KCASTLE, F_QCASTLE: F_QCASTLE, F_PROMO: F_PROMO
  };
})(typeof window !== 'undefined' ? window : globalThis);
