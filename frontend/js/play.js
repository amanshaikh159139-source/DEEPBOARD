/*
 * play.js
 * =======
 * The "Play" page: a game against the bot, or two people on the same screen.
 *
 * The rules come from chess-rules.js, the board drawing from board.js and the
 * bot's moves from api.js (Stockfish if available, built-in engine otherwise).
 */
(function (root) {
  'use strict';

  var els = {};
  var board = null;

  var game = null;   // the game in progress (see newGame)
  var prefs = { mode: 'bot', side: 'white', level: 3, nameWhite: '', nameBlack: '', autoFlip: false };

  // ------------------------------------------------------------------ helpers
  function colorName(c) { return c === 'w' ? 'White' : 'Black'; }
  function other(c) { return c === 'w' ? 'b' : 'w'; }
  function turnColor() { return game.pos.turn === Chess.WHITE ? 'w' : 'b'; }

  function isHumanTurn() {
    if (!game || game.over) return false;
    return game.mode === 'two' || turnColor() === game.myColor;
  }

  function savePrefs() { U.save(CONFIG.STORAGE.playPrefs, prefs); }

  function readForm() {
    prefs.side = (U.$('input[name="side"]:checked', els.form) || {}).value || 'white';
    prefs.level = parseInt(els.level.value, 10) || 4;
    prefs.nameWhite = els.nameWhite.value.trim();
    prefs.nameBlack = els.nameBlack.value.trim();
    prefs.autoFlip = els.autoFlip.checked;
  }

  function writeForm() {
    var radio = U.$('input[name="side"][value="' + prefs.side + '"]', els.form);
    if (radio) radio.checked = true;
    els.level.value = prefs.level;
    els.nameWhite.value = prefs.nameWhite;
    els.nameBlack.value = prefs.nameBlack;
    els.autoFlip.checked = !!prefs.autoFlip;
    updateLevelLabel();
    setMode(prefs.mode, true);
  }

  function updateLevelLabel() {
    var info = CONFIG.BOT_LEVELS[parseInt(els.level.value, 10)] || CONFIG.BOT_LEVELS[4];
    els.levelName.textContent = info.name;
    els.levelHint.textContent = info.hint;
    var avatar = document.getElementById('bot-avatar');
    var botName = document.getElementById('bot-profile-name');
    var strength = document.getElementById('bot-profile-strength');
    if (avatar) { avatar.src = 'assets/bots/' + info.avatar; avatar.alt = info.name + ' avatar'; }
    if (botName) botName.textContent = info.name.split(' · ')[0];
    if (strength) strength.textContent = info.rating ? 'Approximate strength ' + info.rating : 'Full-strength engine · varies by setup';
  }

  function setMode(mode, silent) {
    prefs.mode = mode;
    U.$$('.seg button', els.root).forEach(function (b) {
      var on = b.getAttribute('data-mode') === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    els.botFields.hidden = mode !== 'bot';
    els.twoFields.hidden = mode !== 'two';
    els.btnHint.hidden = mode !== 'bot';
    els.btnDraw.hidden = mode !== 'two';
    if (!silent) savePrefs();
  }

  // ------------------------------------------------------------------ game lifecycle
  function newGame() {
    readForm();
    savePrefs();

    var myColor = prefs.side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : (prefs.side === 'black' ? 'b' : 'w');
    var level = prefs.level;
    var names;
    if (prefs.mode === 'bot') {
      var botName = 'Bot (' + CONFIG.BOT_LEVELS[level].name + ')';
      names = myColor === 'w' ? { w: 'You', b: botName } : { w: botName, b: 'You' };
    } else {
      names = { w: prefs.nameWhite || 'White', b: prefs.nameBlack || 'Black' };
    }

    var pos = new Chess.Position();
    game = {
      id: (game ? game.id : 0) + 1,       // lets us ignore a bot answer that arrives after "New game"
      mode: prefs.mode, myColor: myColor, level: level, names: names,
      pos: pos, startFen: pos.fen(),
      moves: [],                          // [{ san, uci, fen }]
      keys: [Chess.positionKey(pos.fen())],
      over: false, result: null, reason: null,
      thinking: false, savedId: null
    };

    board.setOrientation(game.mode === 'bot' ? myColor : 'w');
    els.root.classList.toggle('bot-focus', game.mode === 'bot');
    var resultOverlay = document.getElementById('game-result-overlay');
    if (resultOverlay) resultOverlay.hidden = true;
    board.setArrows([]);
    board.setHint([]);
    refresh(false, null);

    if (game.mode === 'bot' && turnColor() !== game.myColor) botMove();
  }

  /** Redraw everything that depends on the position. */
  function refresh(animate, lastMove) {
    var pos = game.pos;
    var fen = pos.fen();
    board.checkSquare = pos.inCheck() && !game.over ? Chess.sqName(pos.kingSq[pos.turn]) : null;
    board.setPosition(fen, lastMove || lastMoveOf(), animate);

    game.legal = game.over ? {} : pos.legalMap();
    renderBars(fen);
    renderMoves();
    renderStatus();
    renderButtons();
    board.setInteractive(isHumanTurn());
  }

  function lastMoveOf() {
    var last = game.moves[game.moves.length - 1];
    return last ? [last.uci.slice(0, 2), last.uci.slice(2, 4)] : null;
  }

  function renderBars(fen) {
    var bottom = board.orientation, top = other(bottom);
    function fill(prefix, color) {
      U.$('#play-' + prefix + '-name').textContent = game.names[color];
      var sw = U.$('#play-' + prefix + '-swatch');
      sw.className = 'swatch ' + (color === 'w' ? 'white' : 'black');
      U.renderCaptured(U.$('#play-' + prefix + '-captured'), U.$('#play-' + prefix + '-material'), fen, color);
    }
    fill('top', top);
    fill('bottom', bottom);
  }

  function renderMoves() {
    U.renderMoveList(els.moves, game.moves, { emptyText: 'The moves will appear here.' });
  }

  function renderStatus() {
    var box = els.status;
    box.className = 'status';
    var pos = game.pos, turn = turnColor();

    if (game.over) {
      box.classList.add('over');
      var winner = game.result === '1-0' ? 'w' : (game.result === '0-1' ? 'b' : null);
      var head;
      if (winner) head = capitalise(game.reason) + '. ' + game.names[winner] + ' wins.';
      else head = 'Draw by ' + game.reason + '.';
      box.innerHTML = '';
      box.appendChild(document.createTextNode(head));
      box.appendChild(U.el('span', { class: 'sub', text: 'Result ' + game.result + (game.savedId ? '. Saved to History.' : '.') }));
      return;
    }

    if (game.thinking) { box.textContent = game.names[turn] + ' is thinking...'; return; }

    var text;
    if (game.mode === 'bot') text = pos.inCheck() ? 'Check. Your move.' : 'Your move.';
    else text = (pos.inCheck() ? 'Check. ' : '') + game.names[turn] + ' to move (' + colorName(turn) + ').';
    box.textContent = text;
    if (pos.inCheck()) box.classList.add('warn');
  }

  function capitalise(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function renderButtons() {
    var minPlies = game.mode === 'bot' && game.myColor === 'b' ? 1 : 0;   // the bot's first move cannot be undone
    var noMoves = game.moves.length === 0;
    els.btnUndo.disabled = game.moves.length <= minPlies;
    els.btnHint.disabled = !isHumanTurn();
    els.btnResign.disabled = game.over || noMoves;
    els.btnDraw.disabled = game.over || noMoves;
    els.btnAnalyze.disabled = noMoves;
    els.btnCopy.disabled = noMoves;
    els.btnDownload.disabled = noMoves;
  }

  // ------------------------------------------------------------------ moves
  function onBoardMove(from, to) {
    if (!isHumanTurn()) return;
    var candidates = game.pos.legalMoves().filter(function (m) { return Chess.sqName(m.from) === from && Chess.sqName(m.to) === to; });
    if (!candidates.length) return;

    if (candidates[0].promotion) {
      board.askPromotion(turnColor()).then(function (letter) {
        if (!letter) { refresh(false, null); return; }
        var chosen = candidates.filter(function (m) { return game.pos.uci(m).slice(4) === letter; })[0];
        if (chosen) commit(chosen, true);
      });
    } else {
      commit(candidates[0], false);
    }
  }

  /** Apply a legal move, update the screen, then end the game or hand over to the bot. */
  function commit(move, animate) {
    var pos = game.pos;
    var san = pos.san(move);
    var uci = pos.uci(move);
    pos.makeMove(move);
    var fen = pos.fen();
    game.moves.push({ san: san, uci: uci, fen: fen });
    game.keys.push(Chess.positionKey(fen));

    var status = pos.status();
    var repeats = game.keys.filter(function (k) { return k === game.keys[game.keys.length - 1]; }).length;
    if (!status.over && repeats >= 3) status = { over: true, result: '1/2-1/2', reason: 'repetition' };

    board.setArrows([]);
    board.setHint([]);
    if (status.over) {
      finish(status.result, status.reason);
      refresh(animate, [uci.slice(0, 2), uci.slice(2, 4)]);
      return;
    }

    // two players: optionally turn the board to face the player who moves next
    if (game.mode === 'two' && prefs.autoFlip) board.setOrientation(turnColor());

    refresh(animate, [uci.slice(0, 2), uci.slice(2, 4)]);
    if (game.mode === 'bot' && turnColor() !== game.myColor) botMove();
  }

  function botMove() {
    var id = game.id;
    game.thinking = true;
    board.setInteractive(false);
    renderStatus();
    renderButtons();

    var fen = game.pos.fen();
    var started = Date.now();
    Engine.bestMove(fen, game.level).then(function (res) {
      // wait a moment so very fast answers do not feel instant
      return U.sleep(Math.max(0, 450 - (Date.now() - started))).then(function () { return res; });
    }).then(function (res) {
      if (!game || game.id !== id || game.over) return;
      var move = res && res.uci ? game.pos.moveFromUci(res.uci) : null;
      if (!move) {
        game.thinking = false;
        refresh(false, null);
        U.toast('The engine returned no legal move. Check the position or engine status and try again.', 'error');
        return;
      }
      game.thinking = false;
      commit(move, true);
    }).catch(function (err) {
      if (!game || game.id !== id) return;
      game.thinking = false;
      refresh(false, null);
      U.toast('Bot calculation failed: ' + err.message + '. The board is unchanged; try again or check engine status.', 'error');
    });
  }

  function showResultOverlay() {
    if (!game || game.mode !== 'bot') return;
    var overlay = document.getElementById('game-result-overlay');
    var card = document.getElementById('game-result-card');
    if (!overlay || !card) return;
    var winner = game.result === '1-0' ? 'w' : (game.result === '0-1' ? 'b' : null);
    var isDraw = !winner;
    var won = winner === game.myColor;
    card.classList.remove('result-win', 'result-loss', 'result-draw');
    card.classList.add(isDraw ? 'result-draw' : (won ? 'result-win' : 'result-loss'));
    document.getElementById('game-result-kicker').textContent = isDraw ? 'DRAW GAME' : (won ? 'VICTORY' : 'GOOD GAME');
    document.getElementById('game-result-title').textContent = isDraw ? 'A draw!' : (won ? 'You won!' : 'Keep practising!');
    document.getElementById('game-result-message').textContent = isDraw
      ? 'Well played. Try a different plan in the rematch.'
      : (won ? 'Great work. Your tactics made the difference.' : 'Every game is a lesson. Review the key moments and try again.');
    document.getElementById('result-rematch').textContent = 'Play again';
    overlay.hidden = false;
  }

  function finish(result, reason) {
    if (!game || game.over) return;
    game.over = true;
    game.result = result;
    game.reason = reason;
    game.thinking = false;
    board.setInteractive(false);
    if (game.moves.length >= 2) {
      var entry = Store.add(historyEntry());
      game.savedId = entry.id;
    }
    showResultOverlay();
  }

  // ------------------------------------------------------------------ buttons
  function undo() {
    if (!game || !game.moves.length) return;
    game.id++;                       // ignore any bot answer still on its way
    game.thinking = false;
    var plies = 1;
    if (game.mode === 'bot') {
      // Always go back to the human's turn.
      //  - it is the human's turn now (bot already replied): take back the bot's reply AND the human's move
      //  - it is the bot's turn (still thinking, or the human just ended the game): take back only the human's move
      plies = turnColor() === game.myColor ? 2 : 1;
      var minPlies = game.myColor === 'b' ? 1 : 0;                 // the bot's opening move as White stays
      if (game.moves.length - plies < minPlies) plies = game.moves.length - minPlies;
    }
    if (plies < 1) return;
    for (var i = 0; i < plies; i++) { game.pos.unmakeMove(); game.moves.pop(); game.keys.pop(); }
    if (game.over && game.savedId) { Store.remove(game.savedId); game.savedId = null; }
    game.over = false; game.result = null; game.reason = null;
    board.setArrows([]); board.setHint([]);
    if (game.mode === 'two' && prefs.autoFlip) board.setOrientation(turnColor());
    refresh(false, null);
    if (game.mode === 'bot' && turnColor() !== game.myColor) botMove();
  }

  function resign() {
    if (!game || game.over || !game.moves.length) return;
    var loser = game.mode === 'bot' ? game.myColor : turnColor();
    var who = game.mode === 'bot' ? 'You' : game.names[loser];
    if (!window.confirm(who + (game.mode === 'bot' ? ' resign' : ' resigns') + '. Are you sure?')) return;
    game.id++;
    finish(loser === 'w' ? '0-1' : '1-0', 'resignation');
    refresh(false, null);
  }

  function agreeDraw() {
    if (!game || game.over || !game.moves.length) return;
    if (!window.confirm('Do both players agree to a draw?')) return;
    finish('1/2-1/2', 'agreement');
    refresh(false, null);
  }

  function hint() {
    if (!isHumanTurn()) return;
    var id = game.id, fen = game.pos.fen();
    els.btnHint.disabled = true;
    Engine.evaluate(fen, { movetime: 600 }).then(function (r) {
      if (!game || game.id !== id || game.over || game.pos.fen() !== fen) return;
      if (!r || !r.uci) { U.toast('No hint available for this position.'); return; }
      var from = r.uci.slice(0, 2), to = r.uci.slice(2, 4);
      board.setArrows([{ from: from, to: to, color: '#1B5A73' }]);
      board.setHint([from]);
      var move = game.pos.moveFromUci(r.uci);
      els.status.className = 'status';
      els.status.textContent = 'Hint: ' + (move ? game.pos.san(move) : r.uci) + ' (' + U.formatEval(r.cp, r.mate) + ' for White).';
    }).catch(function (e) { U.toast(e.message, 'error'); }).then(function () { if (game) renderButtons(); });
  }

  function pgnText() {
    var result = game.over ? game.result : '*';
    return U.buildPgn({
      headers: {
        Event: game.mode === 'bot' ? 'DeepBoard - game against the bot' : 'DeepBoard - two players',
        White: game.names.w, Black: game.names.b,
        Termination: game.over ? game.reason : 'unterminated'
      },
      moves: game.moves.map(function (m) { return m.san; }),
      result: result
    });
  }

  function historyEntry() {
    return {
      source: game.mode === 'bot' ? 'bot' : 'two-player',
      white: game.names.w, black: game.names.b,
      playerColor: game.mode === 'bot' ? game.myColor : null,
      result: game.result, reason: game.reason,
      date: new Date().toISOString().slice(0, 10),
      plies: game.moves.length, pgn: pgnText(), analysis: null
    };
  }

  function sendToAnalysis() {
    if (!game || !game.moves.length) return;
    App.go('analyze', { pgn: pgnText(), source: game.mode === 'bot' ? 'bot' : 'two-player', savedId: game.savedId });
  }

  // ------------------------------------------------------------------ public
  root.PlayView = {
    init: function () {
      els.root = U.$('#view-play');
      els.form = U.$('#play-setup');
      els.botFields = U.$('#bot-fields');
      els.twoFields = U.$('#two-fields');
      els.level = U.$('#level-range');
      els.levelName = U.$('#level-name');
      els.levelHint = U.$('#level-hint');
      els.nameWhite = U.$('#name-white');
      els.nameBlack = U.$('#name-black');
      els.autoFlip = U.$('#auto-flip');
      els.status = U.$('#play-status');
      els.moves = U.$('#play-moves');
      els.btnUndo = U.$('#btn-undo');
      els.btnHint = U.$('#btn-hint');
      els.btnDraw = U.$('#btn-draw');
      els.btnResign = U.$('#btn-resign');
      els.btnAnalyze = U.$('#btn-analyze');
      els.btnCopy = U.$('#btn-pgn-copy');
      els.btnDownload = U.$('#btn-pgn-download');

      var saved = U.load(CONFIG.STORAGE.playPrefs, null);
      if (saved && typeof saved === 'object') prefs = Object.assign(prefs, saved);

      board = new Board(U.$('#play-board'), {
        interactive: false,
        canSelect: function (sq) { return isHumanTurn() && !!game.legal[sq]; },
        getTargets: function (sq) { return (game && game.legal && game.legal[sq]) || []; },
        onMove: onBoardMove
      });

      writeForm();

      U.$$('.seg button', els.root).forEach(function (b) {
        b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
      });
      els.level.addEventListener('input', updateLevelLabel);
      els.form.addEventListener('submit', function (e) { e.preventDefault(); newGame(); });

      els.btnUndo.addEventListener('click', undo);
      els.btnHint.addEventListener('click', hint);
      els.btnDraw.addEventListener('click', agreeDraw);
      els.btnResign.addEventListener('click', resign);
      U.$('#btn-flip').addEventListener('click', function () { board.flip(); if (game) renderBars(game.pos.fen()); });
      els.btnAnalyze.addEventListener('click', sendToAnalysis);
      els.btnCopy.addEventListener('click', function () {
        if (!game) return;
        U.copy(pgnText()).then(function (ok) { U.toast(ok ? 'PGN copied.' : 'Could not copy. Use Download PGN instead.', ok ? '' : 'error'); });
      });
      els.btnDownload.addEventListener('click', function () {
        if (!game) return;
        U.download('deepboard-game.pgn', pgnText(), 'application/x-chess-pgn');
      });
      document.getElementById('result-rematch').addEventListener('click', function () { newGame(); });
      document.getElementById('result-review').addEventListener('click', function () {
        var overlay = document.getElementById('game-result-overlay'); overlay.hidden = true; sendToAnalysis();
      });
      document.getElementById('result-home').addEventListener('click', function () {
        document.getElementById('game-result-overlay').hidden = true; App.go('home');
      });

      newGame();      // a game is ready as soon as the page opens
    },

    show: function () { /* nothing to resume: the game keeps running in the background */ },
    hide: function () { /* a bot that is thinking finishes its move even if you look at another page */ }
  };
})(window);
