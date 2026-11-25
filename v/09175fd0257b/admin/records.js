// Generated reports in the private records repository (all private content encrypted with the vault key):
//   records/<id>.json   the full record, including its report key           (vault-encrypted, AAD record:<id>)
//   pages/<id>.html     the recipient's encrypted page, ready to publish      (AES-GCM with the report key; no key inside)
//   records/index.json  list for the panel: id, name, date, createdAt/By     (vault-encrypted, AAD record:index; no keys)
// The record is saved first (source of truth), then the page, then the index. Each save is one commit by the signed-in person.
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const core = isNode ? require('../report-core.js') : root.TraceReportCore;
  const Vault = isNode ? require('./vault.js') : root.TraceVault;
  const INDEX = 'records/index.json', INDEX_ID = 'index';
  const recordPath = id => 'records/' + id + '.json', pagePath = id => 'pages/' + id + '.html';
  const checkId = id => { if (!/^[a-f0-9]{32}$/.test(id)) throw Error('Invalid report id.'); return id; };

  async function readIndex({ github, repo, key }) {
    const file = await github.getFile(repo, INDEX);
    if (!file) return { entries: [], sha: undefined };
    const value = await Vault.decryptJSON(key, JSON.parse(file.text));
    if (!value || !Array.isArray(value.entries)) throw Error('The reports list in the records repository is damaged.');
    return { entries: value.entries, sha: file.sha };
  }
  // Adds one entry; if someone else saved the list at the same moment, re-read and try again.
  async function addToIndex(ctx, entry, attempts = 4) {
    for (let i = 0; ; i++) {
      const { entries, sha } = await readIndex(ctx);
      const next = entries.filter(e => e.id !== entry.id).concat(entry);
      const box = await Vault.encryptJSON(ctx.key, INDEX_ID, { v: 1, entries: next });
      try { await ctx.github.putFile(ctx.repo, INDEX, JSON.stringify(box) + '\n', 'Add report ' + entry.id + ' to the list', sha); return next; }
      catch (error) { if (!(error.status === 409 || error.status === 422) || i + 1 >= attempts) throw error; }
    }
  }

  // Creates and stores a new report. Returns {record, link, entry}. Never publishes.
  async function generate({ github, repo, key, template, siteURL, user, input, assetBase = '', now = new Date() }) {
    const identity = core.newIdentity();
    const record = { ...input, version: 1, id: identity.id, key: identity.key, createdAt: now.toISOString(), createdBy: user, assetBase };
    const base = '../' + assetBase;
    core.validateRecord(record);
    const page = await core.seal(record, template, base);
    // Check the sealed page opens with its key to exactly the previewed report before anything is saved.
    if (await core.open(page, record.key) !== core.renderTemplate(template, record, base)) throw Error('The encrypted page did not match the preview. Nothing was saved.');
    if (page.includes(record.key)) throw Error('Safety check failed: the key appeared in the page. Nothing was saved.');
    const ctx = { github, repo, key };
    const name = record.sample.name;
    await github.putFile(repo, recordPath(record.id), JSON.stringify(await Vault.encryptJSON(key, record.id, record)) + '\n', 'Generate report ' + record.id);
    await github.putFile(repo, pagePath(record.id), page, 'Encrypted page for report ' + record.id);
    const entry = { id: record.id, name, date: record.sample.date, createdAt: record.createdAt, createdBy: user };
    // The record and page are already safe; a list that could not be updated must not cause a duplicate report.
    let listWarning = '';
    try { await addToIndex(ctx, entry); }
    catch (error) { listWarning = 'The report is saved, but the reports list could not be updated (' + (error.message || 'unknown error') + '). Keep this link; it will not appear in the list.'; }
    return { record, entry, link: core.link(siteURL, record), listWarning };
  }
  async function list(ctx) {
    const { entries } = await readIndex(ctx);
    return entries.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  async function loadRecord({ github, repo, key }, id) {
    const file = await github.getFile(repo, recordPath(checkId(id)));
    if (!file) throw Error('That report’s record is missing from the records repository.');
    const record = await Vault.decryptJSON(key, JSON.parse(file.text));
    if (record.id !== id) throw Error('That record file does not match its name.');
    return record;
  }
  async function revealLink(ctx, siteURL, id) { return core.link(siteURL, await loadRecord(ctx, id)); }

  // Marks an entry as published in the list (re-read and retried on concurrent saves).
  async function markPublished(ctx, id, fields, attempts = 4) {
    for (let i = 0; ; i++) {
      const { entries, sha } = await readIndex(ctx);
      const next = entries.map(e => e.id === id ? { ...e, ...fields } : e);
      const box = await Vault.encryptJSON(ctx.key, INDEX_ID, { v: 1, entries: next });
      try { await ctx.github.putFile(ctx.repo, INDEX, JSON.stringify(box) + '\n', 'Mark report ' + id + ' published', sha); return; }
      catch (error) { if (!(error.status === 409 || error.status === 422) || i + 1 >= attempts) throw error; }
    }
  }
  // Publishes ONE report: adds r/<id>.html to the public site branch. Never touches any other file.
  //   site = { github, repo, branch }. Returns { status: 'published' | 'already', record }.
  async function publishReport(ctx, site, id, user, now = new Date()) {
    const record = await loadRecord(ctx, id);
    const pageFile = await ctx.github.getFile(ctx.repo, pagePath(id));
    if (!pageFile) throw Error('The encrypted page for this report is missing from the records repository.');
    const page = pageFile.text;
    if (await core.open(page, record.key).then(() => false, () => true)) throw Error('The saved page does not open with this report’s key. It was not published.');
    if (page.includes(record.key)) throw Error('Safety check failed: the key appears in the page. It was not published.');
    // The site must already have the loader and the exact file version this page was made with.
    if (!await site.github.getFile(site.repo, 'report-loader.js', site.branch)) throw Error('The website has no report-loader.js. An admin must run the site publisher once before reports can go live.');
    if (record.assetBase && !await site.github.getFile(site.repo, record.assetBase + 'model.js', site.branch)) throw Error('The website does not have the files this report was made with (' + record.assetBase + '). An admin must run “npm run publish” once for this version.');
    const target = 'r/' + id + '.html', existing = await site.github.getFile(site.repo, target, site.branch);
    let status = 'published';
    if (existing) {
      if (existing.text !== page) throw Error('A different page is already published at ' + target + '. Nothing was changed.');
      status = 'already';
    } else await site.github.putFile(site.repo, target, page, 'Publish report ' + id, undefined, site.branch);
    await markPublished(ctx, id, { publishedAt: now.toISOString(), publishedBy: user });
    return { status, record, page };
  }
  const api = Object.freeze({ INDEX, recordPath, pagePath, generate, list, loadRecord, revealLink, readIndex, addToIndex, markPublished, publishReport });
  root.TraceRecords = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
