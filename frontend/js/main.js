/*
 * main.js
 * =======
 * Starts the app: page routing (#/home, #/play, #/analyze, #/history),
 * the engine badge in the header and the board colour picker.
 */
(function (root) {
  'use strict';

  var VIEWS = {
    home: HomeView,
    play: PlayView,
    analyze: AnalyzeView,
    history: HistoryView,
    profile: ProfileView,
    puzzle: PuzzleView,
    openings: OpeningsView,
    auth: AuthView
  };
  var TITLES = { home: 'DeepBoard - play, analyze and review chess', play: 'Play - DeepBoard', analyze: 'Analyze - DeepBoard', history: 'History - DeepBoard', profile: 'Profile - DeepBoard', puzzle: 'Deep Puzzle - DeepBoard', openings: 'Openings - DeepBoard', auth: 'Sign in - DeepBoard' };

  var current = null;
  var pendingParam = null;

  function routeFromHash() {
    var name = (location.hash || '').replace(/^#\/?/, '').split(/[?\/]/)[0];
    return VIEWS[name] ? name : 'home';
  }

  function render() {
    var name = routeFromHash();
    var param = pendingParam;
    pendingParam = null;

    if (current && current !== name) VIEWS[current].hide();
    Object.keys(VIEWS).forEach(function (key) { U.$('#view-' + key).hidden = key !== name; });
    U.$$('.nav a').forEach(function (a) {
      if (a.getAttribute('data-route') === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.title = TITLES[name];
    document.body.classList.toggle('play-route', name === 'play');

    var changed = current !== name;
    current = name;
    if (changed || param) VIEWS[name].show(param);
    if (changed) window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- board colours
  function applyTheme(id) {
    var theme = CONFIG.BOARD_THEMES[id] || CONFIG.BOARD_THEMES[CONFIG.DEFAULT_BOARD_THEME];
    document.documentElement.style.setProperty('--sq-light', theme.light);
    document.documentElement.style.setProperty('--sq-dark', theme.dark);
  }

  function initTheme() {
    var select = U.$('#theme-select');
    var saved = U.load(CONFIG.STORAGE.theme, CONFIG.DEFAULT_BOARD_THEME);
    if (!CONFIG.BOARD_THEMES[saved]) saved = CONFIG.DEFAULT_BOARD_THEME;
    Object.keys(CONFIG.BOARD_THEMES).forEach(function (id) {
      select.appendChild(U.el('option', { value: id, selected: id === saved, text: CONFIG.BOARD_THEMES[id].name + ' board' }));
    });
    applyTheme(saved);
    select.addEventListener('change', function () { applyTheme(select.value); U.save(CONFIG.STORAGE.theme, select.value); });
  }

  // ---------------------------------------------------------------- interface colour themes
  function applyUiTheme(id) {
    var theme = CONFIG.UI_THEMES[id] || CONFIG.UI_THEMES[CONFIG.DEFAULT_UI_THEME];
    document.documentElement.style.setProperty('--petrol', theme.petrol);
    document.documentElement.style.setProperty('--petrol-deep', theme.deep);
    document.documentElement.style.setProperty('--petrol-tint', theme.tint);
  }

  function initUiTheme() {
    var select = U.$('#ui-theme-select');
    if (!select) return;
    var saved = U.load(CONFIG.STORAGE.uiTheme, CONFIG.DEFAULT_UI_THEME);
    if (!CONFIG.UI_THEMES[saved]) saved = CONFIG.DEFAULT_UI_THEME;
    Object.keys(CONFIG.UI_THEMES).forEach(function (id) {
      select.appendChild(U.el('option', { value: id, selected: id === saved, text: CONFIG.UI_THEMES[id].name }));
    });
    applyUiTheme(saved);
    select.addEventListener('change', function () { applyUiTheme(select.value); U.save(CONFIG.STORAGE.uiTheme, select.value); });
  }

  // ---------------------------------------------------------------- engine badge
  function initEngineBadge() {
    var badge = U.$('#engine-badge'), text = U.$('#engine-text');
    Engine.onChange(function (engine) {
      badge.className = 'engine-badge ' + (engine.mode === 'stockfish' ? 'ok' : 'fallback');
      text.textContent = engine.mode === 'stockfish' ? engine.name : 'Built-in engine';
      badge.title = engine.mode === 'stockfish'
        ? 'Moves and analysis come from ' + engine.name + ' running on your computer.'
        : 'Stockfish is not connected (' + (engine.reason || 'unknown reason') + '). The built-in JavaScript engine is being used. It is weaker; see the README to install Stockfish.';
    });
  }

  // ---------------------------------------------------------------- public helper
  root.App = {
    /** Go to a page, optionally handing it some data (used by "Analyze this game"). */
    go: function (name, param) {
      pendingParam = param || null;
      if (routeFromHash() === name && location.hash === '#/' + name) render();
      else location.hash = '#/' + name;
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initUiTheme();
    initEngineBadge();

    HomeView.init();
    PlayView.init();
    AnalyzeView.init();
    HistoryView.init();
    ProfileView.init();
    PuzzleView.init();
    OpeningsView.init();
    GuideView.init();
    AuthView.init();

    window.addEventListener('hashchange', render);
    render();
    Engine.init();
    AuthView.refreshAccountLink();
  });
})(window);
