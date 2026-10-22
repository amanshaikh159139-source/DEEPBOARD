/*
 * store.js
 * ========
 * Saves games locally for offline use and syncs signed-in players' games
 * with the Flask account API. Guest games stay in the original local history.
 */
(function (root) {
  'use strict';

  var activeAccount = null;
  var accountLoaded = false;
  var accountGeneration = 0;
  var syncQueue = Object.create(null);
  var MIGRATION_KEY = 'deepboard.history.migrated.v1';

  function accountKey() {
    return activeAccount ? 'deepboard.history.user.' + String(activeAccount.id) : CONFIG.STORAGE.history;
  }

  function readKey(key) {
    var list = U.load(key, []);
    return Array.isArray(list) ? list : [];
  }

  function readAll() {
    return readKey(accountKey());
  }

  function writeAll(list) {
    if (list.length > CONFIG.HISTORY_LIMIT) list = list.slice(0, CONFIG.HISTORY_LIMIT);
    if (!U.save(accountKey(), list)) {
      U.toast('Your browser would not let DeepBoard save this game (storage is full or blocked).', 'error');
      return false;
    }
    return true;
  }

  function requestApi(path, method, body) {
    var base = (window.CONFIG && CONFIG.API_BASE !== undefined) ? CONFIG.API_BASE : '';
    var options = { method: method || 'GET', credentials: 'include', headers: {} };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(base + path, options).then(function (response) {
      return response.text().then(function (raw) {
        var data;
        try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = {}; }
        if (!response.ok) throw new Error(data.error || ('Request failed (' + response.status + ')'));
        return data;
      });
    });
  }

  function syncEntry(entry, quiet) {
    if (!activeAccount || !entry || !entry.id) return Promise.resolve(false);
    var id = String(entry.id);
    var targetAccountId = String(activeAccount.id);
    var previous = syncQueue[id] || Promise.resolve();
    var next = previous.catch(function () {}).then(function () {
      if (!activeAccount || String(activeAccount.id) !== targetAccountId) return false;
      return requestApi('/api/games', 'POST', entry).then(function () {
        return true;
      });
    }).catch(function () {
      if (!quiet) U.toast('Saved on this device, but account sync failed. Check the backend and database connection.', 'error');
      return false;
    });
    syncQueue[id] = next;
    next.then(function () { if (syncQueue[id] === next) delete syncQueue[id]; });
    return next;
  }

  function syncDelete(id) {
    if (!activeAccount) return;
    requestApi('/api/games/' + encodeURIComponent(String(id)), 'DELETE').catch(function () {
      U.toast('This game was removed on this device, but the account copy could not be deleted.', 'error');
    });
  }

  function mergeLists(first, second) {
    var byId = Object.create(null);
    (first || []).concat(second || []).forEach(function (game) {
      if (!game || game.id === undefined || game.id === null) return;
      var key = String(game.id);
      var old = byId[key];
      if (!old || Number(game.savedAt || 0) >= Number(old.savedAt || 0)) byId[key] = game;
    });
    return Object.keys(byId).map(function (key) { return byId[key]; })
      .sort(function (a, b) { return Number(b.savedAt || 0) - Number(a.savedAt || 0); })
      .slice(0, CONFIG.HISTORY_LIMIT);
  }

  var Store = {
    list: function () {
      return readAll().sort(function (a, b) { return Number(b.savedAt || 0) - Number(a.savedAt || 0); });
    },

    get: function (id) {
      var list = readAll();
      for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
      return null;
    },

    /** Add a game. If an entry with the same chess.com ref exists, update it. */
    add: function (entry) {
      var list = readAll();
      if (entry.ref) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].ref === entry.ref) {
            list[i] = Object.assign({}, list[i], entry, { id: list[i].id, savedAt: Date.now() });
            writeAll(list);
            syncEntry(list[i], false);
            return list[i];
          }
        }
      }
      var saved = Object.assign({ analysis: null }, entry, { id: U.uid(), savedAt: Date.now() });
      list.unshift(saved);
      writeAll(list);
      syncEntry(saved, false);
      return saved;
    },

    update: function (id, patch) {
      var list = readAll();
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(id)) {
          list[i] = Object.assign({}, list[i], patch, { savedAt: Date.now() });
          writeAll(list);
          syncEntry(list[i], false);
          return list[i];
        }
      }
      return null;
    },

    remove: function (id) {
      writeAll(readAll().filter(function (g) { return String(g.id) !== String(id); }));
      syncDelete(id);
    },

    clear: function () {
      writeAll([]);
      if (activeAccount) {
        requestApi('/api/games', 'DELETE').catch(function () {
          U.toast('History was cleared on this device, but the account copy could not be cleared.', 'error');
        });
      }
    },

    /**
     * Switch the visible history to the signed-in account and hydrate it from
     * the server. On first sign-in, existing browser history is migrated once.
     */
    setAccount: function (user) {
      var nextId = user ? String(user.id) : null;
      var currentId = activeAccount ? String(activeAccount.id) : null;
      if (nextId === currentId && (accountLoaded || !user)) return Promise.resolve();
      var generation = ++accountGeneration;
      activeAccount = user || null;
      accountLoaded = !user;
      if (!user) return Promise.resolve();

      var cachedAtStart = readAll();
      var shouldMigrate = !U.load(MIGRATION_KEY, false);
      var guestGames = shouldMigrate ? readKey(CONFIG.STORAGE.history) : [];

      return requestApi('/api/games', 'GET').then(function (data) {
        if (generation !== accountGeneration || !activeAccount || String(activeAccount.id) !== nextId) return;
        var latestCache = readAll();
        var remoteGames = Array.isArray(data.games) ? data.games : [];
        var merged = mergeLists(mergeLists(cachedAtStart, latestCache), guestGames);
        merged = mergeLists(merged, remoteGames);
        writeAll(merged);
        if (shouldMigrate) U.save(MIGRATION_KEY, true);
        accountLoaded = true;

        var remoteById = Object.create(null);
        remoteGames.forEach(function (game) {
          if (game && game.id !== undefined) remoteById[String(game.id)] = game;
        });
        var missingOrNewer = merged.filter(function (game) {
          var remote = remoteById[String(game.id)];
          return !remote || Number(game.savedAt || 0) > Number(remote.savedAt || 0);
        });
        return missingOrNewer.reduce(function (chain, game) {
          return chain.then(function () {
            if (generation !== accountGeneration) return;
            return syncEntry(game, true);
          });
        }, Promise.resolve()).then(function () {
          if (generation === accountGeneration && window.ProfileView) ProfileView.refresh();
        });
      }).catch(function () {
        if (generation !== accountGeneration) return;
        // Local cache remains usable if the API is temporarily unavailable.
        writeAll(mergeLists(mergeLists(cachedAtStart, readAll()), guestGames));
        accountLoaded = false;
        U.toast('Account history could not be loaded. Your local games are still available.', 'error');
      });
    }
  };

  root.Store = Store;
})(window);
