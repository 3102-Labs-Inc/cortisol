/* Cinema-review overlays. Original supplied paper PNG + editable SVG type and sketched rhythm. */
(function (root) {
  'use strict';
  const model = root.TraceReportModel || (typeof require === 'function' ? require('./model.js') : null);
  const variants = Object.freeze([
    { key: 'soft', director: 'THE DUDE', title: 'Low Cortisol Day', heading: ['Low', 'Cortisol Day'], colour: 'Pink', badgePaper: '#F8CAD8', rhythmInks: ['#284F5B', '#F4DDA8'], scoreInk: '#70293E', lastPunchHole: { x: 225, y: 1231 }, caption: 'A quieter daytime curve with a low evening ending.' },
    { key: 'day', director: 'TED LASSO', title: 'Good Cortisol Day', heading: ['Good', 'Cortisol Day'], colour: 'Lilac', badgePaper: '#E1D6F2', rhythmInks: ['#AF4932', '#F6E1B5'], scoreInk: '#4B315D', lastPunchHole: { x: 218.5, y: 1254 }, caption: 'A higher daytime curve that settles by evening.' },
    { key: 'after', director: 'PABLO PICASSO', title: 'Low Cortisol Day', heading: ['Low', 'Cortisol Day'], colour: 'Lime', badgePaper: '#E4EDBF', rhythmInks: ['#2C5360', '#B95536'], scoreInk: '#365237', lastPunchHole: { x: 242.5, y: 1233 }, caption: 'A moderate daytime curve with more evening carry-over.' },
    { key: 'high', director: 'KENDALL ROY', title: 'High Cortisol Day', heading: ['High', 'Cortisol Day'], colour: 'Orange', badgePaper: '#F7D0AC', rhythmInks: ['#78333D', '#F6DDA6'], scoreInk: '#713923', lastPunchHole: { x: 215, y: 1239.5 }, caption: 'A higher daytime curve with an elevated evening ending.' }
  ]);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  const n = value => Number(value.toFixed(2));
  const noise = (x, y, seed) => {
    const value = Math.sin(x * 127.1 + y * 311.7 + seed * 91.3) * 43758.5453;
    return value - Math.floor(value);
  };
  function curveSamples(data) {
    const values = [data.w, data.w2, data.e], times = [0, 2, data.eveningHours];
    const ceiling = Math.max(80, ...values.map(v => v * 1.15));
    const x = t => 309 + 560 * t / data.eveningHours;
    const y = v => 824 - v / ceiling * 236;
    const points = model.curvePath(values, times, x, y).match(/-?\d+(?:\.\d+)?/g).map(Number);
    const segments = [points.slice(0, 8), [points[6], points[7], ...points.slice(8)]];
    return px => {
      const s = px <= x(2) ? segments[0] : segments[1];
      const t = Math.max(0, Math.min(1, (px - s[0]) / (s[6] - s[0]))), q = 1 - t;
      return q*q*q*s[1] + 3*q*q*t*s[3] + 3*q*t*t*s[5] + t*t*t*s[7];
    };
  }
  function sketchedRhythm(data, seed, ink) {
    const curve = curveSamples(data);
    const anchors = [309, 309 + 560 * 2 / data.eveningHours, 869];
    const xs = [...new Set([...Array.from({ length: 55 }, (_, i) => 309 + 560 * i / 54), ...anchors])].sort((a, b) => a - b);
    // Small deterministic bends give the pen line character. All three reading anchors stay exact.
    const points = xs.map((x, i) => {
      const taper = Math.min(1, Math.min(...anchors.map(a => Math.abs(a - x))) / 18);
      const wobble = ((noise(i, seed, 7) - .5) * 9 + Math.sin(i * 1.1 + seed) * 2) * taper;
      return `${n(x)} ${n(curve(x) + wobble)}`;
    });
    const d = 'M' + points.join('L');
    return `<g data-rhythm-line="true" data-treatment="sketched-route" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path data-line-shadow="true" d="${d}" transform="translate(4 6)" stroke="#292329" stroke-width="26"/>
      <path data-line-outline="true" d="${d}" stroke="#292329" stroke-width="25"/>
      <path data-line-ink="true" d="${d}" stroke="${ink}" stroke-width="14"/>
    </g>`;
  }
  function rhythmAxisIcons(ink) {
    const rays = Array.from({ length: 8 }, (_, i) => {
      const angle = (i * 45 - 2) * Math.PI / 180;
      return `<path d="M${n(Math.cos(angle) * 16)} ${n(Math.sin(angle) * 16)}L${n(Math.cos(angle + .035) * 22)} ${n(Math.sin(angle + .035) * 22)}"/>`;
    }).join('');
    return `<g data-rhythm-axis="icons-only" stroke="#292329" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
      <g data-axis-icon="sun" role="img" aria-label="Morning" transform="translate(309 862)" fill="${ink}"><circle cx="0" cy="0" r="10.5"/>${rays}</g>
      <g data-axis-icon="moon" role="img" aria-label="Night" transform="translate(869 862)" fill="${ink}"><path d="M12 -17C-3 -20 -21 -6 -16 9C-11 23 8 24 18 9C5 10 -3 -3 12 -17Z"/></g>
    </g>`;
  }
  function scoreMeter(data, variant, comparison) {
    const score = Math.max(0, Math.min(100, Number(data.rhythmDisplay)));
    const count = 28, filled = Math.round(score / 100 * count);
    const bars = Array.from({ length: count }, (_, i) => {
      const angle = 135 + i * 270 / (count - 1), radians = angle * Math.PI / 180;
      const x = 580 + Math.cos(radians) * 160, y = 746 + Math.sin(radians) * 160;
      return `<g data-meter-segment="${i < filled ? 'filled' : 'empty'}" transform="translate(${n(x)} ${n(y)}) rotate(${n(angle + 90)})">
        <rect data-meter-underprint="true" x="-5.5" y="-19.5" width="16" height="44" rx="2" fill="${variant.badgePaper}"/>
        <rect data-meter-ink="true" x="-8" y="-22" width="16" height="44" rx="2" fill="${i < filled ? variant.scoreInk : variant.badgePaper}" stroke="${variant.scoreInk}" stroke-width="1.2" opacity="${i < filled ? 1 : .35}"/>
      </g>`;
    }).join('');
    const ticks = Array.from({ length: 10 }, (_, i) => {
      const angle = (135 + i * 30) * Math.PI / 180;
      return `<path d="M${n(580 + Math.cos(angle) * 190)} ${n(746 + Math.sin(angle) * 190)}L${n(580 + Math.cos(angle) * 198)} ${n(746 + Math.sin(angle) * 198)}"/>`;
    }).join('');
    return `<g data-score-meter="true" data-meter-style="retro-dial" transform="translate(-37 22)" role="img" aria-label="Rhythm score ${escape(data.rhythmDisplay)}">
      <g data-meter-calibration="true" fill="none" stroke="${variant.scoreInk}" stroke-width="1.5" opacity=".6">
        <path d="M445.65 880.35A190 190 0 1 1 714.35 880.35"/>
        ${ticks}
      </g>
      ${bars}
      <text class="meter-score" x="580" y="784.08" text-anchor="middle" letter-spacing="-4" fill="${variant.scoreInk}"><tspan class="meter-value" font-size="112">${escape(data.rhythmDisplay)}</tspan></text>
      <text class="rhythm-score-total meter-total" x="580" y="830" text-anchor="middle" font-size="34" letter-spacing="-1.5" fill="${variant.scoreInk}">/100</text>
      <text class="percentile-caption meter-percentile" data-percentile="${comparison.source}" x="580" y="961" text-anchor="middle" font-size="32.256">${comparison.label ? `<tspan x="580">${escape(comparison.label)}</tspan><tspan x="580" dy="42">${escape(comparison.value)}</tspan>` : `<tspan x="580">${escape(comparison.value)}</tspan>`}</text>
    </g>`;
  }
  function approvalPapers(variant, lines = ['The Cortisol', 'Gods approve']) {
    const paper = variant.badgePaper, ink = '#000000';
    const start = { soft: 109, day: 107, after: 130, high: 111 }[variant.key];
    const rows = lines.map((line, i) => {
      const x = start + i * 26.4, baseline = 1011 + i * 74.4;
      const left = x - 16.8, top = baseline - 57.6, width = 373.55 + 33.6;
      const right = left + width, bottom = top + 76.8 + (i ? 0 : 8), angle = i ? 1.3 : -1.2;
      const outline = `M${n(left)} ${n(top + 2.4)}L${n(right - 3.6)} ${n(top)}L${n(right)} ${n(bottom - 2.4)}L${n(left + 2.4)} ${n(bottom)}Z`;
      return { line, x: n(x), baseline: n(baseline), transform: `rotate(${angle} ${n(x)} ${n(baseline - 24)})`, outline };
    });
    return `<g data-approval-papers="true" aria-label="${escape(lines.join(' '))}">${rows.map(row => `<path data-approval-paper="true" d="${row.outline}" fill="${paper}" transform="${row.transform}"/>`).join('')}
      ${rows.map(row => `<text class="review-approval" x="${row.x}" y="${row.baseline}" font-size="55.2" letter-spacing="-1.44" fill="${ink}" transform="${row.transform}">${escape(row.line)}</text>`).join('')}
    </g>`;
  }
  // ---- Card logic: everything on the card is derived from the report's own scores --------------------------
  // Inputs are the report's rhythm and stress scores exactly as the report shows them (rhythmDisplay / stressDisplay),
  // so the card follows whatever formula the report uses. Per-person copy and the percentile are optional data overrides.
  const logic = Object.freeze({
    // Grade cut-offs set 25 Nov 2026 for the smooth 1-99 score formula (a flat day, 50/50, is Room to improve).
    rhythmBands: Object.freeze([
      // Share-card captions (user wording, 26 Nov 2026). "98% of people" is playful card copy, not a calculated percentile.
      { min: 85, key: 'exceptional', label: 'Exceptional', caption: ['Exceptional cortisol rhythm,', 'better than 98% of people'] },
      { min: 70, key: 'very-good', label: 'Very good', caption: ['Better cortisol rhythm than most,', 'with room to grow'] },
      { min: 55, key: 'average', label: 'Average', caption: ['Better cortisol rhythm than most,', 'with room to grow'] },
      { min: -Infinity, key: 'room', label: 'Room to improve', caption: ['Pablo Picasso would be proud', 'of my cortisol rhythm'] }
    ]),
    // Stress is graded on the same four words, mirrored: the lower the stress, the better the grade.
    stressBands: Object.freeze([
      { max: 16, key: 'exceptional', label: 'Exceptional' }, { max: 31, key: 'very-good', label: 'Very good' },
      { max: 46, key: 'average', label: 'Average' }, { max: Infinity, key: 'room', label: 'Room to improve' }
    ]),
    // The approval strip: the standard line, unless either score is in its lowest grade (Room to improve).
    approval: Object.freeze({ standard: ['The Cortisol', 'Gods approve'], lowest: ['Cortisol Gods', 'need answers'] })
  });
  const bandOf = (value, bands, bound) => bands.find(b => bound === 'min' ? value >= b.min : value < b.max) || bands[bands.length - 1];
  // The day (title, paper colour): the original curve logic, a 2x2 of
  //   day level  = is the day's average cortisol (waking, +2h, evening) above the reference curve (28, 55, 6)?
  //   evening    = is the evening reading above the reference evening (6)?
  //   low/low -> Low Cortisol Day (pink)    high/low -> Good Cortisol Day (lilac)
  //   low/high -> Low Cortisol Day (lime)   high/high -> High Cortisol Day (orange)
  function archetypeFor(data) {
    const w = Number(data.w), w2 = Number(data.w2), e = Number(data.e), hours = Number(data.eveningHours);
    if ([w, w2, e, hours].every(Number.isFinite) && hours > 2 && model && model.reference) {
      const ref = model.reference, mean = (a, m, c) => ((a + m) + (m + c) / 2 * (hours - 2)) / hours;
      const highDay = mean(w, w2, e) > mean(ref.w, ref.w2, ref.e), highEvening = e > ref.e;
      return highDay ? (highEvening ? 'high' : 'day') : (highEvening ? 'after' : 'soft');
    }
    return variants.some(v => v.key === data.archetype) ? data.archetype : 'soft';
  }
  function cardSpec(data, options = {}) {
    const rhythm = Number.isFinite(Number(data.rhythmDisplay)) ? Number(data.rhythmDisplay) : 0;
    const stress = data.stressDisplay != null && Number.isFinite(Number(data.stressDisplay)) ? Number(data.stressDisplay) : null;
    const rhythmBand = bandOf(rhythm, logic.rhythmBands, 'min'), stressBand = stress == null ? null : bandOf(stress, logic.stressBands, 'max');
    const archetype = archetypeFor(data), day = variants.find(v => v.key === archetype);
    const lowest = rhythmBand.key === 'room' || (stressBand && stressBand.key === 'room');
    const card = options.card || {}, figure = Number.isFinite(options.figurePercent) && options.figurePercent >= 0 && options.figurePercent <= 100;
    const heading = Array.isArray(card.heading) && card.heading.length ? card.heading.map(String).slice(0, 3) : day.heading;
    const caption = Array.isArray(card.caption) && card.caption.length ? card.caption.map(String).slice(0, 3)
      : figure ? ['Better rhythm than', n(options.figurePercent) + '% of people'] : rhythmBand.caption;
    return { rule: archetype, paper: card.paper && variants.some(v => v.key === card.paper) ? card.paper : day.key, heading, title: heading.join(' '),
      description: day.caption, caption, captionSource: card.caption ? 'override' : figure ? 'supplied' : 'derived',
      approval: Array.isArray(card.approval) && card.approval.length ? card.approval.map(String).slice(0, 2) : lowest ? logic.approval.lowest : logic.approval.standard,
      rhythm, stress, rhythmBand: rhythmBand.key, stressBand: stressBand && stressBand.key, lowest };
  }
  root.TraceCardLogic = Object.freeze({ logic, spec: cardSpec });
  function render(data, options = {}) {
    const spec = cardSpec(data, options);
    const base = variants.find(v => v.key === (options.variant || spec.paper)) || variants[0];
    const variant = { ...base, title: spec.title, heading: spec.heading, caption: spec.description };
    const meter = options.treatment === 'meter';
    const hasFigure = spec.captionSource === 'supplied';
    const comparison = { label: spec.caption[0], value: spec.caption[1] || '', source: spec.captionSource };
    const id = 'trace-' + variant.key + (meter ? '-meter' : '');
    const background = options.backgroundData || `assets/artefacts/cinema/${variant.key}-paper.png`;
    const date = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' }).format(new Date(data.date + 'T00:00:00Z'));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1086" height="1448" viewBox="0 0 1086 1448" role="img" aria-labelledby="${id}-title ${id}-desc" data-archetype="${variant.key}" data-day-rule="${spec.rule}" data-rhythm-band="${spec.rhythmBand}" data-stress-band="${spec.stressBand || ''}" data-caption-source="${spec.captionSource}" data-treatment="${meter ? 'meter' : 'rhythm'}" data-report-date="${escape(data.date)}" data-detail-scale="1.2">
  <title id="${id}-title">${escape(variant.title)} — Trace</title>
  <desc id="${id}-desc">${escape(variant.caption)} ${escape(date)}. Rhythm score ${escape(data.rhythmDisplay)} out of 100 from the illustrative report model. ${hasFigure ? 'Population comparison copy supplied by the report publisher, independently of the calculated rhythm score.' : 'Caption is chosen from the rhythm score band; it is not a population comparison.'} The Cortisol Gods approve. Playful editorial approval, not a medical classification. Transparent story overlay.</desc>
  <defs><style>${options.fontStyle || ''}
    text{font-synthesis:none}
    .type{font-family:'GT Alpina Typewriter',monospace;font-weight:400}
    .mono-credit{font-family:'JetBrains Mono',monospace;font-weight:400;letter-spacing:-.04em}
    .percentile-caption{font-family:'IBM Plex Sans',sans-serif;font-weight:400;letter-spacing:0}
    .heading{font-family:'GT Alpina',serif;font-weight:400}
    .review-approval{font-family:'GT Alpina Typewriter',monospace;font-weight:500}
    .hand{font-family:'Cedarville Cursive',cursive;font-weight:400}
    .score-value{font-family:'GT Alpina',serif;font-weight:500;font-style:italic}
    .rhythm-score-total{font-family:'JetBrains Mono',monospace;font-weight:400;font-style:normal}
    .meter-score{font-family:'GT Alpina',serif;font-weight:500;font-style:italic}
    .artefact-wordmark{font-family:'IBM Plex Sans',sans-serif;font-weight:500;letter-spacing:-.075em}
  </style>
  </defs>
  <image data-paper="${variant.key}" href="${escape(background)}" x="0" y="0" width="1086" height="1448"/>
  <g fill="#292329">
    <text class="hand report-date" x="878" y="217" text-anchor="end" font-size="40" transform="rotate(-3 878 202)">${escape(date)}</text>
    <path d="M720 232Q798 235 876 227" fill="none" stroke="#292329" stroke-width="1.4" opacity=".65"/>
    <g data-day-title="true" aria-label="${escape(variant.title)}">${variant.heading.map((line, i) => `
      <text class="heading" x="182" y="${320 + i * 105}" font-size="112" letter-spacing="-3">${escape(line)}</text>`).join('')}
    </g>
    ${meter ? scoreMeter(data, variant, comparison) : `<g data-rhythm-composition="true" transform="translate(-46 96)">
      <g data-rhythm-plot="true" transform="translate(0 140)">
        ${sketchedRhythm(data, variants.indexOf(variant) + 1, variant.badgePaper)}
        ${rhythmAxisIcons(variant.badgePaper)}
      </g>
      <g data-rhythm-score-block="true" aria-label="Rhythm score ${escape(data.rhythmDisplay)} out of 100">
        <text class="score-value" data-score="rhythm" x="859" y="560" text-anchor="end" font-size="112" letter-spacing="-4" fill="${variant.scoreInk}" stroke="#FFF7EA" stroke-width="5.6" stroke-linejoin="round" paint-order="stroke fill"><tspan class="rhythm-score-value">${escape(data.rhythmDisplay)}</tspan><tspan class="rhythm-score-total" font-size="36" dx="6" dy="16" letter-spacing="-2" stroke="none">/100</tspan></text>
        <text class="percentile-caption rhythm-percentile" data-percentile="${comparison.source}" x="859" y="628" text-anchor="end" font-size="32.256">${comparison.label ? `<tspan x="859">${escape(comparison.label)}</tspan><tspan x="859" dy="42">${escape(comparison.value)}</tspan>` : `<tspan x="859">${escape(comparison.value)}</tspan>`}</text>
      </g>
    </g>`}
    <g data-approval-block="true" data-anchor="footer-baseline" transform="translate(0 204.6)">
      ${approvalPapers(variant, spec.approval)}
    </g>
    <text class="artefact-wordmark" data-trace-logo="true" x="890" y="1290" text-anchor="end" font-size="64">trace</text>
  </g>
</svg>`;
  }
  const api = Object.freeze({ variants, render, spec: cardSpec, logic });
  root.TraceArtefactDesigns = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
