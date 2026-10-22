/*
 * utils.js
 * ========
 * Small helpers used by several files: DOM shortcuts, safe localStorage,
 * toast messages, downloading files, PGN building, evaluation maths.
 */
(function (root) {
  'use strict';

  var U = {};

  // ---- DOM ----------------------------------------------------------------
  U.$ = function (selector, scope) { return (scope || document).querySelector(selector); };
  U.$$ = function (selector, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(selector)); };

  /** el('div', {class:'x', onclick: fn}, child, 'text', ...) */
  U.el = function (tag, attrs) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.slice(0, 2) === 'on' && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
    }
    return node;
  };

  U.clear = function (node) { while (node.firstChild) node.removeChild(node.firstChild); return node; };

  U.escape = function (text) {
    return String(text === null || text === undefined ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  // ---- storage (never throws - private windows can block localStorage) ----------
  U.load = function (key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  };
  U.save = function (key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  };

  // ---- toast ------------------------------------------------------------------
  var toastTimer = null;
  U.toast = function (message, kind) {
    var box = document.getElementById('toast');
    if (!box) return;
    box.textContent = message;
    box.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.className = 'toast'; }, 3600);
  };

  // ---- files --------------------------------------------------------------------
  U.download = function (filename, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 500);
  };

  U.copy = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  };
  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }

  // ---- misc ---------------------------------------------------------------------
  U.uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  U.sleep = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };

  U.formatDate = function (timestamp) {
    var d = new Date(timestamp);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // ---- PGN ----------------------------------------------------------------------
  /**
   * Build PGN text.
   * game = { headers: {White:..}, startFen?, moves: [san...], result }
   */
  U.buildPgn = function (game) {
    var h = Object.assign({
      Event: 'DeepBoard game', Site: 'DeepBoard (local)',
      Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      Round: '-', White: 'White', Black: 'Black', Result: game.result || '*'
    }, game.headers || {});
    h.Result = game.result || h.Result || '*';
    if (game.startFen && game.startFen !== Chess.START_FEN) { h.SetUp = '1'; h.FEN = game.startFen; }

    var order = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
    Object.keys(h).forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
    var text = order.map(function (k) { return '[' + k + ' "' + String(h[k]).replace(/(["\\])/g, '\\$1') + '"]'; }).join('\n');

    var startFull = 1, startBlack = false;
    if (game.startFen) {
      var f = game.startFen.split(' ');
      startBlack = f[1] === 'b';
      startFull = parseInt(f[5], 10) || 1;
    }
    var out = [], number = startFull;
    game.moves.forEach(function (san, i) {
      var blackMove = (i % 2 === 1) !== startBlack;
      if (!blackMove) out.push(number + '. ' + san);
      else { out.push(i === 0 ? number + '... ' + san : san); number++; }
    });
    out.push(game.result || '*');
    return text + '\n\n' + out.join(' ') + '\n';
  };

  // ---- evaluation maths -----------------------------------------------------------
  /** Engine result {cp, mate} (White's point of view) -> one centipawn number. */
  U.evalToCp = function (cp, mate) {
    if (mate !== null && mate !== undefined) return mate > 0 ? 10000 - mate : -10000 - mate;
    return cp === null || cp === undefined ? 0 : cp;
  };

  /** Win chance (0-100) for White from centipawns - same curve lichess uses. */
  U.winChance = function (cp) {
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  };

  /** Text like "+0.35", "-1.20", "M3" or "-M2" for an evaluation. */
  U.formatEval = function (cp, mate) {
    if (mate !== null && mate !== undefined) return (mate > 0 ? 'M' : '-M') + Math.abs(mate);
    if (cp === null || cp === undefined) return '0.0';
    var v = cp / 100;
    return (v > 0 ? '+' : '') + v.toFixed(1);
  };

  U.formatEvalFromCp = function (cp) {
    if (Math.abs(cp) >= 10000) return cp > 0 ? '1-0' : '0-1';   // the game is over (checkmate on the board)
    if (Math.abs(cp) >= 9000) {
      var m = 10000 - Math.abs(cp);
      return (cp > 0 ? 'M' : '-M') + Math.max(1, m);
    }
    return U.formatEval(cp, null);
  };

  /** Material for each colour from a FEN; used for captured pieces display. */
  var VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  U.material = function (fen) {
    var placement = fen.split(' ')[0];
    var start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    var have = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (var i = 0; i < placement.length; i++) {
      var ch = placement[i];
      if (/[pnbrq]/i.test(ch)) have[ch === ch.toUpperCase() ? 'w' : 'b'][ch.toLowerCase()]++;
    }
    var score = { w: 0, b: 0 };
    var captured = { w: [], b: [] }; // captured[w] = WHITE pieces that were captured
    ['w', 'b'].forEach(function (c) {
      ['q', 'r', 'b', 'n', 'p'].forEach(function (t) {
        score[c] += have[c][t] * VALUES[t];
        var lost = Math.max(0, start[t] - have[c][t]); // promotions can make this negative
        for (var k = 0; k < lost; k++) captured[c].push(t);
      });
    });
    return { score: score, diff: score.w - score.b, captured: captured };
  };

  // ---- move list ------------------------------------------------------------------
  /**
   * Draw a two-column move list into an <ol>.
   *   moves  : [{ san }, ...]
   *   opts   : { current: index of the highlighted ply (-1 = none),
   *              onSelect: function (plyIndex)   (makes moves clickable),
   *              marks: [classObject | null, ...] (move-quality marks, same length as moves),
   *              startBlack: true if the game starts with Black to move,
   *              startNumber: first move number (default 1),
   *              emptyText: text when there are no moves }
   */
  U.renderMoveList = function (ol, moves, opts) {
    opts = opts || {};
    var current = opts.current === undefined ? moves.length - 1 : opts.current;
    var offset = opts.startBlack ? 1 : 0;
    var firstNumber = opts.startNumber || 1;
    U.clear(ol);

    if (!moves.length) {
      ol.appendChild(U.el('li', { class: 'movelist-empty', text: opts.emptyText || 'No moves yet.' }));
      return;
    }

    function cell(index) {
      var move = moves[index];
      if (!move) return U.el('span', { class: 'mv' });
      var mark = opts.marks && opts.marks[index];
      var kids = [move.san];
      if (mark && mark.id !== 'best' && mark.id !== 'good' && mark.id !== 'excellent') {
        kids.push(U.el('span', { class: 'mark', style: 'color:' + mark.color, text: mark.mark }));
      }
      var cls = 'mv' + (index === current ? ' current' : '');
      var label = move.san + (mark ? ', ' + mark.label : '');
      if (opts.onSelect) {
        return U.el.apply(null, ['button', { type: 'button', class: cls, 'aria-label': label, 'data-ply': index, onclick: function () { opts.onSelect(index); } }].concat(kids));
      }
      return U.el.apply(null, ['span', { class: cls, 'data-ply': index }].concat(kids));
    }

    var total = moves.length + offset;
    for (var rowStart = 0; rowStart < total; rowStart += 2) {
      var whiteIndex = rowStart - offset, blackIndex = rowStart + 1 - offset;
      var row = U.el('li', { class: 'mv-row' },
        U.el('span', { class: 'no', text: String(firstNumber + rowStart / 2) + '.' }),
        whiteIndex >= 0 ? cell(whiteIndex) : U.el('span', { class: 'mv', text: '...' }),
        blackIndex < moves.length ? cell(blackIndex) : U.el('span', { class: 'mv' }));
      ol.appendChild(row);
    }

    var active = ol.querySelector('.mv.current');
    if (active) {
      var top = active.offsetTop - ol.offsetTop, bottom = top + active.offsetHeight;
      if (top < ol.scrollTop) ol.scrollTop = Math.max(0, top - 8);
      else if (bottom > ol.scrollTop + ol.clientHeight) ol.scrollTop = bottom - ol.clientHeight + 8;
    } else if (opts.current === undefined || current >= moves.length - 1) {
      ol.scrollTop = ol.scrollHeight;
    }
  };

  /** Fill a player bar's "captured pieces" box and material number. */
  U.renderCaptured = function (capturedEl, materialEl, fen, color) {
    var m = U.material(fen);
    var opp = color === 'w' ? 'b' : 'w';
    U.clear(capturedEl);
    var lost = m.captured[opp];          // types of the opponent's pieces this side has taken
    var lastType = null;
    lost.forEach(function (type) {
      if (lastType && lastType !== type) capturedEl.appendChild(U.el('span', { class: 'gap' }));
      capturedEl.appendChild(U.el('span', { class: 'cap', html: Pieces.svg(opp === 'w' ? type.toUpperCase() : type) }));
      lastType = type;
    });
    var lead = color === 'w' ? m.diff : -m.diff;
    materialEl.textContent = lead > 0 ? '+' + lead : '';
  };

  root.U = U;
})(window);
