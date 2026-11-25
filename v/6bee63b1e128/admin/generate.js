// Generate flow: confirm -> encrypt and save to the private records repository -> show the link once.
// Also the list of generated reports with "Show link" for signed-in team members. Never publishes anything.
(function () {
  'use strict';
  const config = window.TraceAdminConfig, Records = window.TraceRecords;
  const $ = id => document.getElementById(id);
  let pending = null, busy = false;
  const ctx = () => { const s = window.TraceAdminSession; return { github: s.github, repo: config.recordsRepository, key: s.key }; };
  const el = (tag, text) => { const n = document.createElement(tag); if (text != null) n.textContent = text; return n; };
  const grade = key => ({ exceptional: 'Exceptional', 'very-good': 'Very good', average: 'Average', room: 'Room to improve' }[key] || '');

  function showLink(link, intro) {
    $('link-value').value = link; $('link-intro').textContent = intro; $('link-copied').textContent = '';
    $('link-dialog').showModal(); $('link-value').select();
  }
  // The link (with its key) only ever sits in this dialog; it is wiped when the dialog closes.
  $('link-dialog').addEventListener('close', () => { $('link-value').value = ''; });
  $('link-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('link-value').value); $('link-copied').textContent = 'Copied.'; }
    catch (_) { $('link-value').select(); $('link-copied').textContent = 'Copy did not work here. The link is selected: press Ctrl+C (or ⌘C).'; }
  });

  document.addEventListener('trace-admin-generate', event => {
    if (busy || !window.TraceAdminSession || !window.TraceAdminSession.key) return;
    pending = event.detail;
    const r = pending.record, facts = $('confirm-facts'); facts.replaceChildren();
    for (const [k, v] of [['Name', r.sample.name], ['Sample date', r.sample.date], ['Rhythm', pending.scores.rhythmDisplay + ' · ' + grade(pending.card.rhythmBand)], ['Stress', pending.scores.stressDisplay + ' · ' + grade(pending.card.stressBand)], ['Day', pending.story]]) facts.append(el('dt', k), el('dd', v));
    $('confirm-message').hidden = true;
    $('confirm-dialog').showModal();
  });
  $('confirm-dialog').addEventListener('close', () => { if (!busy) pending = null; });
  $('confirm-ok').addEventListener('click', async () => {
    if (!pending || busy) return;
    const button = $('confirm-ok'), template = window.TraceAdminWorkspace.template, session = window.TraceAdminSession;
    busy = true; button.disabled = true; $('confirm-cancel').disabled = true; button.textContent = 'Saving…';
    try {
      const out = await Records.generate({ ...ctx(), template, siteURL: config.siteURL, user: session.user.login, input: pending.record, assetBase: config.assetBase || '' });
      busy = false; pending = null;
      $('confirm-dialog').close();
      window.TraceAdminWorkspace.clear();
      showLink(out.link, out.listWarning || ('Saved for ' + out.entry.name + '. This link is shown now; signed-in team members can show it again from the list. It is not published yet.'));
      refreshList();
    } catch (error) {
      $('confirm-message').textContent = (error.message || 'Saving failed.') + ' You can try again.'; $('confirm-message').hidden = false;
    } finally { busy = false; button.disabled = false; $('confirm-cancel').disabled = false; button.textContent = 'Generate'; }
  });

  async function refreshList() {
    const status = $('reports-status'), list = $('reports-list');
    if (!window.TraceAdminSession || !window.TraceAdminSession.key) return;
    status.textContent = 'Loading…';
    try {
      const entries = await Records.list(ctx());
      list.replaceChildren();
      status.textContent = entries.length ? '' : 'No reports generated yet.';
      status.hidden = !!entries.length;
      for (const e of entries) {
        const li = el('li'), who = el('span'), small = el('small', 'Sample ' + e.date + ' · made by ' + e.createdBy + ' · ' + new Date(e.createdAt).toLocaleString());
        who.className = 'who'; who.append(e.name, small);
        const reveal = el('button', 'Show link'); reveal.type = 'button'; reveal.dataset.id = e.id;
        reveal.addEventListener('click', async () => {
          reveal.disabled = true;
          try { showLink(await Records.revealLink(ctx(), config.siteURL, e.id), 'Private link for ' + e.name + '.'); }
          catch (error) { status.hidden = false; status.textContent = error.message; }
          finally { reveal.disabled = false; }
        });
        li.append(who, reveal);
        if (e.publishedAt) { const done = el('span', 'Published'); done.className = 'state'; done.title = 'Published ' + new Date(e.publishedAt).toLocaleString() + ' by ' + e.publishedBy;
          const chk = el('button', 'Check live'); chk.type = 'button'; chk.dataset.check = e.id; chk.addEventListener('click', () => window.TraceAdminPublish.check(e)); li.append(done, chk); }
        else { const pub = el('button', 'Publish'); pub.type = 'button'; pub.dataset.publish = e.id; pub.addEventListener('click', () => window.TraceAdminPublish.ask(e)); li.append(pub); }
        list.append(li);
      }
    } catch (error) { status.hidden = false; status.textContent = error.message; }
  }
  document.addEventListener('trace-admin-unlocked', refreshList);
  document.addEventListener('trace-admin-published', refreshList);
  document.addEventListener('trace-admin-locked', () => {
    pending = null; $('reports-list').replaceChildren(); $('reports-status').hidden = false; $('reports-status').textContent = '';
    for (const d of ['confirm-dialog', 'link-dialog']) if ($(d).open) $(d).close();
    $('link-value').value = '';
  });
})();
