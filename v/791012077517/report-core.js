// Report core: everything needed to turn a record into a recipient page, with no file system or Node APIs,
// so the admin panel (browser) and scripts/reports.cjs (Node) produce identical pages from one implementation.
//   normalize(record)                    -> validated sample {name,date,w,w2,e,eveningHours}
//   validateShare(share), validateRecord(record)
//   renderTemplate(templateHTML, record, base) -> plain report HTML (the preview)
//   wrapperPage(payload)                 -> public encrypted page around {v,id,iv,data}
//   seal(record, templateHTML, base?)    -> Promise of the encrypted page (WebCrypto AES-256-GCM)
//   newIdentity()                        -> {id, key} random 128-bit id, 256-bit key
//   link(origin, record)                 -> origin + 'r/<id>.html#<key>'
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const model = isNode ? require('./model.js') : root.TraceReportModel;
  const timing = isNode ? require('./timing.js') : root.TraceTiming;
  const subtle = () => {
    const c = root.crypto || (isNode ? require('node:crypto').webcrypto : null);
    if (!c || !c.subtle) throw Error('A secure browser context (HTTPS) is required to seal reports.');
    return c;
  };
  const idPattern = /^[a-f0-9]{32}$/, keyPattern = /^[\w-]{43}$/;
  const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

  // base64 / base64url without Buffer
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function toBase64(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < bytes.length ? B64[n >> 6 & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
    }
    return out;
  }
  function fromBase64(text) {
    const clean = text.replace(/=+$/, ''), bytes = [];
    let bits = 0, value = 0;
    for (const ch of clean) {
      const v = B64.indexOf(ch);
      if (v < 0) throw Error('Invalid base64.');
      value = (value << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 255); }
    }
    return Uint8Array.from(bytes);
  }
  const toBase64url = bytes => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromBase64url = text => fromBase64(text.replace(/-/g, '+').replace(/_/g, '/'));

  function normalize(input) {
    let sample = input.sample || input;
    // timed: real sample clock times plus readings; the first sample is waking, +2h and +14h are estimated.
    //   { times: {w:'07:10', w2:'09:40', e:'21:05'}, readings: {w, w2, e}, method: timing.METHOD }
    if (input.timed) {
      if (input.raw) throw Error('Use either timed readings or raw pairs, not both.');
      const timed = input.timed;
      if (!timed || typeof timed !== 'object' || Object.keys(timed).some(key => !['times', 'readings', 'method'].includes(key))) throw Error('Timed input may only contain times, readings and method.');
      if (timed.method !== timing.METHOD) throw Error('Timed input must name the estimation method ' + timing.METHOD + '.');
      sample = { ...sample, ...timing.estimate(timed).sample };
    }
    if (input.raw) {
      if (!Number.isFinite(input.factor) || input.factor <= 0) throw Error('Raw inputs require an explicit positive conversion factor.');
      sample = { ...sample };
      for (const key of ['w', 'w2', 'e']) {
        const pair = input.raw[key];
        if (!Array.isArray(pair) || pair.length !== 2 || pair.some(n => !Number.isFinite(n) || n <= 0)) throw Error('Raw inputs require positive cortisol/creatinine pairs.');
        sample[key] = pair[0] / pair[1] * input.factor;
      }
    }
    return model.validate(sample);
  }
  // Share-card options are plain data, so a recipient's wording never needs a patch script.
  //   figurePercent: publisher-supplied "Better rhythm than X% of people" (number 0-100)
  //   card: optional per-recipient overrides of the logic-driven card:
  //     heading (1-3 short lines), caption (1-3 lines), paper (soft|day|after|high), approval (1-2 lines)
  function validateShare(share) {
    if (share == null) return;
    const plain = value => value && typeof value === 'object' && !Array.isArray(value);
    const lines = (value, max, length, name) => {
      if (!Array.isArray(value) || value.length < 1 || value.length > max || value.some(line => typeof line !== 'string' || !line.trim() || line.length > length)) throw Error('Share card ' + name + ' must be 1 to ' + max + ' non-empty lines of at most ' + length + ' characters.');
    };
    if (!plain(share) || Object.keys(share).some(key => !['figurePercent', 'card'].includes(key))) throw Error('Share options may only contain figurePercent and card.');
    if (share.figurePercent != null && (!Number.isFinite(share.figurePercent) || share.figurePercent < 0 || share.figurePercent > 100)) throw Error('Share figure must be a number from 0 to 100.');
    if (share.card == null) return;
    if (!plain(share.card) || Object.keys(share.card).some(key => !['heading', 'caption', 'paper', 'approval'].includes(key))) throw Error('Share card may only contain heading, caption, paper and approval.');
    if ('heading' in share.card) lines(share.card.heading, 3, 30, 'heading');
    if ('caption' in share.card) lines(share.card.caption, 3, 40, 'caption');
    if ('approval' in share.card) lines(share.card.approval, 2, 24, 'approval');
    if ('paper' in share.card && !['soft', 'day', 'after', 'high'].includes(share.card.paper)) throw Error('Share card paper must be soft, day, after or high.');
  }
  function validateRecord(record) {
    if (!idPattern.test(record.id) || !keyPattern.test(record.key) || fromBase64url(record.key).length !== 32) throw Error('Invalid private report ID/key.');
    normalize(record);
    for (const key of Object.keys(record.copy || {})) {
      if (!['rhythmIntro', 'stressIntro'].includes(key) || typeof record.copy[key] !== 'string' || record.copy[key].length > 2000) throw Error('Invalid report copy override.');
    }
    validateShare(record.share);
    return record;
  }
  // Score descriptions written for the person's own day (wording from the approved review prototype). Grades use the same
  // bands as the badges and share cards (TraceCardLogic), so the sentence, the badge and the card always agree.
  // Approved per-person wording in record.copy still replaces these.
  function scoreIntros(sample, scores) {
    const w = sample.w, m = sample.w2, e = sample.e;
    const logic = isNode ? require('./artefact-designs.js') : root.TraceCardLogic;
    // Never guess the grade: without the card logic the wording could silently differ from the badge and the card.
    if (!logic) throw Error('artefact-designs.js must be loaded before a report is rendered.');
    const card = logic.spec({ ...sample, rhythmDisplay: scores.rhythmDisplay, stressDisplay: scores.stressDisplay });
    const rhythmBand = card.rhythmBand, stressBand = card.stressBand;
    const shape = m > w && e < m ? 'Cortisol levels rose after waking, then fell by evening.'
      : m < w && e < m ? 'Cortisol levels fell throughout the day.'
      : m > w && e > m ? 'Cortisol levels rose throughout the day.'
      : m < w && e > m ? 'Cortisol levels fell after waking, then rose by evening.'
      : 'Cortisol levels stayed level between some readings.';
    const bigger = 'A bigger rise in cortisol levels after waking and a bigger fall by evening would give a higher score.';
    // Praise and "bigger rise and fall" only fit a day that actually rose and then fell; otherwise advise on the missing part.
    const roseThenFell = m > w && e < m;
    const advice = roseThenFell && rhythmBand === 'exceptional' ? 'A lovely rhythm, from morning to evening.'
      : roseThenFell ? bigger
      : m <= w && e >= m ? 'A rise in cortisol levels after waking and a fall by evening would give a higher score.'
      : m <= w ? 'A rise in cortisol levels a few hours after waking would give a higher score.'
      : e >= m ? 'A fall in cortisol levels by evening would give a higher score.'
      : bigger;
    // Stress: lower is better. Room to improve splits into "higher side" and, from 70 up, "high".
    const stressLine = stressBand === 'exceptional' ? 'Your score is low. This is the best feeling for your body (and your biology).'
      : stressBand === 'very-good' ? 'Your score is on the lower side. That suggests a relatively low level of stress.'
      : stressBand === 'average' ? 'Your score is in the middle. That suggests your body may be experiencing some stress.'
      : scores.stressDisplay >= 70 ? 'Your score is high. That suggests your body may be under more stress.'
      : 'Your score is on the higher side. That suggests your body may be under more stress.';
    return {
      rhythm: shape + ' ' + advice,
      stress: 'Your stress score shows how much cortisol you’re carrying into the evening and overnight. ' + stressLine
    };
  }
  function renderTemplate(template, record, base = '../') {
    if (typeof template !== 'string' || !template.includes('<!-- REPORT_SAMPLE -->')) throw Error('Report template is missing or not the report template.');
    const sample = normalize(record), scores = model.calculate(sample);
    // Function replacements: a name containing "$&" or "$1" must be inserted literally.
    let html = template.replace('<head>', () => '<head>\n  <base href="' + escapeHTML(base) + '">');
    html = html.replace('<!-- REPORT_SAMPLE -->', () => '<script>window.TraceInitialSample=' + safeJSON(sample) + ';window.TraceReportOptions=' + safeJSON({ share: record.share || {} }) + ';</script>');
    html = html.replace('id="person-name">Alex', () => 'id="person-name">' + escapeHTML(sample.name));
    html = html.replace(/(<p class="score-explanation-copy score-intro">)[\s\S]*?(<\/p>)/g, (match, start, end) => {
      const rhythm = match.includes('Cortisol naturally');
      const intro = scoreIntros(sample, scores);
      const text = rhythm ? (record.copy?.rhythmIntro || intro.rhythm) : (record.copy?.stressIntro || intro.stress);
      return start + escapeHTML(text) + end;
    });
    for (const kind of ['rhythm', 'stress']) {
      const value = scores[kind + 'Display'];
      html = html.replace(new RegExp('(id="' + kind + '-value">)\\d+'), (m, p1) => p1 + value);
      html = html.replace(new RegExp('(id="' + kind + '-meter"[^>]*aria-valuenow=")\\d+'), (m, p1) => p1 + value);
    }
    return html;
  }
  function wrapperPage(payload) {
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>Trace · Your private report</title><style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#0b0b0d;color:#f7f8f4;font:16px/1.6 system-ui}main{max-width:28rem;padding:32px}h1{font-weight:500;font-size:28px}p{color:#bbb}</style></head><body><main><h1>Your Trace report</h1><p id="message" role="status">Opening your report…</p><noscript>Enable JavaScript to open your private report.</noscript></main><script type="application/json" id="report-payload">' + safeJSON(payload) + '</script><script src="../report-loader.js"></script></body></html>\n';
  }
  const aadFor = id => new TextEncoder().encode('Trace report v1:' + id);
  async function seal(record, template, base = '../') {
    validateRecord(record);
    const c = subtle(), iv = c.getRandomValues(new Uint8Array(12));
    const key = await c.subtle.importKey('raw', fromBase64url(record.key), 'AES-GCM', false, ['encrypt']);
    const plain = new TextEncoder().encode(renderTemplate(template, record, base));
    const data = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(record.id), tagLength: 128 }, key, plain));
    return wrapperPage({ v: 1, id: record.id, iv: toBase64(iv), data: toBase64(data) });
  }
  // Inverse of seal, used by tests and the admin panel's "check the page opens" step.
  async function open(page, keyText) {
    const match = /<script type="application\/json" id="report-payload">([\s\S]*?)<\/script>/.exec(page);
    if (!match) throw Error('Not an encrypted report page.');
    const payload = JSON.parse(match[1]), c = subtle();
    const key = await c.subtle.importKey('raw', fromBase64url(keyText), 'AES-GCM', false, ['decrypt']);
    const plain = await c.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(payload.iv), additionalData: aadFor(payload.id), tagLength: 128 }, key, fromBase64(payload.data));
    return new TextDecoder().decode(plain);
  }
  function newIdentity() {
    const c = subtle(), hex = Array.from(c.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    return { id: hex, key: toBase64url(c.getRandomValues(new Uint8Array(32))) };
  }
  const link = (origin, record) => origin + 'r/' + record.id + '.html#' + record.key;
  const api = Object.freeze({ escapeHTML, safeJSON, scoreIntros, normalize, validateShare, validateRecord, renderTemplate, wrapperPage, seal, open, newIdentity, link, toBase64, fromBase64, toBase64url, fromBase64url });
  root.TraceReportCore = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
