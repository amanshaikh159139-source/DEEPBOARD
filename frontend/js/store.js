/*
 * store.js
 * ========
 * Saves your games in the browser (localStorage), newest first.
 *
 * A saved game looks like this:
 *   {
 *     id, savedAt, source: 'bot' | 'two-player' | 'chesscom' | 'pgn',
 *     ref,                       // optional unique reference (chess.com game URL)
 *     white, black, result, reason, date, plies,
 *     pgn,                       // the full game as PGN text
 *     analysis: null | { speed, engine, evals, bestMoves, classes, accuracy, counts }
 *   }
 */
(function (root) {
  'use strict';

  function readAll() {
    var list = U.load(CONFIG.STORAGE.history, []);
    return Array.isArray(list) ? list : [];
  }

  function writeAll(list) {
    if (list.length > CONFIG.HISTORY_LIMIT) list = list.slice(0, CONFIG.HISTORY_LIMIT);
    if (!U.save(CONFIG.STORAGE.history, list)) {
      U.toast('Your browser would not let DeepBoard save this game (storage is full or blocked).', 'error');
      return false;
    }
    return true;
  }

  var Store = {
    list: function () {
      return readAll().sort(function (a, b) { return b.savedAt - a.savedAt; });
    },

    get: function (id) {
      var list = readAll();
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    },

    /** Add a game. If an entry with the same `ref` exists it is updated instead. Returns the entry. */
    add: function (entry) {
      var list = readAll();
      if (entry.ref) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].ref === entry.ref) {
            list[i] = Object.assign({}, list[i], entry, { id: list[i].id, savedAt: Date.now() });
            writeAll(list);
            return list[i];
          }
        }
      }
      var saved = Object.assign({ analysis: null }, entry, { id: U.uid(), savedAt: Date.now() });
      list.unshift(saved);
      writeAll(list);
      return saved;
    },

    update: function (id, patch) {
      var list = readAll();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          list[i] = Object.assign({}, list[i], patch);
          writeAll(list);
          return list[i];
        }
      }
      return null;
    },

    remove: function (id) {
      writeAll(readAll().filter(function (g) { return g.id !== id; }));
    },

    clear: function () {
      writeAll([]);
    }
  };

  root.Store = Store;
})(window);
