// Admin panel: sign-in, vault unlock, idle lock. Secrets (token, vault key) live only in `session`, in memory.
(function () {
  'use strict';
  const config = window.TraceAdminConfig, GitHub = window.TraceGitHub, Vault = window.TraceVault;
  const $ = id => document.getElementById(id);
  let session = null, idleTimer = null, pendingSetup = null;

  function show(screen) {
    for (const id of ['login-screen', 'setup-screen', 'workspace']) $(id).hidden = id !== screen;
    $('who').hidden = $('lock').hidden = screen !== 'workspace';
  }
  function message(id, text, ok) {
    const el = $(id); el.textContent = text || ''; el.hidden = !text; el.classList.toggle('ok', !!ok);
  }
  function busy(button, on, label) {
    button.disabled = on;
    if (on) { button.dataset.label = button.textContent; button.textContent = label; } else if (button.dataset.label) button.textContent = button.dataset.label;
  }
  function clearFields(...ids) { for (const id of ids) $(id).value = ''; }

  // Everything secret is dropped here: on Lock, on idle, and before any new sign-in.
  function lock(reason) {
    session = null; pendingSetup = null;
    clearTimeout(idleTimer); idleTimer = null;
    clearFields('token', 'passphrase', 'new-passphrase', 'confirm-passphrase');
    show('login-screen');
    message('login-message', reason || '', true);
    document.dispatchEvent(new CustomEvent('trace-admin-locked'));
  }
  function touch() {
    if (!session) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => lock('Signed out after ' + config.idleMinutes + ' minutes without activity.'), config.idleMinutes * 60000);
  }
  for (const type of ['pointerdown', 'keydown', 'input']) document.addEventListener(type, touch, { passive: true });

  function enter(github, user, repo, key, vaultSha) {
    session = { github, user, repo, key, vaultSha };
    $('who').textContent = 'Signed in as ' + user.login;
    $('workspace-status').textContent = 'Records: ' + repo.fullName + ' (private). Vault unlocked.';
    show('workspace'); touch();
    window.TraceAdminSession = Object.freeze({ get github() { return session && session.github; }, get key() { return session && session.key; }, get repo() { return session && session.repo; }, get user() { return session && session.user; } });
    document.dispatchEvent(new CustomEvent('trace-admin-unlocked'));
  }

  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('login-button');
    message('login-message', '');
    if (!window.crypto || !window.crypto.subtle) return message('login-message', 'This page must be opened over HTTPS.');
    const token = $('token').value, passphrase = $('passphrase').value;
    if (!passphrase) return message('login-message', 'Enter the team passphrase.');
    busy(button, true, 'Checking…');
    try {
      const github = GitHub.client({ token, apiBase: config.apiBase });
      const user = await github.user();
      const repo = await github.repo(config.recordsRepository);
      const file = await github.getFile(config.recordsRepository, config.vaultPath);
      if (!file) { // First use: offer to create the vault.
        pendingSetup = { github, user, repo };
        clearFields('passphrase', 'new-passphrase', 'confirm-passphrase');
        message('setup-message', '');
        show('setup-screen'); $('new-passphrase').focus();
        return;
      }
      let vault;
      try { vault = JSON.parse(file.text); } catch (_) { throw Error('The records vault file is damaged. Ask an admin to check ' + config.vaultPath + '.'); }
      busy(button, true, 'Unlocking…');
      const key = await Vault.unlockVault(vault, passphrase);
      clearFields('token', 'passphrase');
      enter(github, user, repo, key, file.sha);
    } catch (error) {
      message('login-message', error.message || 'Sign-in failed.');
      $('passphrase').value = '';
    } finally { busy(button, false); }
  });

  $('setup-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!pendingSetup) return lock();
    const button = $('setup-button'), pass = $('new-passphrase').value, confirm = $('confirm-passphrase').value;
    const problem = Vault.passphraseProblem(pass, confirm);
    if (problem) return message('setup-message', problem);
    busy(button, true, 'Creating…');
    try {
      const { github, user, repo } = pendingSetup;
      const { vault, key } = await Vault.createVault(pass);
      const saved = await github.putFile(config.recordsRepository, config.vaultPath, JSON.stringify(vault, null, 2) + '\n', 'Create records vault');
      pendingSetup = null;
      clearFields('token', 'passphrase', 'new-passphrase', 'confirm-passphrase');
      enter(github, user, repo, key, saved.sha);
    } catch (error) { message('setup-message', error.message || 'Could not create the vault.'); }
    finally { busy(button, false); }
  });
  $('setup-cancel').addEventListener('click', () => lock());
  $('lock').addEventListener('click', () => lock('Locked. Sign in again to continue.'));
  window.addEventListener('pagehide', () => { session = null; });

  $('repo-name').textContent = 'Records repository: ' + config.recordsRepository + '.';
  show('login-screen');
})();
