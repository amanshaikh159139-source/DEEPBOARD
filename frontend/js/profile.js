(function (root) {
  'use strict';
  var els = {};

  function games() { return window.Store ? Store.list() : []; }
  function appendText(parent, tag, className, value) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = value == null ? '' : String(value);
    parent.appendChild(el);
    return el;
  }
  function personalColor(g) {
    if (g && (g.playerColor === 'w' || g.playerColor === 'b')) return g.playerColor;
    if (g && g.source === 'bot') {
      if (g.white === 'You') return 'w';
      if (g.black === 'You') return 'b';
    }
    return null;
  }
  function counts() {
    var list = games(), w = 0, l = 0, d = 0, great = 0, best = 0, mistake = 0, blunder = 0;
    list.forEach(function (g) {
      var c = personalColor(g), result = g.result;
      if (result === '1/2-1/2' && c) d++;
      else if (c === 'w' && result === '1-0' || c === 'b' && result === '0-1') w++;
      else if (c === 'w' && result === '0-1' || c === 'b' && result === '1-0') l++;
      var classes = g.analysis && g.analysis.counts || {};
      ['w', 'b'].forEach(function (side) {
        var sc = classes[side] || {};
        great += Number(sc.excellent || 0); best += Number(sc.best || 0);
        mistake += Number(sc.mistake || 0); blunder += Number(sc.blunder || 0);
      });
    });
    return { g: list, w: w, l: l, d: d, great: great, best: best, mistake: mistake, blunder: blunder };
  }
  function addStat(label, value, sub) {
    var card = document.createElement('div'); card.className = 'stat-card';
    appendText(card, 'span', '', label); appendText(card, 'strong', '', value); appendText(card, 'small', '', sub);
    els.stats.appendChild(card);
  }
  function addResultRow(label, value, total, cls) {
    var row = document.createElement('div'); row.className = 'bar-row';
    appendText(row, 'span', '', label);
    var track = document.createElement('div'); track.className = 'bar-track' + (cls ? ' ' + cls : '');
    var fill = document.createElement('i'); fill.style.width = (total ? Math.round(value / total * 100) : 0) + '%'; track.appendChild(fill); row.appendChild(track);
    appendText(row, 'strong', '', value); els.results.appendChild(row);
  }
  function refresh() {
    if (!els.guest) return;
    var user = window.AuthView && AuthView.getUser();
    els.guest.hidden = !!user; els.content.hidden = !user;
    if (!user) return;
    var c = counts();
    els.name.textContent = user.username || 'Player';
    els.avatar.textContent = (user.username || 'D').slice(0, 1).toUpperCase();
    els.subtitle.textContent = 'DeepBoard member' + (user.created_at ? ' · Joined ' + String(user.created_at).slice(0, 10) : '');

    els.stats.replaceChildren();
    addStat('Games saved', c.g.length, 'in this browser');
    addStat('Wins', c.w, 'your bot games');
    addStat('Losses', c.l, 'your bot games');
    addStat('Draws', c.d, 'your bot games');
    addStat('Puzzle rating', localStorage.getItem('deepboard.puzzle.elo') || '800', 'practice rating');

    els.results.replaceChildren();
    var total = c.w + c.l + c.d;
    if (total) { addResultRow('Wins', c.w, total, ''); addResultRow('Losses', c.l, total, 'loss'); addResultRow('Draws', c.d, total, 'draw'); }
    else appendText(els.results, 'p', 'muted', 'Finish a bot game to see results.');

    els.moves.replaceChildren();
    [['Brilliant', 'Not classified'], ['Excellent', c.great], ['Best', c.best], ['Mistakes', c.mistake], ['Blunders', c.blunder]].forEach(function (item) {
      var row = document.createElement('div'); appendText(row, 'span', '', item[0]); appendText(row, 'strong', '', item[1]); els.moves.appendChild(row);
    });

    els.recent.replaceChildren();
    var recent = c.g.slice(0, 5);
    if (!recent.length) appendText(els.recent, 'p', 'muted', 'No saved games yet. Play a game or import a PGN to start your library.');
    recent.forEach(function (g) {
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'profile-game';
      appendText(btn, 'span', 'profile-result', g.result || '*');
      var info = document.createElement('span');
      appendText(info, 'strong', '', (g.white || 'White') + ' vs ' + (g.black || 'Black'));
      appendText(info, 'small', '', g.date || 'Saved game'); btn.appendChild(info);
      appendText(btn, 'span', '', 'Review ›');
      btn.addEventListener('click', function () { App.go('analyze', { entryId: g.id }); });
      els.recent.appendChild(btn);
    });
  }
  function init() {
    els = {
      guest: document.getElementById('profile-guest'), content: document.getElementById('profile-content'),
      name: document.getElementById('profile-name'), avatar: document.getElementById('profile-avatar'),
      subtitle: document.getElementById('profile-subtitle'), stats: document.getElementById('profile-stats'),
      results: document.getElementById('profile-results'), moves: document.getElementById('profile-moves'),
      recent: document.getElementById('profile-recent'), logout: document.getElementById('profile-logout')
    };
    els.logout.addEventListener('click', function () { AuthView.logout().catch(function (e) { U.toast(e.message, 'error'); }); });
  }
  root.ProfileView = { init: init, show: refresh, hide: function () {}, refresh: refresh };
})(window);
