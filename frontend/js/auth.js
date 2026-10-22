(function (root) {
  'use strict';
  var mode = 'login', currentUser = null, els = {}, googleInitialized = false;

  function api(path, body, method) {
    var base = (window.CONFIG && CONFIG.API_BASE !== undefined) ? CONFIG.API_BASE : '';
    var init = { method: method || 'POST', headers: {}, credentials: 'include' };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(base + path, init).then(function (r) {
      return r.text().then(function (raw) {
        var d; try { d = raw ? JSON.parse(raw) : {}; } catch (_) { d = {}; }
        if (!r.ok) throw new Error(d.error || ('Request failed (' + r.status + ')'));
        return d;
      });
    }).catch(function (e) {
      if (e instanceof TypeError) throw new Error('Cannot reach DeepBoard. Open it using start.bat and visit http://127.0.0.1:5050.');
      throw e;
    });
  }
  function setMode(next) {
    mode = next;
    els.login.classList.toggle('active', mode === 'login');
    els.register.classList.toggle('active', mode === 'register');
    els.title.textContent = mode === 'login' ? 'Your next move starts here.' : 'Create your player profile.';
    els.submit.textContent = mode === 'login' ? 'Sign in' : 'Create account';
    els.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    els.username.placeholder = mode === 'login' ? 'Your username or email' : 'Choose a username';
    els.usernameLabel.textContent = mode === 'login' ? 'Username or email' : 'Username';
    els.username.type = 'text'; els.username.minLength = mode === 'login' ? 1 : 3; els.username.maxLength = mode === 'login' ? 254 : 32;
    els.emailGroup.hidden = mode !== 'register'; els.email.required = mode === 'register';
    els.error.textContent = '';
  }
  function refreshAccountLink() {
    var a = document.getElementById('account-link');
    if (a) { a.textContent = currentUser ? 'Profile · ' + currentUser.username : 'Sign in'; a.href = currentUser ? '#/profile' : '#/auth'; }
  }
  function refresh() {
    return api('/api/auth/me', undefined, 'GET').then(function (d) {
      currentUser = d.authenticated ? d.user : null; refreshAccountLink();
      if (window.ProfileView) ProfileView.refresh();
      return currentUser;
    }).catch(function () { currentUser = null; refreshAccountLink(); return null; });
  }
  function onLoginSuccess(data) {
    currentUser = data.user; els.password.value = ''; if (els.email) els.email.value = ''; refreshAccountLink();
    if (window.ProfileView) ProfileView.refresh();
    App.go('profile'); if (window.U) U.toast('Signed in successfully.', 'success');
  }
  function handleGoogleCredential(response) {
    if (!response || !response.credential) { els.error.textContent = 'Google did not return a sign-in credential.'; return; }
    els.googleButton.disabled = true; els.error.textContent = '';
    api('/api/auth/google', { credential: response.credential }).then(onLoginSuccess).catch(function (err) {
      els.error.textContent = err.message;
    }).finally(function () { els.googleButton.disabled = false; });
  }
  function setupGoogle() {
    var clientId = (window.CONFIG && CONFIG.GOOGLE_CLIENT_ID || '').trim();
    if (!clientId) {
      els.googleProvider.hidden = true; els.googleButton.hidden = false;
      els.googleNote.textContent = 'Google Sign-In is optional. Add the OAuth client ID to frontend/js/config.js and backend/ environment to enable it.';
      return;
    }
    if (!window.google || !google.accounts || !google.accounts.id) {
      els.googleNote.textContent = 'Loading Google Sign-In…';
      return;
    }
    if (!googleInitialized) {
      google.accounts.id.initialize({ client_id: clientId, callback: handleGoogleCredential, auto_select: false, cancel_on_tap_outside: true });
      googleInitialized = true;
    }
    els.googleProvider.hidden = false; els.googleButton.hidden = true;
    els.googleProvider.replaceChildren();
    google.accounts.id.renderButton(els.googleProvider, { theme: 'outline', size: 'large', shape: 'rectangular', text: 'continue_with', width: 320, logo_alignment: 'left' });
    els.googleNote.textContent = 'Google verifies your account securely; the backend never trusts an unverified browser claim.';
  }
  function init() {
    els = {
      form: document.getElementById('auth-form'), username: document.getElementById('auth-username'),
      usernameLabel: document.getElementById('auth-username-label'), emailGroup: document.getElementById('auth-email-group'), email: document.getElementById('auth-email'),
      password: document.getElementById('auth-password'), error: document.getElementById('auth-error'),
      title: document.getElementById('auth-title'), submit: document.getElementById('auth-submit'),
      login: document.getElementById('auth-mode-login'), register: document.getElementById('auth-mode-register'),
      toggle: document.getElementById('password-toggle'), googleButton: document.getElementById('google-signin-button'),
      googleProvider: document.getElementById('google-signin-provider'), googleNote: document.getElementById('google-signin-note')
    };
    els.login.addEventListener('click', function () { setMode('login'); });
    els.register.addEventListener('click', function () { setMode('register'); });
    els.toggle.addEventListener('click', function () {
      var visible = els.password.type === 'password'; els.password.type = visible ? 'text' : 'password';
      els.toggle.textContent = visible ? 'Hide' : 'Show'; els.toggle.setAttribute('aria-pressed', visible ? 'true' : 'false');
      els.toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    });
    els.form.addEventListener('submit', function (e) {
      e.preventDefault(); els.submit.disabled = true; els.error.textContent = '';
      api('/api/auth/' + (mode === 'login' ? 'login' : 'register'), { username: els.username.value.trim(), email: mode === 'register' ? els.email.value.trim() : undefined, password: els.password.value })
        .then(onLoginSuccess).catch(function (err) { els.error.textContent = err.message; })
        .finally(function () { els.submit.disabled = false; });
    });
    els.googleButton.addEventListener('click', function () {
      if (!CONFIG.GOOGLE_CLIENT_ID) { els.error.textContent = 'Google Sign-In is not configured yet. Set GOOGLE_CLIENT_ID in frontend/js/config.js and backend/.env; local username/password login is ready.'; return; }
      if (window.google && google.accounts && google.accounts.id) { google.accounts.id.prompt(); }
      else { els.error.textContent = 'Google Sign-In could not load. Check your internet connection and OAuth configuration.'; }
    });
    setMode('login'); setupGoogle();
    refresh();
  }
  root.DeepBoardGoogleLoaded = function () { if (els.googleNote) setupGoogle(); };
  root.AuthView = {
    init: init,
    show: function () { els.error.textContent = ''; refresh(); setupGoogle(); },
    hide: function () {}, refreshAccountLink: refreshAccountLink, refresh: refresh, getUser: function () { return currentUser; },
    logout: function () { return api('/api/auth/logout', {}).then(function () { currentUser = null; refreshAccountLink(); if (window.ProfileView) ProfileView.refresh(); App.go('home'); }); }
  };
})(window);
