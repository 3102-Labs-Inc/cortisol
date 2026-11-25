(function (root) {
  'use strict';
  const ranges = root.TraceReferenceRanges || (typeof require === 'function' ? require('./reference-ranges.js') : null);
  const treatment = root.TraceIllustrationTreatment || (typeof require === 'function' ? require('./illustration-treatment.js') : null);
  // How the figurine responds to the reading (all derived from the value, so any new measurement works):
  //  - 0                : no green at all (grey figurine).
  //  - below the range  : a green circle grows from the centre of the torso. The radius follows
  //                       (value / 410) ^ 2, so it stays small when the reading is far below the range
  //                       and fills in quickly as it nears 410 (e.g. 50% of 410 -> 25% radius, 90% -> 81%).
  //  - 410-500 (optimal): the whole figurine is green, with no outer glow.
  //  - above the range  : whole figurine stays green and an outer glow grows with the value, doubling
  //                       the top of the range (1000) giving the full glow.
  const range = { low: 410, high: 500, glowFull: 1000 }, curve = 2;
  const centre = { x: 176.4, y: 168 }, fullRadius = 219, feather = 14;
  const clamp01 = n => Math.min(1, Math.max(0, n));
  function auraFill(value, state) {
    const n = Number(value);
    if (!Number.isFinite(n)) return { fill: { below: .5, close: 1, above: 1 }[state] ?? 1, glow: state === 'above' ? .5 : 0 };
    return { fill: Math.pow(clamp01(n / range.low), curve), glow: n > range.high ? clamp01(Math.log(n / range.high) / Math.log(range.glowFull / range.high)) : 0 };
  }
  function render(state, value) {
    const selected = ['below', 'close', 'above'].includes(state) ? state : 'close';
    const { fill, glow } = auraFill(value, selected);
    const asset = filename => `assets/total-auc/${filename}?v=${treatment.version}`;
    const image = (filename, className, opacity, extra = '') => `<image class="${className}" href="${asset(filename)}" width="360" height="420" opacity="${opacity}"${extra}/>`;
    const radius = fill * fullRadius, edge = Math.max(0, (radius - feather) / Math.max(radius, 1));
    // The stylesheet sets .trace-colour/.trace-glow opacity, so weighted layers use an inline style instead of an attribute.
    const colour = fill <= 0 ? '' : `<image class="trace-colour" href="${asset('colour-close.png')}" width="360" height="420"${fill >= 1 ? '' : ` mask="url(#auc-fill-mask)"`}/>`;
    const halo = glow > 0.001 ? `<image class="trace-glow" href="${asset('halo-above.png')}" width="360" height="420" transform="translate(${centre.x} ${centre.y}) scale(${(.92 + .16 * glow).toFixed(3)}) translate(${-centre.x} ${-centre.y})" style="opacity:calc(var(--trace-colour-opacity, ${treatment.colourOpacity}) * ${glow.toFixed(3)})"/>` : '';
    const defs = fill > 0 && fill < 1 ? `<defs>
        <radialGradient id="auc-fill-gradient" gradientUnits="userSpaceOnUse" cx="${centre.x}" cy="${centre.y}" r="${radius.toFixed(2)}"><stop offset="0" stop-color="#fff"/><stop offset="${edge.toFixed(3)}" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
        <mask id="auc-fill-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="360" height="420"><circle cx="${centre.x}" cy="${centre.y}" r="${radius.toFixed(2)}" fill="url(#auc-fill-gradient)"/></mask>
      </defs>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 330" class="auc-art" style="aspect-ratio:360/330" role="img" data-aura-state="${selected}" data-aura-fill="${fill.toFixed(3)}" data-aura-glow="${glow.toFixed(3)}" aria-labelledby="auc-comparison-title auc-comparison-desc">
      <title id="auc-comparison-title">Total cortisol exposure</title>
      <desc id="auc-comparison-desc">Your example reading is ${value} ng per mg creatinine hours, shown by the larger figurine on the left. Below the illustrative range of 410 to 500, a green circle grows from the centre of the torso: small when the reading is far below the range and almost full as it nears 410, with no green at 0. Within the range the whole figurine is green with no outer glow. Above the range the figurine stays green and an outer lime-yellow glow grows with the reading. The smaller fully green figurine on the right shows the reference level. Both figures use the same material and colour treatment.</desc>
      ${defs}
      <g class="auc-personal" transform="translate(-30 0) scale(.8)" aria-hidden="true">
        ${halo}
        ${image('figurine-base.png', 'trace-model', treatment.modelOpacity)}
        ${colour}
      </g>
      <g class="auc-reference-miniature" transform="translate(246.54 150.99) scale(.38)" aria-hidden="true">
        ${image('figurine-base.png', 'trace-model', treatment.modelOpacity)}
        ${image('colour-close.png', 'trace-colour', treatment.colourOpacity)}
      </g>
      ${ranges.tag('auc-comparison', 326, 97, null, '410–500')}
    </svg>`;
  }
  root.TraceAucIllustration = render;
  if (typeof module !== 'undefined' && module.exports) module.exports = { render, auraFill, range };
})(typeof globalThis !== 'undefined' ? globalThis : this);
