(function (root) {
  'use strict';
  const ranges = root.TraceReferenceRanges || (typeof require === 'function' ? require('./reference-ranges.js') : null);
  const treatment = root.TraceIllustrationTreatment || (typeof require === 'function' ? require('./illustration-treatment.js') : null);
  // The curve is drawn from the number itself: a constant logarithmic decline over the same illustrative
  // twelve-hour interval as the reference band. Rate r (per hour) = value / 100, concentration = e^(-r t).
  // Anchors match the original artwork: 9 %/h ends at y 203, 18 %/h at 247, 28 %/h at 262.
  const GEOMETRY = { x0: 24, x1: 340, y0: 75, span: 194, hours: 12, startWidth: 18, endWidth: 14 };
  const EXAMPLE_RATE = { below: 9, close: 18, above: 28 };
  const MIN_RATE = -2, MAX_RATE = 40;
  function rateFor(value, state) {
    const numeric = Number(value);
    const rate = Number.isFinite(numeric) ? numeric : EXAMPLE_RATE[state] ?? EXAMPLE_RATE.close;
    return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
  }
  function point(rate, t) {
    const g = GEOMETRY, r = rate / 100, u = t / g.hours;
    const decay = Math.exp(-r * t);
    return { x: g.x0 + (g.x1 - g.x0) * u, y: g.y0 + g.span * (1 - decay), dx: (g.x1 - g.x0) / g.hours, dy: g.span * r * decay };
  }
  const fmt = n => n.toFixed(2);
  // A tapered ribbon with round caps, built from offsets of the sampled centre line.
  function outline(rate, offset = 0, widthScale = 1) {
    const g = GEOMETRY, steps = 64, left = [], right = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps, p = point(rate, g.hours * u), length = Math.hypot(p.dx, p.dy);
      const nx = -p.dy / length, ny = p.dx / length;
      const half = (g.startWidth + (g.endWidth - g.startWidth) * u) * widthScale / 2;
      left.push([p.x + nx * (offset + half), p.y + ny * (offset + half)]);
      right.push([p.x + nx * (offset - half), p.y + ny * (offset - half)]);
    }
    const startHalf = g.startWidth * widthScale / 2, endHalf = g.endWidth * widthScale / 2;
    const text = pair => fmt(pair[0]) + ' ' + fmt(pair[1]);
    return `M ${left.map(text).join(' L ')} A ${endHalf} ${endHalf} 0 0 0 ${text(right[steps])} L ${right.reverse().map(text).join(' L ')} A ${startHalf} ${startHalf} 0 0 0 ${text(left[0])} Z`;
  }
  function centreLine(rate, offset = 0) {
    const g = GEOMETRY, steps = 64, points = [];
    for (let i = 0; i <= steps; i++) {
      const p = point(rate, g.hours * i / steps), length = Math.hypot(p.dx, p.dy);
      points.push(`${fmt(p.x - p.dy / length * offset)} ${fmt(p.y + p.dx / length * offset)}`);
    }
    return 'M ' + points.join(' L ');
  }
  function render(state, value) {
    const selected = ['below', 'close', 'above'].includes(state) ? state : 'close';
    const id = 'diurnal-slope', rate = rateFor(value, selected);
    const pace = { below: 'slower than', close: 'within', above: 'faster than' }[selected];
    const g = GEOMETRY, ribbon = outline(rate);
    const gradient = (name, stops, attributes = '') => `<linearGradient id="${id}-${name}" x1="${g.x0}" y1="0" x2="${g.x1}" y2="0" gradientUnits="userSpaceOnUse" ${attributes}>${stops.map(([offset, colour, opacity]) => `<stop offset="${offset}" stop-color="${colour}"${opacity === undefined ? '' : ` stop-opacity="${opacity}"`}/>`).join('')}</linearGradient>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 320" class="object-art" style="aspect-ratio:360/320;overflow:visible" role="img" aria-labelledby="${id}-title ${id}-desc" data-slope-state="${selected}" data-decline-rate="${rate}">
      <title id="${id}-title">Diurnal decline</title>
      <desc id="${id}-desc">A softly padded exponential curve from a few hours after waking towards evening, drawn from the reading itself. The personal decline is ${pace} the fixed lightly shaded reference band with a subtle grey dashed outline. The curve follows a constant logarithmic decline rate over an illustrative twelve-hour interval, falling more quickly at first and levelling towards evening. A faster rate drops lower and bends more sharply. Example log decline rate ${value} percent per hour. Warm gold moves through coral into violet, with a soft glow towards evening. The reference range and normalized curve scale are illustrative.</desc>
      <defs>
        ${gradient('colour', [[0, '#e7a65f'], [.27, '#ea8d73'], [.5, '#d48095'], [.66, '#c079a4'], [.8, '#9b69a5'], [.9, '#a07fbc'], [1, '#bea7d6']])}
        ${gradient('glow', [[0, '#a98fc2', 0], [.4, '#a98fc2', 0], [.7, '#a98fc2', .22], [1, '#b49ccb', .36]])}
        <filter id="${id}-glow-blur" filterUnits="userSpaceOnUse" x="-40" y="-60" width="440" height="440"><feGaussianBlur stdDeviation="9"/></filter>
        <filter id="${id}-soft" filterUnits="userSpaceOnUse" x="-40" y="-60" width="440" height="440"><feGaussianBlur stdDeviation="1.4"/></filter>
        <filter id="${id}-grain" filterUnits="userSpaceOnUse" x="-40" y="-60" width="440" height="440">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="4" result="noise"/>
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 .36  0 0 0 0 .22  0 0 0 0 .4  0 0 0 .5 -.16" result="speckle"/>
          <feComposite in="speckle" in2="SourceAlpha" operator="in" result="speckleInside"/>
          <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="speckleInside"/></feMerge>
        </filter>
        <clipPath id="${id}-tube"><path d="${ribbon}"/></clipPath>
      </defs>
      ${ranges.guide(id, 14, 46, 279)}
      ${ranges.guide(id, 346, 46, 279)}
      <g class="decline-wide-composition">
        <image href="assets/diurnal-decline/reference.svg?v=reference-grey-hatch-6" width="360" height="320"/>
        <g class="trace-glow" opacity="${treatment.colourOpacity}"><path d="${centreLine(rate)}" fill="none" stroke="url(#${id}-glow)" stroke-width="22" stroke-linecap="round" filter="url(#${id}-glow-blur)"/></g>
        <g class="trace-model" opacity="${treatment.modelOpacity}"><path d="${outline(rate, 0, 1.12)}" fill="#f4f1f2" filter="url(#${id}-soft)"/></g>
        <g class="trace-colour" opacity="${treatment.colourOpacity}">
          <path d="${ribbon}" fill="url(#${id}-colour)" filter="url(#${id}-grain)"/>
          <g clip-path="url(#${id}-tube)">
            <path d="${centreLine(rate, 4.4)}" fill="none" stroke="#5a3a78" stroke-opacity=".2" stroke-width="5" stroke-linecap="round" filter="url(#${id}-soft)"/>
            <path d="${centreLine(rate, -3.6)}" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="3.6" stroke-linecap="round" filter="url(#${id}-soft)"/>
          </g>
        </g>
      </g>
      <g class="decline-time-icons" text-anchor="middle" aria-hidden="true">
        <text x="14" y="305" style="font-family:'Trace Time Icons';font-size:16px;font-weight:300;font-feature-settings:'liga';fill:#888888">light_mode</text>
        <text x="346" y="305" style="font-family:'Trace Time Icons';font-size:16px;font-weight:300;font-feature-settings:'liga';fill:#888888">bedtime</text>
      </g>
      ${ranges.tag(id, 198, 260, 'M180 240 C179 234 179 227 180 221', '16–20')}
    </svg>`;
  }
  root.TraceDeclineIllustration = render;
  if (typeof module !== 'undefined' && module.exports) module.exports = { render, rateFor, point, GEOMETRY };
})(typeof globalThis !== 'undefined' ? globalThis : this);
