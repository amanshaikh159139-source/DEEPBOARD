(function (root) {
  'use strict';
  var board, pos, els = {}, idx = 0, solved = 0, attempts = 0;
  var rating = Number(localStorage.getItem('deepboard.puzzle.elo') || 800);
  var done = false, hinted = false, waiting = false, lineIndex = 0, timer = null;
  var playerColor = Chess.WHITE;

  // Curated, local tactics. Each FEN and UCI solution line was checked using
  // this project's legal-move generator before being added.
  var PUZZLES = [
    { title: 'Queen mate', theme: 'Checkmate', objective: 'Mate in one', description: 'White to move. Find the queen move that finishes the game.', fen: '7k/8/5KQ1/8/8/8/8/8 w - - 0 1', solution: ['g6g7'], hint: 'The queen can give check on g7, protected by the king.', rating: 900 },
    { title: 'Win the queen with check', theme: 'Tactical capture', objective: 'Win a queen', description: 'White to move. Find the forcing rook capture that wins Black’s queen and checks the king.', fen: '4k3/8/8/4q3/8/8/4R3/4K3 w - - 0 1', solution: ['e2e5'], hint: 'Can your rook capture the queen and give check against the king at once?', rating: 850 },
    { title: 'Knight fork', theme: 'Fork', objective: 'Win a rook', description: 'Use a knight fork to attack the king and rook together.', fen: '3k3r/8/8/4N3/8/8/P6P/4K3 w - - 0 1', solution: ['e5f7', 'd8c8', 'f7h8'], hint: 'Find a knight move that checks the king and attacks the rook on h8.', rating: 1200 },
    { title: 'Rook takes the queen', theme: 'Tactical capture', objective: 'Win a queen', description: 'Black is giving check. Look for a rook capture that wins the queen.', fen: '4k3/8/8/8/8/8/3q4/3RK3 w - - 0 1', solution: ['d1d2'], hint: 'Your rook is next to the checking queen.', rating: 800 },
    { title: 'Bishop removes the attacker', theme: 'Defence and material', objective: 'Win a queen', description: 'Your king is in check. Resolve it by capturing the queen with a bishop.', fen: '4k3/8/8/4q3/8/8/PB5P/4K3 w - - 0 1', solution: ['b2e5'], hint: 'Your bishop can capture the queen along the diagonal.', rating: 850 },
    { title: 'Rook wins the queen', theme: 'Tactical capture', objective: 'Win a queen', description: "Black's queen checks your king. Find the rook capture.", fen: '4k3/8/8/q7/8/8/R7/4K3 w - - 0 1', solution: ['a2a5'], hint: 'Trace the rook up the a-file to the checking queen.', rating: 900 }
  ];

  function current() { return PUZZLES[idx % PUZZLES.length]; }
  function saveStats() {
    localStorage.setItem('deepboard.puzzle.elo', String(rating));
    localStorage.setItem('deepboard.puzzle.solved', String(solved));
    localStorage.setItem('deepboard.puzzle.attempts', String(attempts));
    els.rating.textContent = String(rating); els.solved.textContent = String(solved); els.attempts.textContent = String(attempts);
  }
  function paintStatus(text, type) {
    els.status.className = 'status' + (type ? ' puzzle-' + type : '');
    els.status.textContent = text;
  }
  function paint() {
    if (timer) clearTimeout(timer); timer = null;
    var puzzle = current();
    pos = new Chess.Position(puzzle.fen); playerColor = pos.turn;
    lineIndex = 0; done = false; hinted = false; waiting = false;
    board.setOrientation(playerColor === Chess.WHITE ? 'w' : 'b');
    board.setArrows([]); board.setHint([]); board.setInteractive(true);
    board.setPosition(pos.fen());
    els.title.textContent = puzzle.title; els.theme.textContent = puzzle.theme;
    els.description.textContent = puzzle.description; els.objective.textContent = puzzle.objective;
    paintStatus('Find the best move.'); saveStats();
  }
  function legal(from) {
    if (done || waiting || pos.turn !== playerColor) return [];
    return pos.legalMoves().filter(function (m) { return Chess.sqName(m.from) === from; }).map(function (m) { return Chess.sqName(m.to); });
  }
  function finishPuzzle() {
    done = true; waiting = false; board.setInteractive(false); board.setArrows([]); board.setHint([]);
    solved++; rating += hinted ? 4 : Math.max(6, Math.round((current().rating || 800) / 100));
    saveStats(); paintStatus('Correct! Tactic solved. +' + (hinted ? 4 : Math.max(6, Math.round((current().rating || 800) / 100))) + ' puzzle rating.', 'success');
    if (window.U) U.toast('Puzzle solved!', 'success');
  }
  function applySolutionMove(uci) {
    var move = pos.moveFromUci(uci);
    if (!move) { done = true; waiting = false; board.setInteractive(false); paintStatus('Puzzle data error: an expected move was illegal. Please reset this puzzle.', 'error'); return false; }
    var from = uci.slice(0, 2), to = uci.slice(2, 4);
    pos.makeMove(move); lineIndex++;
    board.setPosition(pos.fen(), [from, to], true);
    return true;
  }
  function attempted(from, to) {
    if (done || waiting || pos.turn !== playerColor) return;
    var expected = current().solution[lineIndex];
    var uci = from + to;
    attempts++;
    if (uci !== expected) {
      rating = Math.max(100, rating - 5); saveStats();
      board.setArrows([]); board.setHint([]);
      paintStatus('Not the best move. Look for a check, capture, or direct threat.', 'error');
      return;
    }
    if (!applySolutionMove(uci)) { saveStats(); return; }
    board.setArrows([]); board.setHint([]);
    if (lineIndex >= current().solution.length) { finishPuzzle(); return; }
    waiting = true; board.setInteractive(false); paintStatus('Good move. Follow the opponent’s response…');
    timer = setTimeout(function () {
      timer = null;
      if (done) return;
      var reply = current().solution[lineIndex];
      if (pos.turn === playerColor || !reply) { finishPuzzle(); return; }
      if (!applySolutionMove(reply)) { saveStats(); return; }
      if (lineIndex >= current().solution.length) { finishPuzzle(); return; }
      waiting = false; board.setInteractive(true); paintStatus('Find the next move in the combination.', 'success');
    }, window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420);
  }
  function showHint() {
    if (done || waiting) return;
    hinted = true;
    var uci = current().solution[lineIndex];
    if (uci) {
      board.setArrows([{ from: uci.slice(0, 2), to: uci.slice(2, 4), color: '#21865B' }]);
      board.setHint([uci.slice(0, 2)]);
    }
    paintStatus(current().hint + ' (Using a hint reduces the rating reward.)');
  }
  function showSolution() {
    if (done) return;
    if (timer) clearTimeout(timer); timer = null;
    done = true; waiting = true; board.setInteractive(false); board.setArrows([]); board.setHint([]);
    pos = new Chess.Position(current().fen); lineIndex = 0; board.setPosition(pos.fen());
    var moves = current().solution.slice();
    function next() {
      if (!moves.length) { waiting = false; paintStatus('Solution shown. Reset the position or move to the next puzzle.'); return; }
      var uci = moves.shift();
      if (!applySolutionMove(uci)) { waiting = false; return; }
      timer = setTimeout(next, window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 460);
    }
    paintStatus('Showing the solution…'); next();
  }
  function init() {
    els = {
      title: document.getElementById('puzzle-title'), theme: document.getElementById('puzzle-theme'),
      description: document.getElementById('puzzle-description'), objective: document.getElementById('puzzle-objective'),
      status: document.getElementById('puzzle-status'), rating: document.getElementById('puzzle-rating'),
      solved: document.getElementById('puzzle-solved'), attempts: document.getElementById('puzzle-attempts'),
      next: document.getElementById('puzzle-next'), hint: document.getElementById('puzzle-hint'),
      solution: document.getElementById('puzzle-solution'), reset: document.getElementById('puzzle-reset')
    };
    solved = Number(localStorage.getItem('deepboard.puzzle.solved') || 0);
    attempts = Number(localStorage.getItem('deepboard.puzzle.attempts') || 0);
    board = new Board(document.getElementById('puzzle-board'), {
      orientation: 'w', interactive: true,
      canSelect: function (sq) { return !done && !waiting && pos.turn === playerColor && legal(sq).length > 0; },
      getTargets: legal, onMove: attempted
    });
    els.next.addEventListener('click', function () { idx = (idx + 1) % PUZZLES.length; paint(); });
    els.hint.addEventListener('click', showHint);
    els.solution.addEventListener('click', showSolution);
    els.reset.addEventListener('click', paint);
    saveStats(); paint();
  }
  root.PuzzleView = { init: init, show: function () { paint(); }, hide: function () { if (timer) clearTimeout(timer); timer = null; } };
})(window);
