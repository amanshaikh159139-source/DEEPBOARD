/*
 * history.js
 * ==========
 * The "History" page: every saved game, with buttons to review, download or delete it.
 */
(function (root) {
  'use strict';

  var els = {};

  var SOURCE_LABELS = {
    'bot': 'Played against the bot',
    'two-player': 'Two players',
    'chesscom': 'chess.com',
    'pgn': 'PGN'
  };

  function render() {
    var games = Store.list();
    U.clear(els.list);
    els.empty.hidden = games.length > 0;
    els.clear.hidden = games.length === 0;

    games.forEach(function (g) {
      var moves = Math.ceil((g.plies || 0) / 2);
      var meta = [];
      meta.push(U.el('span', { class: 'tag', text: SOURCE_LABELS[g.source] || 'Game' }));
      meta.push(' · ' + (g.date && g.date.indexOf('?') < 0 ? g.date : U.formatDate(g.savedAt)));
      meta.push(' · ' + moves + (moves === 1 ? ' move' : ' moves'));
      if (g.reason) meta.push(' · ' + g.reason);
      if (g.analysis && g.analysis.accuracy && g.analysis.accuracy.w !== null) {
        meta.push(' · Accuracy ' + g.analysis.accuracy.w.toFixed(1) + ' / ' + (g.analysis.accuracy.b === null ? '-' : g.analysis.accuracy.b.toFixed(1)));
      }

      var item = U.el('li', { class: 'hist-item' },
        U.el('span', { class: 'hist-result', text: g.result || '*' }),
        U.el.apply(null, ['div', { class: 'hist-title', text: (g.white || 'White') + ' vs ' + (g.black || 'Black') }]),
        U.el('div', { class: 'hist-actions' },
          U.el('button', { type: 'button', class: 'btn small primary', text: g.analysis ? 'Review' : 'Analyze', onclick: function () { App.go('analyze', { entryId: g.id }); } }),
          U.el('button', { type: 'button', class: 'btn small', text: 'PGN', title: 'Download as PGN', onclick: function () {
            U.download('deepboard-' + (g.date || 'game') + '.pgn', g.pgn, 'application/x-chess-pgn');
          } }),
          U.el('button', { type: 'button', class: 'btn small danger', text: 'Delete', onclick: function () {
            if (!window.confirm('Delete this game from your history?')) return;
            Store.remove(g.id);
            render();
          } })));
      var metaBox = U.el.apply(null, ['div', { class: 'hist-meta' }].concat(meta));
      item.insertBefore(metaBox, item.querySelector('.hist-actions'));
      els.list.appendChild(item);
    });
  }

  root.HistoryView = {
    init: function () {
      els.list = U.$('#history-list');
      els.empty = U.$('#history-empty');
      els.clear = U.$('#btn-history-clear');
      els.clear.addEventListener('click', function () {
        if (window.confirm('Delete ALL saved games? This cannot be undone.')) { Store.clear(); render(); }
      });
    },
    show: render,
    hide: function () {}
  };
})(window);
