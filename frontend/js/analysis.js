/*
 * analysis.js
 * ===========
 * The "Analyze" page.
 *
 *   1. choose a game   (paste PGN / upload a file / import from chess.com)
 *   2. the engine looks at every position  (progress bar, can be cancelled)
 *   3. review          (board, eval bar, move ratings, accuracy, eval graph)
 *
 * The maths for ratings and accuracy is in scoring.js.
 */
(function (root) {
  'use strict';

  var SAMPLE_PGN = [
    '[Event "A Night at the Opera"]', '[Site "Paris"]', '[Date "1858.??.??"]',
    '[White "Paul Morphy"]', '[Black "Duke of Brunswick and Count Isouard"]', '[Result "1-0"]', '',
    '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7',
    '8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7',
    '14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0'
  ].join('\n');

  var els = {};
  var board = null;
  var runToken = 0;            // changes whenever a run is cancelled or restarted
  var pendingFile = null;      // text of the uploaded .pgn
  var report = null;           // the game currently shown in the review
  var cur = 0;                 // position shown: 0 = start, n = after the last move

  var WEAK = { inaccuracy: true, mistake: true, blunder: true };   // ratings that show a "better move" arrow
  var CLASS_BY_ID = {};
  CONFIG.CLASSES.forEach(function (c) { CLASS_BY_ID[c.id] = c; });

  // ====================================================================== screens
  function showScreen(name) {
    els.input.hidden = name !== 'input';
    els.progress.hidden = name !== 'progress';
    els.report.hidden = name !== 'report';
  }

  // ====================================================================== step 1: inputs
  function setTab(name) {
    U.$$('.tab', els.root).forEach(function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    ['paste', 'upload', 'chesscom'].forEach(function (id) { U.$('#tab-' + id).hidden = id !== name; });
  }

  function currentSpeed() {
    var id = els.speed.value;
    return CONFIG.ANALYSIS_SPEEDS.filter(function (s) { return s.id === id; })[0] || CONFIG.ANALYSIS_SPEEDS[1];
  }

  function updateSpeedHint() { els.speedHint.textContent = currentSpeed().hint; }

  /** Read PGN text, check it, and start the engine. */
  function startFromPgn(text, meta) {
    meta = meta || {};
    var parsed = Chess.parsePgn(text);
    if (!parsed.moves.length) {
      U.toast(parsed.error || 'No moves found. Paste a PGN that contains at least one move.', 'error');
      return;
    }
    if (parsed.error) U.toast(parsed.error + ' The moves before it will be analyzed.', 'error');
    analyse(parsed, meta);
  }

  function loadChesscom(username) {
    var status = els.ccStatus;
    status.className = 'inline-status';
    U.clear(els.ccList);
    username = username.trim();
    if (!username) { status.textContent = 'Type a chess.com username first.'; status.classList.add('error'); return; }
    status.textContent = 'Looking for ' + username + '\'s recent games...';
    els.ccFind.disabled = true;

    Api.chesscomGames(username, CONFIG.CHESSCOM_MAX_GAMES).then(function (data) {
      if (!data.games.length) {
        status.textContent = 'No standard chess games found for ' + data.username + ' in the last months.';
        return;
      }
      status.textContent = 'Found ' + data.games.length + ' recent games from ' + data.username + '. Pick one to analyze.';
      data.games.forEach(function (g) { els.ccList.appendChild(ccRow(g, data.username)); });
    }).catch(function (err) {
      status.textContent = err.message;
      status.classList.add('error');
    }).then(function () { els.ccFind.disabled = false; });
  }

  function ccRow(g, username) {
    var outcome = g.outcome || 'draw';
    var label = { win: 'Win', loss: 'Loss', draw: 'Draw' }[outcome];
    var when = g.end_time ? U.formatDate(g.end_time * 1000) : '';
    var meta = [g.time_class, g.opening, g.reason, when].filter(Boolean).join(' · ');
    function player(p) { return p.username + (p.rating ? ' ' : ''); }
    var players = U.el('div', { class: 'cc-players' },
      player(g.white), U.el('span', { class: 'elo', text: g.white.rating ? '(' + g.white.rating + ')' : '' }),
      ' vs ',
      player(g.black), U.el('span', { class: 'elo', text: g.black.rating ? '(' + g.black.rating + ')' : '' }));
    return U.el('li', { class: 'cc-item' },
      U.el('span', { class: 'cc-outcome ' + outcome, text: label }),
      players,
      U.el('button', { type: 'button', class: 'btn small primary', text: 'Analyze', onclick: function () {
        startFromPgn(g.pgn, { source: 'chesscom', ref: g.url, orientation: g.my_color === 'black' ? 'b' : 'w', reason: g.reason, username: username });
      } }),
      U.el('div', { class: 'cc-meta', text: meta }));
  }

  // ====================================================================== step 2: engine
  function analyse(parsed, meta) {
    var token = ++runToken;
    var speed = currentSpeed();
    var fens = [parsed.startFen].concat(parsed.moves.map(function (m) { return m.fen; }));
    var total = fens.length;

    showScreen('progress');
    els.progressTitle.textContent = 'Analyzing ' + (parsed.headers.White || 'White') + ' vs ' + (parsed.headers.Black || 'Black');
    setProgress(0, total);

    var evals = new Array(total), best = new Array(total), pv = new Array(total);
    var index = 0;

    function finish() {
      var ucis = parsed.moves.map(function (m) { return m.uci; });
      var scored = Scoring.evaluateGame({ fens: fens, ucis: ucis, evals: evals, best: best });
      report = buildReport(parsed, meta, {
        speed: speed.id, engine: Engine.mode === 'stockfish' ? Engine.name : 'Built-in engine',
        evals: evals, best: best, pv: pv, classes: scored.classes, accuracy: scored.accuracy, counts: scored.counts
      });
      openReport();
    }

    function next() {
      if (token !== runToken) return;                    // cancelled
      if (index >= total) { finish(); return; }

      var i = index;
      var terminal = new Chess.Position(fens[i]).status();
      if (terminal.over) {
        // The game ended here: no engine needed.
        evals[i] = terminal.result === '1-0' ? 10000 : (terminal.result === '0-1' ? -10000 : 0);
        best[i] = null; pv[i] = [];
        step();
        return;
      }
      Engine.evaluate(fens[i], { movetime: speed.movetime }).then(function (r) {
        if (token !== runToken) return;
        evals[i] = U.evalToCp(r.cp, r.mate);
        best[i] = r.uci || null;
        pv[i] = (r.pv || []).slice(0, 6);
        step();
      }, function (err) {
        if (token !== runToken) return;
        showScreen('input');
        U.toast('The analysis stopped: ' + err.message, 'error');
      });
    }

    function step() {
      index++;
      setProgress(index, total);
      setTimeout(next, 0);
    }

    next();
  }

  function setProgress(done, total) {
    var pct = Math.round(done / total * 100);
    els.progressBar.style.width = pct + '%';
    els.progressTrack.setAttribute('aria-valuenow', String(pct));
    els.progressText.textContent = done < total
      ? 'Position ' + done + ' of ' + total + (Engine.mode === 'builtin' ? ' (built-in engine)' : '')
      : 'Finishing up...';
  }

  // ====================================================================== step 3: review
  function buildReport(parsed, meta, analysis) {
    var h = parsed.headers;
    return {
      headers: h, startFen: parsed.startFen, moves: parsed.moves, result: parsed.result || h.Result || '*',
      meta: meta || {}, analysis: analysis,
      startBlack: parsed.startFen.split(' ')[1] === 'b',
      startNumber: parseInt(parsed.startFen.split(' ')[5], 10) || 1
    };
  }

  function openReport() {
    var h = report.headers, a = report.analysis;
    showScreen('report');
    els.title.textContent = (h.White || 'White') + ' vs ' + (h.Black || 'Black');
    var bits = [];
    if (h.Date && h.Date.indexOf('?') < 0) bits.push(h.Date.replace(/\./g, '-'));
    if (report.result && report.result !== '*') bits.push('Result ' + report.result);
    bits.push(report.moves.length + ' half-moves');
    bits.push('Engine: ' + a.engine);
    els.subtitle.textContent = bits.join(' · ');
    if (a.engine === 'Built-in engine') {
      els.subtitle.appendChild(U.el('span', { text: ' (weaker than Stockfish, see the README to install it)' }));
    }

    board.setOrientation(report.meta.orientation || 'w');
    els.evalbar.classList.toggle('flipped', board.orientation === 'b');
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = report.meta.savedId ? 'Update saved game' : 'Save to history';

    renderBars();
    renderSummary();
    renderGraph();
    goTo(0);
  }

  function renderBars() {
    var bottom = board.orientation, top = bottom === 'w' ? 'b' : 'w';
    var a = report.analysis;
    function fill(prefix, color) {
      var name = (color === 'w' ? report.headers.White : report.headers.Black) || (color === 'w' ? 'White' : 'Black');
      var elo = color === 'w' ? report.headers.WhiteElo : report.headers.BlackElo;
      U.$('#an-' + prefix + '-name').textContent = name + (elo && elo !== '?' ? ' (' + elo + ')' : '');
      U.$('#an-' + prefix + '-swatch').className = 'swatch ' + (color === 'w' ? 'white' : 'black');
      var acc = a.accuracy[color];
      U.$('#an-' + prefix + '-acc').textContent = acc === null ? '' : acc.toFixed(1) + '% accuracy';
    }
    fill('top', top);
    fill('bottom', bottom);
  }

  function renderSummary() {
    var body = U.$('tbody', els.summary);
    U.clear(body);
    var a = report.analysis;
    var accRow = U.el('tr', null,
      U.el('td', { text: 'Accuracy' }),
      U.el('td', { text: a.accuracy.w === null ? '-' : a.accuracy.w.toFixed(1) }),
      U.el('td', { text: a.accuracy.b === null ? '-' : a.accuracy.b.toFixed(1) }));
    body.appendChild(accRow);
    CONFIG.CLASSES.forEach(function (c) {
      body.appendChild(U.el('tr', null,
        U.el('td', null, U.el('span', { class: 'key', style: 'background:' + c.color }), c.label),
        U.el('td', { text: String(a.counts.w[c.id] || 0) }),
        U.el('td', { text: String(a.counts.b[c.id] || 0) })));
    });
  }

  function fenAt(i) { return i === 0 ? report.startFen : report.moves[i - 1].fen; }

  function classAt(plyIndex) {      // plyIndex = move number - 1
    return CLASS_BY_ID[report.analysis.classes[plyIndex]] || null;
  }

  function goTo(i) {
    if (!report) return;
    cur = Math.max(0, Math.min(report.moves.length, i));
    var fen = fenAt(cur);
    var a = report.analysis;
    var move = cur > 0 ? report.moves[cur - 1] : null;
    var cls = move ? classAt(cur - 1) : null;

    // board
    var pos = new Chess.Position(fen);
    board.checkSquare = pos.inCheck() ? Chess.sqName(pos.kingSq[pos.turn]) : null;
    board.setBadge(move && cls ? { square: move.uci.slice(2, 4), mark: cls.mark, color: cls.color } : null);
    board.setPosition(fen, move ? [move.uci.slice(0, 2), move.uci.slice(2, 4)] : null, true);

    // arrow: what the engine preferred instead of the move that was played
    var arrows = [];
    if (move && cls && WEAK[cls.id] && a.best[cur - 1]) {
      var b = a.best[cur - 1];
      arrows.push({ from: b.slice(0, 2), to: b.slice(2, 4), color: '#1F9D6B' });
    }
    board.setArrows(arrows);

    renderEvalBar(a.evals[cur]);
    renderEngineLine(pos, move, cls);
    renderMoveList();
    renderMarker();

    els.btnFirst.disabled = els.btnPrev.disabled = cur === 0;
    els.btnNext.disabled = els.btnLast.disabled = cur === report.moves.length;
  }

  function renderEvalBar(cp) {
    var chance = Scoring.winChance(Math.max(-1000, Math.min(1000, cp)));
    els.evalFill.style.height = chance.toFixed(1) + '%';
    els.evalText.textContent = U.formatEvalFromCp(cp);
    els.evalbar.classList.toggle('black-ahead', cp < 0);
  }

  function renderEngineLine(pos, move, cls) {
    var box = els.engine;
    var a = report.analysis;
    U.clear(box);

    if (move && cls) {
      var verdict = U.el('div', { class: 'verdict' },
        U.el('span', { class: 'mark', style: 'background:' + cls.color, text: cls.mark }),
        U.el('span', { text: move.san + ' is ' + article(cls.label) + ' ' + cls.label.toLowerCase() }));
      box.appendChild(verdict);

      if (cls.id !== 'best' && a.best[cur - 1]) {
        var prevFen = fenAt(cur - 1);
        var line = Chess.uciLineToSan(prevFen, a.pv[cur - 1] && a.pv[cur - 1].length ? a.pv[cur - 1] : [a.best[cur - 1]], 4);
        var lead = WEAK[cls.id] ? 'Better was ' : 'Engine\'s first choice: ';
        box.appendChild(U.el('div', { class: 'line' }, lead, U.el('b', { text: line[0] || '' }), line.length > 1 ? '  (' + line.join(' ') + ')' : ''));
      } else if (pos.status().over) {
        box.appendChild(U.el('div', { class: 'line', text: endText(pos.status()) }));
      } else {
        var next = Chess.uciLineToSan(fenAt(cur), a.pv[cur] || [], 4);
        if (next.length) box.appendChild(U.el('div', { class: 'line' }, 'Engine line: ', U.el('b', { text: next.join(' ') }), '  (' + U.formatEvalFromCp(a.evals[cur]) + ')'));
      }
      return;
    }

    // start position (or no rating available)
    var st = pos.status();
    if (st.over) { box.appendChild(U.el('div', { class: 'line', text: endText(st) })); return; }
    box.appendChild(U.el('div', { class: 'verdict', text: cur === 0 ? 'Start of the game' : 'Position' }));
    var first = Chess.uciLineToSan(fenAt(cur), a.pv[cur] || [], 4);
    if (first.length) box.appendChild(U.el('div', { class: 'line' }, 'Engine line: ', U.el('b', { text: first.join(' ') }), '  (' + U.formatEvalFromCp(a.evals[cur]) + ')'));
  }

  function article(label) { return /^[AEIOU]/i.test(label) ? 'an' : 'a'; }

  function endText(st) {
    if (st.reason === 'checkmate') return 'Checkmate. ' + (st.result === '1-0' ? 'White' : 'Black') + ' wins.';
    return 'Draw by ' + st.reason + '.';
  }

  function renderMoveList() {
    var marks = report.analysis.classes.map(function (id) { return CLASS_BY_ID[id] || null; });
    U.renderMoveList(els.moves, report.moves, {
      current: cur - 1, marks: marks, onSelect: function (i) { goTo(i + 1); },
      startBlack: report.startBlack, startNumber: report.startNumber
    });
  }

  // ---- evaluation graph ------------------------------------------------------------
  var GRAPH_W = 1000, GRAPH_H = 150;

  function xFor(i) { var n = report.moves.length; return n ? i / n * GRAPH_W : 0; }
  function yFor(cp) { return (100 - Scoring.winChance(Math.max(-1000, Math.min(1000, cp)))) / 100 * GRAPH_H; }

  function renderGraph() {
    var a = report.analysis, n = report.moves.length;
    var line = '';
    for (var i = 0; i <= n; i++) line += (i ? 'L' : 'M') + xFor(i).toFixed(1) + ' ' + yFor(a.evals[i]).toFixed(1) + ' ';
    var area = line + 'L' + GRAPH_W + ' ' + GRAPH_H + ' L0 ' + GRAPH_H + ' Z';

    els.graph.innerHTML =
      '<svg viewBox="0 0 ' + GRAPH_W + ' ' + GRAPH_H + '" preserveAspectRatio="none" role="img" aria-label="Evaluation graph">' +
      '<rect width="' + GRAPH_W + '" height="' + GRAPH_H + '" fill="#2C3A49"/>' +
      '<path d="' + area + '" fill="#F8F6F1"/>' +
      '<path d="' + line + '" fill="none" stroke="#6D8CA3" stroke-width="2" vector-effect="non-scaling-stroke"/>' +
      '<line x1="0" x2="' + GRAPH_W + '" y1="' + GRAPH_H / 2 + '" y2="' + GRAPH_H / 2 + '" stroke="#6D8CA3" stroke-width="1" stroke-dasharray="6 6" vector-effect="non-scaling-stroke"/>' +
      '</svg>';

    // dots for the moves that lost the most, then the position marker
    a.classes.forEach(function (id, idx) {
      if (id !== 'mistake' && id !== 'blunder') return;
      var c = CLASS_BY_ID[id];
      var dot = U.el('span', { class: 'graph-dot', style: 'left:' + (xFor(idx + 1) / GRAPH_W * 100) + '%;top:' + (yFor(a.evals[idx + 1]) / GRAPH_H * 100) + '%;background:' + c.color, title: report.moves[idx].san + ' ' + c.mark });
      els.graph.appendChild(dot);
    });
    els.marker = U.el('span', { class: 'graph-marker' });
    els.graph.appendChild(els.marker);
  }

  function renderMarker() {
    if (!els.marker) return;
    els.marker.style.left = (xFor(cur) / GRAPH_W * 100) + '%';
  }

  // ====================================================================== saving
  function saveReport() {
    if (!report) return;
    var a = report.analysis;
    var stored = { speed: a.speed, engine: a.engine, evals: a.evals, best: a.best, pv: a.pv, classes: a.classes, accuracy: a.accuracy, counts: a.counts };
    var m = report.meta;
    var pgn = U.buildPgn({ headers: report.headers, startFen: report.startFen, moves: report.moves.map(function (x) { return x.san; }), result: report.result });
    var entry;

    if (m.savedId && Store.get(m.savedId)) {
      entry = Store.update(m.savedId, { analysis: stored });
    } else {
      entry = Store.add({
        source: m.source || 'pgn', ref: m.ref || null,
        white: report.headers.White || 'White', black: report.headers.Black || 'Black',
        result: report.result, reason: m.reason || report.headers.Termination || null,
        date: (report.headers.Date || '').replace(/\./g, '-') || new Date().toISOString().slice(0, 10),
        plies: report.moves.length, pgn: pgn, analysis: stored, orientation: m.orientation || 'w'
      });
    }
    if (entry) {
      m.savedId = entry.id;
      els.saveBtn.textContent = 'Saved. Update again';
      U.toast('Saved to History.');
    }
  }

  // ====================================================================== public
  function init() {
    els.root = U.$('#view-analyze');
    els.input = U.$('#analyze-input');
    els.progress = U.$('#analyze-progress');
    els.report = U.$('#analyze-report');
    els.speed = U.$('#speed');
    els.speedHint = U.$('#speed-hint');
    els.ccStatus = U.$('#cc-status');
    els.ccList = U.$('#cc-list');
    els.ccFind = U.$('#btn-cc-find');
    els.progressTitle = U.$('#progress-title');
    els.progressBar = U.$('#progress-bar');
    els.progressTrack = U.$('#progress-track');
    els.progressText = U.$('#progress-text');
    els.title = U.$('#an-title');
    els.subtitle = U.$('#an-subtitle');
    els.evalbar = U.$('#an-evalbar');
    els.evalFill = U.$('#an-evalfill');
    els.evalText = U.$('#an-evaltext');
    els.engine = U.$('#an-engine');
    els.moves = U.$('#an-moves');
    els.summary = U.$('#an-summary');
    els.graph = U.$('#an-graph');
    els.saveBtn = U.$('#an-save');
    els.btnFirst = U.$('#an-first'); els.btnPrev = U.$('#an-prev');
    els.btnNext = U.$('#an-next'); els.btnLast = U.$('#an-last');

    CONFIG.ANALYSIS_SPEEDS.forEach(function (s) {
      els.speed.appendChild(U.el('option', { value: s.id, selected: s.id === CONFIG.DEFAULT_SPEED, text: s.label }));
    });
    updateSpeedHint();
    els.speed.addEventListener('change', updateSpeedHint);

    board = new Board(U.$('#an-board'), { interactive: false });

    // tabs
    U.$$('.tab', els.root).forEach(function (t) { t.addEventListener('click', function () { setTab(t.getAttribute('data-tab')); }); });

    // paste
    U.$('#btn-run-paste').addEventListener('click', function () { startFromPgn(U.$('#pgn-text').value, { source: 'pgn' }); });
    U.$('#btn-sample').addEventListener('click', function () { U.$('#pgn-text').value = SAMPLE_PGN; });

    // upload
    var fileInput = U.$('#pgn-file'), runFile = U.$('#btn-run-file'), drop = U.$('.dropzone', els.root);
    function takeFile(file) {
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        pendingFile = String(reader.result || '');
        U.$('#file-name').textContent = file.name + ' (' + Math.round(file.size / 1024 * 10) / 10 + ' KB). Ready to analyze.';
        runFile.disabled = false;
      };
      reader.onerror = function () { U.toast('Could not read that file.', 'error'); };
      reader.readAsText(file);
    }
    fileInput.addEventListener('change', function () { takeFile(fileInput.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { takeFile(e.dataTransfer && e.dataTransfer.files[0]); });
    runFile.addEventListener('click', function () { if (pendingFile) startFromPgn(pendingFile, { source: 'pgn' }); });

    // chess.com
    U.$('#cc-form').addEventListener('submit', function (e) { e.preventDefault(); loadChesscom(U.$('#cc-user').value); });

    // progress + report buttons
    U.$('#btn-cancel').addEventListener('click', function () { runToken++; showScreen('input'); });
    U.$('#an-new').addEventListener('click', function () { report = null; showScreen('input'); });
    U.$('#an-first').addEventListener('click', function () { goTo(0); });
    U.$('#an-prev').addEventListener('click', function () { goTo(cur - 1); });
    U.$('#an-next').addEventListener('click', function () { goTo(cur + 1); });
    U.$('#an-last').addEventListener('click', function () { goTo(report ? report.moves.length : 0); });
    U.$('#an-flip').addEventListener('click', function () {
      board.flip();
      els.evalbar.classList.toggle('flipped', board.orientation === 'b');
      if (report) { renderBars(); goTo(cur); }
    });
    els.saveBtn.addEventListener('click', saveReport);
    U.$('#an-pgn').addEventListener('click', function () {
      if (!report) return;
      var pgn = U.buildPgn({ headers: report.headers, startFen: report.startFen, moves: report.moves.map(function (m) { return m.san; }), result: report.result });
      U.download('deepboard-analysis.pgn', pgn, 'application/x-chess-pgn');
    });

    // click on the graph
    els.graph.addEventListener('click', function (e) {
      if (!report) return;
      var rect = els.graph.getBoundingClientRect();
      goTo(Math.round((e.clientX - rect.left) / rect.width * report.moves.length));
    });

    // keyboard
    document.addEventListener('keydown', function (e) {
      if (els.root.hidden || els.report.hidden || !report) return;
      var tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (e.key === 'ArrowLeft') { goTo(cur - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { goTo(cur + 1); e.preventDefault(); }
      else if (e.key === 'Home') { goTo(0); e.preventDefault(); }
      else if (e.key === 'End') { goTo(report.moves.length); e.preventDefault(); }
    });

    showScreen('input');
  }

  root.AnalyzeView = {
    init: init,

    /** param can be { pgn, source, savedId }  (from Play) or { entryId } (from History) */
    show: function (param) {
      if (!param) return;
      if (param.entryId) { this.openSaved(param.entryId); return; }
      if (param.pgn) startFromPgn(param.pgn, { source: param.source, savedId: param.savedId });
    },

    /** Show a saved game's review without running the engine again. */
    openSaved: function (id) {
      var entry = Store.get(id);
      if (!entry) { U.toast('That game is not in your history any more.', 'error'); return; }
      var parsed = Chess.parsePgn(entry.pgn);
      if (!parsed.moves.length) { U.toast('That saved game could not be read.', 'error'); return; }
      var meta = { source: entry.source, ref: entry.ref, savedId: entry.id, orientation: entry.orientation || 'w', reason: entry.reason };
      if (entry.analysis && entry.analysis.evals && entry.analysis.evals.length === parsed.moves.length + 1) {
        report = buildReport(parsed, meta, entry.analysis);
        openReport();
      } else {
        startFromPgn(entry.pgn, meta);
      }
    },

    hide: function () { /* a running analysis keeps going in the background */ }
  };
})(window);
