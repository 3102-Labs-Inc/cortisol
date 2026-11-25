// Workspace: readings form -> live estimate, story, scores -> the real report in a same-origin frame, 10 views.
(function () {
  'use strict';
  const config = window.TraceAdminConfig, core = window.TraceReportCore, timing = window.TraceTiming, model = window.TraceReportModel, cards = window.TraceCardLogic;
  const $ = id => document.getElementById(id);
  const TEMPLATE_PATH = 'template/report.html';
  const VIEWS = [
    { key: 'curve', label: 'Rhythm curve' }, { key: 'rhythm', label: 'Rhythm score' }, { key: 'stress', label: 'Stress score' },
    { key: 'evening-level', label: 'Evening level' }, { key: 'total-auc', label: 'Exposure' }, { key: 'morning-activation', label: 'Morning activation' },
    { key: 'diurnal-decline', label: 'Decline' }, { key: 'evening-fraction', label: 'Evening fraction' },
    { key: 'share-meter', label: 'Score card' }, { key: 'share-rhythm', label: 'Rhythm card' }
  ];
  let template = null, current = null, view = 'curve', renderToken = 0, debounce = null;
  const fmt = n => String(Math.round(n * 100) / 100);
  const gradeLabel = key => ({ exceptional: 'Exceptional', 'very-good': 'Very good', average: 'Average', room: 'Room to improve' }[key] || '');

  // ---- Form -> record ----------------------------------------------------------------------------------------
  const lines = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean);
  function readForm() {
    const record = {
      sample: { name: $('f-name').value.trim(), date: $('f-date').value },
      timed: { times: { w: $('t-w').value, w2: $('t-w2').value, e: $('t-e').value }, readings: { w: $('r-w').value.trim(), w2: $('r-w2').value.trim(), e: $('r-e').value.trim() }, method: timing.METHOD }
    };
    const share = {}, card = {};
    if ($('a-figure').value.trim()) share.figurePercent = Number($('a-figure').value.trim());
    for (const [id, key] of [['a-heading', 'heading'], ['a-caption', 'caption'], ['a-approval', 'approval']]) if (lines(id).length) card[key] = lines(id);
    if ($('a-paper').value) card.paper = $('a-paper').value;
    if (Object.keys(card).length) share.card = card;
    if (Object.keys(share).length) record.share = share;
    // Hand adjustments: only fields the admin filled in.
    const overrides = {}, copy = {}, characteristics = {};
    for (const k of ['rhythm', 'stress']) { const v = $('o-' + k).value.trim(); if (v) overrides[k] = /^\d+$/.test(v) ? Number(v) : NaN; }
    if ($('o-rhythm-text').value.trim()) copy.rhythmIntro = $('o-rhythm-text').value.trim();
    if ($('o-stress-text').value.trim()) copy.stressIntro = $('o-stress-text').value.trim();
    for (const id of core.CHARACTERISTIC_IDS) { const t = $('o-c-' + id).value.trim(); if (t) characteristics[id] = t; }
    if (Object.keys(characteristics).length) copy.characteristics = characteristics;
    if (Object.keys(overrides).length) record.overrides = overrides;
    if (Object.keys(copy).length) record.copy = copy;
    return record;
  }
  const required = ['f-name', 'f-date', 't-w', 't-w2', 't-e', 'r-w', 'r-w2', 'r-e'];
  function evaluate() {
    const record = readForm();
    const missing = required.filter(id => !$(id).value.trim());
    for (const id of required) $(id).removeAttribute('aria-invalid');
    // The date is pre-filled, so only warn once something else has been typed.
    const started = required.some(id => id !== 'f-date' && $(id).value.trim());
    if (missing.length) return { record, error: started ? 'Fill in every field to see the report.' : '', incomplete: true };
    try {
      for (const k of ['w', 'w2', 'e']) if (!/^\d*\.?\d+$/.test(record.timed.readings[k])) { $('r-' + k).setAttribute('aria-invalid', 'true'); throw Error('Readings must be plain numbers, like 24 or 0.85.'); }
      record.timed.readings = { w: Number(record.timed.readings.w), w2: Number(record.timed.readings.w2), e: Number(record.timed.readings.e) };
      const estimate = timing.estimate(record.timed);
      const sample = core.normalize(record);
      core.validateShare(record.share);
      if (record.overrides && Object.values(record.overrides).some(v => Number.isNaN(v))) throw Error('Scores must be whole numbers from 0 to 100.');
      core.validateOverrides(record.overrides);
      core.validateCopy(record.copy);
      const calculated = model.calculate(sample), scores = core.applyOverrides(calculated, record);
      // Show what is calculated as the grey placeholder of each hand field.
      $('o-rhythm').placeholder = String(calculated.rhythmDisplay); $('o-stress').placeholder = String(calculated.stressDisplay);
      const intros = core.scoreIntros(sample, scores);
      $('o-rhythm-text').placeholder = intros.rhythm; $('o-stress-text').placeholder = intros.stress;
      return { record, estimate, sample, scores, calculated, card: cards.spec(scores, record.share || {}) };
    } catch (error) { return { record, error: error.message }; }
  }

  // ---- Summary ------------------------------------------------------------------------------------------------
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function showSummary(state) {
    $('form-message').hidden = !state.error; $('form-message').textContent = state.error || '';
    const ok = !!state.scores;
    $('summary').hidden = !ok;
    $('generate').disabled = !ok || !template;
    $('generate-hint').textContent = !template ? 'The report template must be in the records repository before Generate.' : ok ? 'Creates the private record and its encrypted page. Publishing is a separate step.' : 'Fill in every field to enable Generate.';
    if (!ok) return;
    $('story').textContent = timing.story(state.estimate, state.record.timed.times, fmt);
    const list = $('adjustments'); list.replaceChildren();
    for (const a of state.estimate.adjustments.slice(1)) {
      const li = el('li');
      if (a.method !== 'on-time' && a.size !== 'none') li.append(el('span', 'badge ' + a.size, a.size + (a.capped ? ', capped' : '')));
      li.append(timing.summary(a, fmt)); list.append(li);
    }
    for (const n of state.estimate.notes) list.append(el('li', 'note', 'Story check: ' + n));
    const s = state.scores, c = state.card, box = $('scores'); box.replaceChildren();
    const byHand = k => state.record.overrides && Number.isInteger(state.record.overrides[k]) ? ' (set by hand, calculated ' + state.calculated[k + 'Display'] + ')' : '';
    for (const [label, value, band] of [['Rhythm score' + byHand('rhythm'), s.rhythmDisplay, c.rhythmBand], ['Stress score' + byHand('stress'), s.stressDisplay, c.stressBand]]) {
      const d = el('div', 'score'); d.append(el('div', 'score-label', label), el('div', 'score-value', String(value)), el('div', 'score-grade', gradeLabel(band))); box.append(d);
    }
    box.append(el('p', 'card-line', 'Share card: “' + c.heading.join(' ') + '”, ' + c.approval.join(' ') + '. Caption: ' + c.caption.join(' ')));
  }

  // ---- Preview frame -------------------------------------------------------------------------------------------
  const frame = () => $('preview');
  function loadBlank() {
    return new Promise(resolve => { const f = frame(); f.addEventListener('load', () => resolve(), { once: true }); f.src = 'preview.html?' + Date.now(); });
  }
  const until = async (test, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (test()) return true; } catch (_) { /* frame swapping */ } await new Promise(r => setTimeout(r, 50)); } throw Error('The preview did not finish loading.'); };
  // The report is written into the frame once per set of readings; switching tabs then moves inside that loaded
  // report (TraceReportNav, TraceReportShare.show), so it is instant and the share cards are not re-drawn.
  let loadedKey = null;
  async function loadReport(state, token) {
    await loadBlank();
    if (token !== renderToken) return false;
    const win = frame().contentWindow, doc = frame().contentDocument;
    // Same path as the recipient: the report HTML written into an empty page, assets resolved via <base href="../">.
    doc.open(); doc.write(core.renderTemplate(template, { ...state.record, id: '0'.repeat(32), key: 'A'.repeat(43) }, '../')); doc.close();
    await until(() => win.TraceCharacteristicsReport && win.TraceReportNav && win.TraceReportShare && win.document.getElementById('open-report'));
    return token === renderToken;
  }
  async function goTo(key, token) {
    const win = frame().contentWindow, d = win.document, nav = win.TraceReportNav;
    const i = VIEWS.findIndex(v => v.key === key);
    const screen = i === 0 ? 'curve' : i === 1 ? 'rhythm' : i === 2 ? 'stress' : i <= 7 ? 'characteristics' : 'share';
    nav.go(screen);
    if (screen === 'curve') await until(() => d.querySelector('#curve-chart path.curve-reading-line'));
    if (screen === 'characteristics') {
      await until(() => d.getElementById(key));
      // scrollIntoView would also scroll the admin page itself; keep the panel where the admin left it.
      const x = window.scrollX, y = window.scrollY;
      d.getElementById(key).scrollIntoView({ block: 'start' });
      window.scrollTo(x, y);
    } else win.scrollTo(0, 0);
    if (screen === 'share') {
      const treatment = key === 'share-meter' ? 'meter' : 'rhythm';
      win.TraceReportShare.show(treatment, false);
      await until(() => { const img = d.querySelector('.share-image[data-treatment="' + treatment + '"]'); return win.TraceReportShare.ready(treatment) && img && !img.hidden && img.complete && img.naturalWidth > 0; }, 20000);
    }
    if (token !== renderToken) return;
    // Let the report's own screen transitions finish so the view is shown as the recipient sees it settle.
    await until(() => d.getAnimations().every(a => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity), 4000).catch(() => {});
    // The report focuses each new screen's title for keyboard users; a tapping recipient never sees that ring.
    if (d.activeElement && d.activeElement !== d.body) d.activeElement.blur();
  }
  async function refreshPreview() {
    const token = ++renderToken, status = $('preview-status');
    if (!current || !current.scores || !template) { loadedKey = null; status.textContent = template ? 'The preview appears once the readings are valid.' : 'Waiting for the report template.'; setTabs(false); return; }
    const recordKey = JSON.stringify(current.record);
    setTabs(true);
    try {
      if (recordKey !== loadedKey) {
        status.textContent = 'Updating the preview…';
        frame().dataset.ready = 'false';
        loadedKey = null;
        if (!await loadReport(current, token)) return;
        loadedKey = recordKey;
      }
      await goTo(view, token);
      if (token === renderToken) { status.textContent = 'Showing the real report, exactly as the recipient will see it. You can also tap through it.'; frame().dataset.ready = 'true'; frame().dataset.view = view; }
    } catch (error) { if (token === renderToken) { loadedKey = null; status.textContent = error.message; } }
  }
  function setTabs(enabled) {
    for (const b of $('view-tabs').children) { b.disabled = !enabled; b.setAttribute('aria-selected', String(b.dataset.view === view)); }
  }
  for (const v of VIEWS) {
    const b = el('button', null, v.label); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.view = v.key; b.disabled = true;
    b.addEventListener('click', () => { view = v.key; setTabs(true); refreshPreview(); });
    $('view-tabs').append(b);
  }

  function update() {
    current = evaluate();
    showSummary(current);
    clearTimeout(debounce);
    debounce = setTimeout(refreshPreview, 450);
  }
  $('report-form').addEventListener('input', update);
  $('report-form').addEventListener('change', update);
  $('generate').addEventListener('click', () => { if (current && current.scores) document.dispatchEvent(new CustomEvent('trace-admin-generate', { detail: { record: current.record, scores: current.scores, card: current.card, story: $('story').textContent } })); });

  // ---- Session lifecycle ----------------------------------------------------------------------------------------
  function reset() {
    template = null; current = null; renderToken++; loadedKey = null;
    $('report-form').reset(); $('advanced').open = false; $('adjust').open = false; $('summary').hidden = true; $('form-message').hidden = true; $('template-message').hidden = true;
    const f = frame(); f.src = 'preview.html'; setTabs(false);
  }
  document.addEventListener('trace-admin-locked', reset);
  document.addEventListener('trace-admin-unlocked', async () => {
    reset();
    const today = new Date(); $('f-date').value = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const session = window.TraceAdminSession;
    try {
      const file = await session.github.getFile(config.recordsRepository, TEMPLATE_PATH);
      if (!file) throw Error('The report template is not in the records repository yet (' + TEMPLATE_PATH + '). An admin needs to add it before reports can be previewed.');
      if (!file.text.includes('<!-- REPORT_SAMPLE -->')) throw Error(TEMPLATE_PATH + ' in the records repository is not the report template.');
      template = file.text;
    } catch (error) { $('template-message').textContent = error.message; $('template-message').hidden = false; }
    update();
  });
  window.TraceAdminWorkspace = Object.freeze({
    views: VIEWS.map(v => v.key),
    get template() { return template; },
    // Clears the readings after a successful Generate so the same report cannot be generated twice by accident.
    clear() { $('report-form').reset(); $('advanced').open = false; $('adjust').open = false; const t = new Date(); $('f-date').value = new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10); update(); }
  });
})();
