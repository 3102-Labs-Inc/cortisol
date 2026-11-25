// Admin panel sign-in (26 Nov 2026: password only). The team password unlocks the shared GitHub key in admin/access.json
// (locked on the public site) and the records vault. The person's name is recorded on what they generate and publish.
// Refresh keeps you signed in: the unlocked session lives in this tab's sessionStorage only, and is dropped when the tab
// closes, after the idle time, or on Lock. Nothing is kept in localStorage or cookies.
(function () {
  'use strict';
  const config = window.TraceAdminConfig, GitHub = window.TraceGitHub, Vault = window.TraceVault;
  const $ = id => document.getElementById(id);
  const STORE = 'trace-admin-session', IDLE_MS = config.idleMinutes * 60000;
  let session = null, idleTimer = null, lastSaved = 0;

  function show(screen) {
    for (const id of ['login-screen', 'workspace']) $(id).hidden = id !== screen;
    $('who').hidden = $('lock').hidden = screen !== 'workspace';
  }
  function message(id, text, ok) {
    const el = $(id); el.textContent = text || ''; el.hidden = !text; el.classList.toggle('ok', !!ok);
  }
  function busy(button, on, label) {
    button.disabled = on;
    if (on) { button.dataset.label = button.textContent; button.textContent = label; } else if (button.dataset.label) button.textContent = button.dataset.label;
  }
  const store = {
    read() { try { return JSON.parse(sessionStorage.getItem(STORE) || 'null'); } catch (_) { return null; } },
    write(value) { try { sessionStorage.setItem(STORE, JSON.stringify(value)); } catch (_) { /* private mode: refresh will ask again */ } },
    clear() { try { sessionStorage.removeItem(STORE); } catch (_) { /* nothing kept */ } }
  };

  // Everything secret is dropped here: on Lock, on idle, and before any new sign-in.
  function lock(reason) {
    session = null; store.clear();
    clearTimeout(idleTimer); idleTimer = null;
    $('password').value = '';
    show('login-screen');
    message('login-message', reason || '', true);
    document.dispatchEvent(new CustomEvent('trace-admin-locked'));
  }
  function touch() {
    if (!session) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => lock('Signed out after ' + config.idleMinutes + ' minutes without activity.'), IDLE_MS);
    if (Date.now() - lastSaved > 15000) { lastSaved = Date.now(); const s = store.read(); if (s) { s.at = Date.now(); store.write(s); } }
  }
  for (const type of ['pointerdown', 'keydown', 'input']) document.addEventListener(type, touch, { passive: true });

  function enter(github, user, repo, key) {
    session = { github, user, repo, key };
    $('who').textContent = 'Signed in as ' + user.login;
    $('workspace-status').textContent = 'Records: ' + repo.fullName + ' (private). Vault unlocked.';
    show('workspace'); touch();
    window.TraceAdminSession = Object.freeze({ get github() { return session && session.github; }, get key() { return session && session.key; }, get repo() { return session && session.repo; }, get user() { return session && session.user; } });
    document.dispatchEvent(new CustomEvent('trace-admin-unlocked'));
  }
  async function connect(token) {
    const github = GitHub.client({ token, apiBase: config.apiBase });
    let account;
    try { account = await github.user(); }
    catch (error) { if (error.status === 401) throw Error('The shared GitHub key has expired or was revoked. An admin needs to run “npm run admin:access” with a new one.'); throw error; }
    const repo = await github.repo(config.recordsRepository);
    return { github, account, repo };
  }
  async function accessFile() {
    let res;
    try { res = await fetch(config.siteURL + 'admin/access.json?' + Date.now(), { cache: 'no-store', credentials: 'omit' }); }
    catch (_) { throw Error('Could not reach the website. Check the internet connection.'); }
    if (res.status === 404) throw Error('Password sign-in is not set up yet. An admin needs to run “npm run admin:access” once.');
    if (!res.ok) throw Error('Could not load the sign-in file.');
    return res.json();
  }

  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('login-button');
    message('login-message', '');
    if (!window.crypto || !window.crypto.subtle) return message('login-message', 'This page must be opened over HTTPS.');
    const name = $('your-name').value.trim(), password = $('password').value;
    if (!name) return message('login-message', 'Enter your name. It is recorded on the reports you make.');
    if (name.length > 60) return message('login-message', 'Use a name of up to 60 characters.');
    if (!password) return message('login-message', 'Enter the team password.');
    busy(button, true, 'Checking…');
    try {
      const token = await Vault.openAccess(await accessFile(), password);
      const { github, account, repo } = await connect(token);
      const file = await github.getFile(config.recordsRepository, config.vaultPath);
      if (!file) throw Error('The records vault is missing. An admin needs to run “npm run admin:access”.');
      let vault;
      try { vault = JSON.parse(file.text); } catch (_) { throw Error('The records vault file is damaged. Ask an admin to check ' + config.vaultPath + '.'); }
      busy(button, true, 'Unlocking…');
      const key = await Vault.unlockVault(vault, password, true);
      $('password').value = '';
      store.write({ v: 1, name, token, key: await Vault.exportKey(key), at: Date.now() });
      lastSaved = Date.now();
      enter(github, { login: name, github: account.login }, repo, key);
    } catch (error) {
      message('login-message', error.message || 'Sign-in failed.');
      $('password').value = '';
    } finally { busy(button, false); }
  });
  $('lock').addEventListener('click', () => lock('Locked. Sign in again to continue.'));

  // On load: resume a session from this tab if it is still within the idle time.
  async function resume() {
    const saved = store.read();
    if (!saved || saved.v !== 1 || !saved.token || !saved.key || Date.now() - saved.at > IDLE_MS) { store.clear(); return false; }
    $('login-button').disabled = true; message('login-message', 'Resuming your session…', true);
    try {
      const { github, account, repo } = await connect(saved.token);
      $('your-name').value = saved.name;
      enter(github, { login: saved.name, github: account.login }, repo, await Vault.importKey(saved.key));
      return true;
    } catch (error) { store.clear(); message('login-message', error.message || 'Please sign in again.'); return false; }
    finally { $('login-button').disabled = false; }
  }

  $('repo-name').textContent = 'Records repository: ' + config.recordsRepository + '.';
  show('login-screen');
  resume();
})();
