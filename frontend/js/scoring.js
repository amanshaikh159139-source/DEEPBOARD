/*
 * scoring.js
 * ==========
 * Turns the engine's evaluations into move ratings and accuracy scores.
 * No screen code in here - it is just maths, so it is easy to test and tweak.
 *
 * Inputs for a game with n moves:
 *   fens   n+1 positions        (before move 1, after move 1, ... after move n)
 *   ucis   n moves played       ('e2e4', ...)
 *   evals  n+1 evaluations      centipawns from WHITE's point of view
 *                               (mate scores are about +-10000, see U.evalToCp)
 *   best   n+1 engine best moves (UCI) for each of those positions, or null
 *
 * How a move is rated
 * -------------------
 *   centipawn loss = what the mover could have had  -  what they actually got
 *   (both from the mover's point of view, each clamped to +-EVAL_CLAMP)
 *   The loss is compared with the limits in CONFIG.CLASSES
 *   (Best <= 5, Excellent <= 25, Good <= 50, Inaccuracy <= 100, Mistake <= 250, else Blunder).
 *   Playing the engine's first choice is always "Best".
 *
 * How accuracy is calculated
 * --------------------------
 *   Each move gets a score from how much WIN CHANCE it gave away
 *   (same curve and formula as lichess), and a player's accuracy is the
 *   average of their move scores, from 0 to 100.
 */
(function (root) {
  'use strict';

  function winChance(cp) {
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  }

  function clamp(value, limit) {
    return Math.max(-limit, Math.min(limit, value));
  }

  /** 0-100 score for one move, given the mover's win chance before and after it. */
  function moveAccuracy(winBefore, winAfter) {
    var score = 103.1668 * Math.exp(-0.04354 * (winBefore - winAfter)) - 3.1669;  // published curve without an extra bonus
    return Math.max(0, Math.min(100, score));
  }

  function classFor(loss, classes) {
    for (var i = 0; i < classes.length; i++) if (loss <= classes[i].max) return classes[i];
    return classes[classes.length - 1];
  }

  function emptyCounts(classes) {
    var counts = {};
    classes.forEach(function (c) { counts[c.id] = 0; });
    return counts;
  }

  function evaluateGame(game, options) {
    options = options || {};
    var classes = options.classes || root.CONFIG.CLASSES;
    var limit = options.clamp || root.CONFIG.EVAL_CLAMP;
    var n = game.ucis.length;

    var out = {
      classes: [], losses: [], moveAccuracy: [],
      counts: { w: emptyCounts(classes), b: emptyCounts(classes) },
      accuracy: { w: null, b: null }
    };
    var sums = { w: 0, b: 0 }, played = { w: 0, b: 0 };

    for (var i = 0; i < n; i++) {
      var color = game.fens[i].split(' ')[1] === 'b' ? 'b' : 'w';
      var sign = color === 'w' ? 1 : -1;

      var beforeRaw = sign * game.evals[i];
      var afterRaw = sign * game.evals[i + 1];
      var loss = Math.max(0, clamp(beforeRaw, limit) - clamp(afterRaw, limit));
      var isEngineMove = !!game.best[i] && game.best[i] === game.ucis[i];
      if (isEngineMove) loss = 0;

      var cls = classFor(loss, classes);
      var acc = isEngineMove ? 100 : moveAccuracy(winChance(beforeRaw), winChance(afterRaw));

      out.classes.push(cls.id);
      out.losses.push(Math.round(loss));
      out.moveAccuracy.push(acc);
      out.counts[color][cls.id]++;
      sums[color] += acc;
      played[color]++;
    }

    ['w', 'b'].forEach(function (c) {
      out.accuracy[c] = played[c] ? Math.round(sums[c] / played[c] * 10) / 10 : null;
    });
    return out;
  }

  root.Scoring = { evaluateGame: evaluateGame, moveAccuracy: moveAccuracy, winChance: winChance, classFor: classFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Scoring;
})(typeof window !== 'undefined' ? window : globalThis);
