// Publish: a separate, confirmed step that adds ONE encrypted page to the public website, then checks it is live
// and opens with its key. Nothing else on the site is touched. Never automatic.
(function () {
  'use strict';
  const config = window.TraceAdminConfig, Records = window.TraceRecords, core = window.TraceReportCore;
  const $ = id => document.getElementById(id);
  const poll = Object.assign({ intervalMs: 5000, timeoutMs: 240000 }, config.livePoll || {});
  let entry = null, busy = false;
  const records = () => { const s = window.TraceAdminSession; return { github: s.github, repo: config.recordsRepository, key: s.key }; };
  const site = () => ({ github: window.TraceAdminSession.github, repo: config.siteRepository, branch: config.siteBranch });
  const status = (text, kind) => { const el = $('publish-status'); el.textContent = text; el.hidden = !text; el.dataset.kind = kind || ''; };

  // Waits for GitHub Pages to serve the page, then decrypts it with the record's key and compares it with the expected report.
  async function verifyLive(record, expectedPage, token) {
    const url = config.siteURL + 'r/' + record.id + '.html', end = Date.now() + poll.timeoutMs;
    while (Date.now() < end) {
      if (token !== busy) return;
      try {
        const res = await fetch(url + '?check=' + Date.now(), { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (res.ok) {
          const text = await res.text();
          if (text !== expectedPage) { status('The website is serving a different page at this address. Do not share the link; ask an admin to check.', 'bad'); return 'mismatch'; }
          await core.open(text, record.key);
          status('Live. The page is on the website and opens with its link.', 'ok'); return 'live';
        }
      } catch (error) { if (error && error.name === 'OperationError') { status('The live page does not open with its key. Do not share the link; ask an admin to check.', 'bad'); return 'broken'; } }
      status('Saved to the website. Waiting for GitHub Pages to update (usually 1–2 minutes)…', 'wait');
      await new Promise(r => setTimeout(r, poll.intervalMs));
    }
    status('Saved to the website, but it is not live yet. GitHub Pages can be slow; use “Check live” in the reports list in a few minutes.', 'wait');
    return 'timeout';
  }

  function ask(e) {
    if (busy || !window.TraceAdminSession || !window.TraceAdminSession.key) return;
    entry = e;
    $('publish-title').textContent = 'Publish to the website?';
    $('publish-name').textContent = e.name; $('publish-path').textContent = config.siteURL + 'r/' + e.id;
    status(''); $('publish-ok').hidden = false; $('publish-ok').disabled = false; $('publish-cancel').textContent = 'Cancel';
    $('publish-dialog').showModal();
  }
  $('publish-ok').addEventListener('click', async () => {
    if (!entry || busy) return;
    const token = busy = Symbol('publish');
    $('publish-ok').disabled = true; $('publish-cancel').disabled = true;
    status('Publishing…', 'wait');
    try {
      const session = window.TraceAdminSession;
      const out = await Records.publishReport(records(), site(), entry.id, session.user.login);
      $('publish-title').textContent = 'Published';
      $('publish-ok').hidden = true; $('publish-cancel').disabled = false; $('publish-cancel').textContent = 'Close';
      document.dispatchEvent(new CustomEvent('trace-admin-published', { detail: { id: entry.id } }));
      status(out.status === 'already' ? 'This page was already on the website. Checking it…' : 'Saved to the website. Checking it is live…', 'wait');
      await verifyLive(out.record, out.page, token);
    } catch (error) {
      status((error.message || 'Publishing failed.') + ' Nothing else on the website was changed.', 'bad');
      $('publish-ok').disabled = false; $('publish-cancel').disabled = false;
    } finally { if (busy === token) busy = false; }
  });
  $('publish-dialog').addEventListener('close', () => { busy = false; entry = null; status(''); });
  document.addEventListener('trace-admin-locked', () => { if ($('publish-dialog').open) $('publish-dialog').close(); });
  // Re-checks an already published report without changing anything.
  async function check(e) {
    if (busy || !window.TraceAdminSession || !window.TraceAdminSession.key) return;
    entry = null;
    $('publish-title').textContent = 'Check the live page';
    $('publish-name').textContent = e.name; $('publish-path').textContent = config.siteURL + 'r/' + e.id;
    $('publish-ok').hidden = true; $('publish-cancel').disabled = false; $('publish-cancel').textContent = 'Close';
    $('publish-dialog').showModal();
    const token = busy = Symbol('check');
    status('Checking…', 'wait');
    try {
      const ctx = records(), record = await Records.loadRecord(ctx, e.id), saved = await ctx.github.getFile(ctx.repo, Records.pagePath(e.id));
      if (!saved) throw Error('The saved page is missing from the records repository.');
      await verifyLive(record, saved.text, token);
    } catch (error) { status(error.message || 'Check failed.', 'bad'); }
    finally { if (busy === token) busy = false; }
  }
  window.TraceAdminPublish = Object.freeze({ ask, check });
})();
