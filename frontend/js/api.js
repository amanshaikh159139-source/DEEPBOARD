/*
 * api.js
 * ======
 * Everything that talks to the Flask backend, plus the "Engine" helper the
 * rest of the app uses.
 *
 *   Engine.init()                        find the backend and check whether Stockfish is available
 *   Engine.bestMove(fen, level)          -> { uci, cp, mate, depth, pv }   (bot move)
 *   Engine.evaluate(fen, {movetime})     -> { uci, cp, mate, depth, pv }   (analysis)
 *   Api.chesscomGames(username, max)     -> { games: [...] }
 *
 * If the backend or Stockfish is missing, Engine quietly switches to the
 * built-in JavaScript engine (ai.js) so the app keeps working.
 */
(function (root) {
  'use strict';

  var listeners = [];

  function request(path, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, (options && options.timeout) || 20000);
    var init = { signal: controller.signal, headers: {} };
    if (options && options.body) {
      init.method = 'POST';
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    return fetch(CONFIG.API_BASE + path, init).then(function (response) {
      clearTimeout(timer);
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          var err = new Error(data.error || ('Server error ' + response.status));
          err.status = response.status;
          throw err;
        }
        return data;
      });
    }, function (e) {
      clearTimeout(timer);
      var err = new Error(e.name === 'AbortError' ? 'The backend took too long to answer.' : 'Cannot reach the DeepBoard backend. Open http://127.0.0.1:5050 and keep its server running.');
      err.network = true;
      throw err;
    });
  }

  /** Ask one address whether a DeepBoard backend lives there. Resolves true / false (never rejects). */
  function probe(base) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 3000);
    return fetch(base + '/api/health', { signal: controller.signal }).then(function (response) {
      clearTimeout(timer);
      return response.ok ? response.json().then(function (data) { return !!(data && data.ok === true); }, function () { return false; }) : false;
    }, function () { clearTimeout(timer); return false; });
  }

  var Api = {
    /** Finds the backend (same origin first, then CONFIG.BACKEND_URL) and remembers it in CONFIG.API_BASE. */
    detectBackend: function () {
      var candidates = location.protocol === 'file:' ? [CONFIG.BACKEND_URL] : ['', CONFIG.BACKEND_URL];
      return candidates.reduce(function (chain, base) {
        return chain.then(function (found) {
          if (found !== null) return found;
          return probe(base).then(function (ok) { return ok ? base : null; });
        });
      }, Promise.resolve(null)).then(function (found) {
        if (found !== null) CONFIG.API_BASE = found;
      });
    },

    health: function () { return request('/api/health', { timeout: 8000 }); },
    chesscomGames: function (username, max) {
      return request('/api/chesscom/games?username=' + encodeURIComponent(username) + '&max=' + (max || CONFIG.CHESSCOM_MAX_GAMES), { timeout: 60000 });
    }
  };

  var Engine = {
    mode: 'checking',      // 'stockfish' | 'builtin' | 'checking'
    name: '',
    reason: '',

    onChange: function (fn) { listeners.push(fn); },

    _set: function (mode, name, reason) {
      this.mode = mode; this.name = name || ''; this.reason = reason || '';
      listeners.forEach(function (fn) { fn(Engine); });
    },

    init: function () {
      return Api.detectBackend().then(function () { return Api.health(); }).then(function (h) {
        if (h.stockfish) Engine._set('stockfish', h.engine);
        else Engine._set('builtin', 'Built-in engine', h.problem || 'Stockfish was not found.');
      }, function (e) {
        Engine._set('builtin', 'Built-in engine', e.message);
      });
    },

    /** Use Stockfish if possible, otherwise the built-in engine. */
    _run: function (path, body, fallback) {
      if (Engine.mode !== 'stockfish') return fallback();
      return request(path, { body: body, timeout: 45000 }).catch(function (e) {
        if (e.status === 400) throw e;                 // invalid FEN/request should remain visible
        // A transient request/engine hiccup should not permanently switch the
        // application away from Stockfish. Ask the health endpoint and retry
        // once if the persistent backend reports the engine is healthy.
        return Api.health().then(function (health) {
          if (health && health.stockfish) {
            Engine._set('stockfish', health.engine || 'Stockfish');
            return request(path, { body: body, timeout: 45000 });
          }
          Engine._set('builtin', 'Built-in engine', (health && health.problem) || e.message);
          return fallback();
        }).catch(function (healthError) {
          Engine._set('builtin', 'Built-in engine', healthError.message || e.message);
          return fallback();
        });
      });
    },

    bestMove: function (fen, level) {
      return Engine._run('/api/engine/bestmove', { fen: fen, level: level }, function () { return BuiltinAI.bestMove(fen, level); });
    },

    evaluate: function (fen, opts) {
      opts = opts || {};
      var movetime = opts.movetime || 300;
      return Engine._run('/api/engine/evaluate', { fen: fen, movetime: movetime, depth: opts.depth }, function () {
        return BuiltinAI.evaluatePosition(fen, movetime);
      }).then(function (result) {
        // Checkmate / stalemate positions have no best move: make sure we still return something sensible.
        if (!result) return { uci: null, cp: null, mate: null, depth: 0, pv: [] };
        return result;
      });
    }
  };

  root.Api = Api;
  root.Engine = Engine;
})(window);
