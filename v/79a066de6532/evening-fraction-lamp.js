(function (root) {
  'use strict';
  const ranges = root.TraceReferenceRanges || (typeof require === 'function' ? require('./reference-ranges.js') : null);
  const treatment = root.TraceIllustrationTreatment || (typeof require === 'function' ? require('./illustration-treatment.js') : null);
  // Evening fraction = evening reading / average of the three readings (1 = a flat day).
  // How much of the lamp is lit (0 = dark, 1 = the whole lamp), derived only from the value:
  //   0                 -> 0 (no light)
  //   below 0.17        -> grows from 0 towards 30% as (value / 0.17) ^ 1.5
  //   0.17 - 0.24       -> 30% (the reference range)
  //   0.24 - 1.0        -> rises from 30% to 95% on a log scale
  //   1.0 and above     -> 95% creeping to 100% (reached at 2.0 or more)
  const range = { low: .17, high: .24 }, lit = { range: .30, nearFull: .95 };
  const clamp01 = n => Math.min(1, Math.max(0, n));
  function litFraction(value, state) {
    const n = Number(value);
    if (!Number.isFinite(n)) return { below: .05, close: lit.range, above: .6 }[state] ?? lit.range;
    if (n <= 0) return 0;
    if (n < range.low) return lit.range * Math.pow(n / range.low, 1.5);
    if (n <= range.high) return lit.range;
    if (n < 1) return lit.range + (lit.nearFull - lit.range) * Math.log(n / range.high) / Math.log(1 / range.high);
    return lit.nearFull + (1 - lit.nearFull) * clamp01(Math.log2(n));
  }
  // Lamp geometry in the 360x420 artwork space: the lamp body is a rounded rectangle about 183 wide and 255 tall resting at y 307.
  // The light takes the lamp's own shape: a copy of the body outline scaled from the base by the lit fraction, so it grows from
  // a small lamp-shaped glow at the bulb to the whole lamp. The original light artwork (colour-above.png, an egg about 94 x 121
  // with a coral core) supplies the colour and grain, positioned so its core sits low, at the bulb.
  const lamp = { x: 180, bottom: 307, halfWidth: 91.5, height: 255, corner: 44 }, egg = { halfWidth: 47, halfHeight: 60.5, centreY: 245.5 };
  function shapePath(fraction, grow = 0) {
    const x0 = lamp.x - lamp.halfWidth * fraction - grow, x1 = lamp.x + lamp.halfWidth * fraction + grow;
    const y0 = lamp.bottom - lamp.height * fraction - grow, y1 = lamp.bottom;
    const r = Math.min(lamp.corner * fraction + grow, (x1 - x0) / 2, (y1 - y0) / 2), f = n => n.toFixed(2);
    return `M ${f(x0 + r)} ${f(y0)} H ${f(x1 - r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x1)} ${f(y0 + r)} V ${f(y1 - r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x1 - r)} ${f(y1)} H ${f(x0 + r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x0)} ${f(y1 - r)} V ${f(y0 + r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x0 + r)} ${f(y0)} Z`;
  }
  function render(state, value) {
    const selected = ['below', 'close', 'above'].includes(state) ? state : 'close';
    const id = 'evening-lamp';
    const asset = name => `assets/evening-fraction/${name}?v=${treatment.version}-ethereal-diffused-4`;
    const fraction = litFraction(value, selected);
    // The stylesheet sets .trace-colour/.trace-glow opacity, so weighted layers use an inline style.
    function light(key, lit) {
      if (lit <= 0.001) return { defs: '', body: '' };
      const sx = lamp.halfWidth * lit * 1.1 / egg.halfWidth, sy = .7 * lamp.height * lit * 1.15 / egg.halfHeight;
      const coreY = lamp.bottom - .3 * lamp.height * lit;
      const transform = `translate(${lamp.x} ${coreY.toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${-lamp.x} ${-egg.centreY})`;
      // Core light has a wide soft edge; a second, fainter and wider layer lets the glow disperse outwards instead of ending sharply.
      const feather = Math.max(4, 19 * lit).toFixed(2), outerFeather = Math.max(10, 36 * lit).toFixed(2);
      const haloWeight = clamp01((lit - .1) / .5), halo = haloWeight * haloWeight * (3 - 2 * haloWeight);
      const defs = `<filter id="${key}-feather" filterUnits="userSpaceOnUse" x="-40" y="-40" width="440" height="500"><feGaussianBlur stdDeviation="${feather}"/></filter>
        <filter id="${key}-halo-blur" filterUnits="userSpaceOnUse" x="-80" y="-80" width="520" height="580"><feGaussianBlur stdDeviation="${(18 + 20 * lit).toFixed(1)}"/></filter>
        <filter id="${key}-outer-feather" filterUnits="userSpaceOnUse" x="-80" y="-80" width="520" height="580"><feGaussianBlur stdDeviation="${outerFeather}"/></filter>
        <mask id="${key}-shape" maskUnits="userSpaceOnUse" x="-40" y="-40" width="440" height="500"><path d="${shapePath(lit)}" fill="#fff" filter="url(#${key}-feather)"/></mask>
        <mask id="${key}-shape-outer" maskUnits="userSpaceOnUse" x="-80" y="-80" width="520" height="580"><path d="${shapePath(lit, 12 + 16 * lit)}" fill="#fff" filter="url(#${key}-outer-feather)"/></mask>`;
      const haloMarkup = halo > .001 ? `<path d="${shapePath(lit, 10)}" fill="#fecf69" class="trace-glow" style="opacity:calc(var(--trace-colour-opacity, ${treatment.colourOpacity}) * ${(halo * .5).toFixed(3)})" filter="url(#${key}-halo-blur)"/>` : '';
      const colour = `<image class="trace-colour" href="${asset('colour-above.png')}" width="360" height="420" transform="${transform}"`;
      const body = `${haloMarkup}<g mask="url(#lamp-silhouette-soft)"><g mask="url(#${key}-shape-outer)">${colour} style="opacity:calc(var(--trace-colour-opacity, ${treatment.colourOpacity}) * .6)"/></g></g><g mask="url(#lamp-silhouette)"><g mask="url(#${key}-shape)">${colour}/></g></g>`;
      return { defs, body };
    }
    const personal = light('lamp-personal', fraction), reference = light('lamp-reference', lit.range);
    const lampMarkup = glow => `<image class="trace-model" href="${asset('base.png')}" width="360" height="420" opacity="${treatment.modelOpacity}"/>${glow}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 285" class="object-art" style="aspect-ratio:360/285;overflow:visible" role="img" aria-labelledby="${id}-title ${id}-desc" data-light-state="${selected}" data-lit="${fraction.toFixed(3)}">
      <title id="${id}-title">Evening fraction</title>
      <desc id="${id}-desc">The larger neutral ribbed lantern on the left shows your example evening fraction of ${value}. Light shaped like the lamp itself rises from the bulb at its base and fills more of the lamp as the fraction grows: none at 0, about a third of the lamp within the illustrative reference range of 0.17 to 0.24, and nearly the whole lamp at a fraction of 1. The grainy coral centre, orange and amber burnt gradients and golden edges are unchanged; only the size and shape of the light change. The smaller matching lamp on the right shows the fixed reference light. The reference range is shown at the top right of the card. Both lamps use the same material and colour treatment.</desc>
      <defs>
        <filter id="lamp-silhouette-blur" filterUnits="userSpaceOnUse" x="-40" y="-40" width="440" height="500"><feGaussianBlur stdDeviation="5"/></filter>
        <filter id="lamp-silhouette-blur-soft" filterUnits="userSpaceOnUse" x="-60" y="-60" width="480" height="540"><feGaussianBlur stdDeviation="16"/></filter>
        <mask id="lamp-silhouette" maskUnits="userSpaceOnUse" x="-40" y="-40" width="440" height="500" style="mask-type:alpha"><image href="${asset('base.png')}" width="360" height="420" filter="url(#lamp-silhouette-blur)"/></mask>
        <mask id="lamp-silhouette-soft" maskUnits="userSpaceOnUse" x="-60" y="-60" width="480" height="540" style="mask-type:alpha"><image href="${asset('base.png')}" width="360" height="420" filter="url(#lamp-silhouette-blur-soft)"/></mask>
        ${personal.defs}${reference.defs}
      </defs>
      <g class="lamp-personal" transform="translate(-30 0) scale(.8)" aria-hidden="true">${lampMarkup(personal.body)}</g>
      <g class="lamp-reference-miniature" transform="translate(244.45 129.36) scale(.38)" aria-hidden="true">${lampMarkup(reference.body)}</g>
      ${ranges.tag(id, 326, 73, null, '0.17–0.24')}
    </svg>`;
  }
  root.TraceEveningFractionIllustration = render;
  if (typeof module !== 'undefined' && module.exports) module.exports = { render, litFraction, range, lit };
})(typeof globalThis !== 'undefined' ? globalThis : this);
