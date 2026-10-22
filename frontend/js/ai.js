/*
 * ai.js
 * =====
 * A small built-in chess engine that runs inside the browser.
 *
 * It is used automatically when Stockfish is not installed on the backend
 * (or when the backend is not running), so the app always works.  It is far
 * weaker than Stockfish, but fine for casual games and quick analysis.
 *
 * Technique: iterative deepening negamax with alpha-beta pruning, check
 * extensions, quiescence search, MVV-LVA / killer-move ordering and a simple
 * evaluation (material + piece-square tables + bishop pair).
 */
(function (root) {
  'use strict';

  var Position = root.Chess.Position;
  var MATE = 100000, INF = 1000000;
  var VALUE = [0, 100, 320, 330, 500, 900, 0];

  // Piece-square tables, written from White's point of view with rank 8 first.
  var PST_PAWN = [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0];
  var PST_KNIGHT = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50];
  var PST_BISHOP = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20];
  var PST_ROOK = [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0];
  var PST_QUEEN = [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20];
  var PST_KING_MID = [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20];
  var PST_KING_END = [
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50];
  var PST = [null, PST_PAWN, PST_KNIGHT, PST_BISHOP, PST_ROOK, PST_QUEEN];

  /** Static evaluation in centipawns from the point of view of the side to move. */
  function evaluate(pos) {
    var b = pos.board, score = 0, npm = 0, wBishops = 0, bBishops = 0;
    var wk = pos.kingSq[0], bk = pos.kingSq[1];

    for (var sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = b[sq];
      if (!p) continue;
      var t = p & 7;
      if (t === 6) continue;
      var color = p >> 3;
      var idx = color === 0 ? (((7 - (sq >> 4)) << 3) + (sq & 7)) : (((sq >> 4) << 3) + (sq & 7));
      var v = VALUE[t] + PST[t][idx];
      if (t !== 1) npm += VALUE[t];
      if (t === 3) { if (color === 0) wBishops++; else bBishops++; }
      score += color === 0 ? v : -v;
    }
    if (wBishops >= 2) score += 30;
    if (bBishops >= 2) score -= 30;

    var kingTable = npm <= 2600 ? PST_KING_END : PST_KING_MID;
    score += kingTable[((7 - (wk >> 4)) << 3) + (wk & 7)] - kingTable[((bk >> 4) << 3) + (bk & 7)];

    return pos.turn === 0 ? score : -score;
  }

  function scoreMoves(moves, killers) {
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], s = 0;
      if (m.captured) s = 10000 + 10 * VALUE[m.captured & 7] - VALUE[m.piece & 7];
      if (m.promotion) s += 9000 + VALUE[m.promotion];
      if (!m.captured && !m.promotion && killers) {
        if (killers[0] && killers[0].from === m.from && killers[0].to === m.to) s = 8000;
        else if (killers[1] && killers[1].from === m.from && killers[1].to === m.to) s = 7000;
      }
      m.score = s;
    }
    moves.sort(function (a, b) { return b.score - a.score; });
  }

  function Searcher(pos) {
    this.pos = pos;
    this.nodes = 0;
    this.deadline = Infinity;
    this.stopped = false;
    this.killers = [];
    for (var i = 0; i < 64; i++) this.killers.push([null, null]);
  }

  Searcher.prototype.tick = function () {
    if ((++this.nodes & 2047) === 0 && Date.now() > this.deadline) this.stopped = true;
  };

  Searcher.prototype.quiesce = function (alpha, beta, qDepth) {
    this.tick();
    if (this.stopped) return 0;
    var pos = this.pos, us = pos.turn;
    var stand = evaluate(pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qDepth > 8) return alpha;

    var moves = pos.generate(true);
    scoreMoves(moves, null);
    for (var i = 0; i < moves.length; i++) {
      pos.makeMove(moves[i]);
      if (pos.isAttacked(pos.kingSq[us], us ^ 1)) { pos.unmakeMove(); continue; }
      var score = -this.quiesce(-beta, -alpha, qDepth + 1);
      pos.unmakeMove();
      if (this.stopped) return 0;
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  Searcher.prototype.search = function (depth, alpha, beta, ply) {
    this.tick();
    if (this.stopped) return 0;
    var pos = this.pos, us = pos.turn;
    var inCheck = pos.inCheck();
    if (inCheck && ply < 24) depth++;               // check extension
    if (depth <= 0) return this.quiesce(alpha, beta, 0);
    if (pos.half >= 100) return 0;                   // 50-move rule

    var moves = pos.generate(false);
    scoreMoves(moves, this.killers[ply] || null);
    var legal = 0, best = -INF;

    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      pos.makeMove(m);
      if (pos.isAttacked(pos.kingSq[us], us ^ 1)) { pos.unmakeMove(); continue; }
      legal++;
      var score = -this.search(depth - 1, -beta, -alpha, ply + 1);
      pos.unmakeMove();
      if (this.stopped) return 0;
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (!m.captured && this.killers[ply]) {
          this.killers[ply][1] = this.killers[ply][0];
          this.killers[ply][0] = m;
        }
        break;
      }
    }
    if (legal === 0) return inCheck ? -MATE + ply : 0;
    return best;
  };

  /**
   * Search a position.
   * options: { maxDepth, timeMs }
   * Returns { uci, cp, mate, depth, pv }   (cp / mate from White's point of view)
   * or null when the side to move has no legal move.
   */
  function searchSync(fen, options) {
    options = options || {};
    var maxDepth = options.maxDepth || 4;
    var timeMs = options.timeMs || 500;

    var pos = new Position(fen);
    var rootMoves = pos.legalMoves();
    if (!rootMoves.length) return null;

    var searcher = new Searcher(pos);
    searcher.deadline = Date.now() + timeMs;

    var bestMove = rootMoves[0], bestScore = 0, doneDepth = 0;
    var us = pos.turn;

    for (var depth = 1; depth <= maxDepth; depth++) {
      scoreMoves(rootMoves, null);
      var idx = rootMoves.indexOf(bestMove);          // search last iteration's best move first
      if (idx > 0) { rootMoves.splice(idx, 1); rootMoves.unshift(bestMove); }

      var alpha = -INF, iterBest = null, iterScore = -INF;
      for (var i = 0; i < rootMoves.length; i++) {
        pos.makeMove(rootMoves[i]);
        var score = -searcher.search(depth - 1, -INF, -alpha, 1);
        pos.unmakeMove();
        if (searcher.stopped) break;
        if (score > iterScore) { iterScore = score; iterBest = rootMoves[i]; }
        if (score > alpha) alpha = score;
      }
      if (searcher.stopped) break;                    // unfinished iteration: ignore it
      bestMove = iterBest;
      bestScore = iterScore;
      doneDepth = depth;
      if (Math.abs(bestScore) > MATE - 200) break;    // forced mate found
      if (Date.now() > searcher.deadline) break;
    }

    var whiteScore = us === 0 ? bestScore : -bestScore;
    var result = { uci: pos.uci(bestMove), cp: null, mate: null, depth: doneDepth, pv: [pos.uci(bestMove)] };
    if (Math.abs(bestScore) > MATE - 200) {
      var movesToMate = (MATE - Math.abs(bestScore) + 1) >> 1;
      result.mate = whiteScore > 0 ? movesToMate : -movesToMate;
    } else {
      result.cp = whiteScore;
    }
    return result;
  }

  // Strength of each "Play vs Bot" level when Stockfish is not available.
  var LEVEL_SETTINGS = [
    null,
    { maxDepth: 1, timeMs: 60 },    // 1
    { maxDepth: 2, timeMs: 80 },    // 2
    { maxDepth: 3, timeMs: 150 },   // 3
    { maxDepth: 3, timeMs: 250 },   // 4
    { maxDepth: 4, timeMs: 400 },   // 5
    { maxDepth: 5, timeMs: 900 },   // 6
    { maxDepth: 6, timeMs: 1500 }   // 7 - strongest local fallback
  ];

  // The searches below are synchronous; the short timeout lets the browser
  // repaint ("Bot is thinking...") before the search starts.
  function later(fn) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try { resolve(fn()); } catch (e) { reject(e); }
      }, 25);
    });
  }

  root.BuiltinAI = {
    evaluate: evaluate,
    searchSync: searchSync,
    bestMove: function (fen, level) {
      var s = LEVEL_SETTINGS[Math.max(1, Math.min(7, level || 3))];
      return later(function () { return searchSync(fen, s); });
    },
    evaluatePosition: function (fen, timeMs) {
      return later(function () { return searchSync(fen, { maxDepth: 6, timeMs: timeMs || 300 }); });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
