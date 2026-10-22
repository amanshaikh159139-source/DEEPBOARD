(function (root) {
  'use strict';
  var els = {}, history = [], pending = false;
  function localAnswer(q) {
    var text = q.toLowerCase();
    if (/import|chess\.com|chesscom/.test(text)) return 'Open Analyse, choose Import from chess.com, enter a public username, and select a game. You can also paste a PGN or upload a .pgn file.';
    if (/puzzle|tactic|fork|mate in/.test(text)) return 'Open Puzzle and look for forcing moves: checks, captures, forks and threats. Use Hint if needed; the puzzle shows a verified solution line.';
    if (/opening|sicilian|italian|caro|french defense/.test(text)) return 'Open Opening learnings, choose a line, and step through the moves. Focus on the centre, piece development, king safety, and the plan behind the opening.';
    if (/stockfish|engine|analyse|analy[sz]e|evaluation/.test(text)) return 'Stockfish runs through the local Flask backend. Keep the terminal started by start.bat open while playing or analysing. If the engine stops, use the startup script to launch it again; individual analysis requests should not require restarting the server.';
    if (/profile|rating|history|game save/.test(text)) return 'Your Profile and History use games saved in this browser. Export important games as PGN for backup. Puzzle rating is separate from official chess ratings.';
    if (/play|bot|beginner|elo|difficulty/.test(text)) return 'Open Play, choose a bot rating, select your colour, and start a game. The ratings are approximate strengths, not guaranteed official Elo values.';
    if (/hello|hi\b|hey\b/.test(text)) return 'Hey! Ask me about chess, tactics, openings, game analysis, or any other topic. General-topic AI chat can be enabled in backend configuration.';
    return 'General-topic AI chat is not configured yet. To enable open-ended answers, set OPENAI_API_KEY in backend/.env. I can still help locally with chess rules, tactics, openings, analysis, and using DeepBoard.';
  }
  function appendMessage(role, text) {
    var el = document.createElement('div'); el.className = 'guide-message ' + role; el.textContent = text;
    els.messages.appendChild(el); els.messages.scrollTop = els.messages.scrollHeight;
    return el;
  }
  function fetchAI() {
    var base = (window.CONFIG && CONFIG.API_BASE !== undefined) ? CONFIG.API_BASE : '';
    if (window.Api && Api.detectBackend) return Api.detectBackend().then(function () { return (window.CONFIG && CONFIG.API_BASE) || base; });
    return Promise.resolve(base);
  }
  function send(message) {
    message = (message || '').trim(); if (!message || pending) return;
    appendMessage('user', message); history.push({ role: 'user', content: message });
    if (history.length > 12) history = history.slice(-12);
    els.input.value = ''; pending = true; els.input.disabled = true; els.send.disabled = true;
    var loading = appendMessage('bot', 'Thinking…'); loading.classList.add('guide-loading');
    fetchAI().then(function (base) {
      return fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (data) { if (!r.ok) { var e = new Error(data.error || 'Chat service unavailable'); e.status = r.status; throw e; } return data; }); });
    }).then(function (data) {
      var answer = String(data.reply || '').trim() || localAnswer(message);
      loading.textContent = answer; loading.classList.remove('guide-loading');
      history.push({ role: 'assistant', content: answer }); if (history.length > 12) history = history.slice(-12);
    }).catch(function (error) {
      var answer = (error.status === 503 || error.status === 502 || error.status === 504) ? localAnswer(message) : localAnswer(message);
      loading.textContent = answer; loading.classList.remove('guide-loading');
      history.push({ role: 'assistant', content: answer }); if (history.length > 12) history = history.slice(-12);
    }).finally(function () { pending = false; els.input.disabled = false; els.send.disabled = false; els.input.focus(); els.messages.scrollTop = els.messages.scrollHeight; });
  }
  function init() {
    els = { panel: document.getElementById('guide-panel'), launcher: document.getElementById('guide-launcher'), close: document.getElementById('guide-close'), messages: document.getElementById('guide-messages'), form: document.getElementById('guide-form'), input: document.getElementById('guide-input'), send: document.querySelector('#guide-form button[type="submit"]') };
    els.launcher.addEventListener('click', function () { els.panel.hidden = !els.panel.hidden; if (!els.panel.hidden) els.input.focus(); });
    els.close.addEventListener('click', function () { els.panel.hidden = true; });
    els.form.addEventListener('submit', function (e) { e.preventDefault(); send(els.input.value); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-guide-prompt]'), function (b) { b.addEventListener('click', function () { send(b.getAttribute('data-guide-prompt')); }); });
  }
  root.GuideView = { init: init };
})(window);
