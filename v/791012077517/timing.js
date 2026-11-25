// Sample timing: turn three real sample times and readings into the standard report points.
// The first sample defines waking (hour 0) and is never changed. The report needs +2h and +14h.
//
// Story the numbers should tell: cortisol climbs after waking to a morning high around +2h,
// then falls through the day. Between two samples the level changes by a steady percentage
// per hour (straight line on a log scale), using only this person's own readings.
//   +2h, second sample late (2-4 h):  trace back along their own decline (second -> evening).
//   +2h, second sample early (1-2 h): continue their own morning rise (waking -> second).
//   If the readings show no decline (or no rise) to follow, the measured value is kept as is.
//   +14h: along their own decline (second -> evening): in between if the evening sample is later,
//         carried forward if it is earlier.
// No accommodation changes a reading by more than a factor of 2 (capped and flagged).
// Samples outside the allowed windows are rejected rather than guessed.
(function (root) {
  'use strict';
  const METHOD = 'log-linear-v2';
  const TARGET = Object.freeze({ w2: 2, e: 14 });
  const WINDOW = Object.freeze({ w2: [1, 4], e: [8, 20] });
  const MAX_READING = 1000000, MAX_FACTOR = 2;
  const SIZE = Object.freeze({ small: 0.10, moderate: 0.25 }); // relative change thresholds
  const labels = { w: 'first (waking)', w2: 'second', e: 'evening' };

  function parseClock(value, which) {
    const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value == null ? '' : value).trim());
    if (!match) throw new Error('Enter the ' + labels[which] + ' sample time as HH:MM (24-hour clock).');
    return Number(match[1]) * 60 + Number(match[2]);
  }
  function reading(value, which) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > MAX_READING)
      throw new Error('Enter a positive number up to 1,000,000 for the ' + labels[which] + ' reading.');
    return n;
  }
  // Hours after the first sample. A clock time earlier than the previous sample means the next day.
  function hoursAfterFirst(times) {
    const w = parseClock(times.w, 'w');
    let w2 = parseClock(times.w2, 'w2'), e = parseClock(times.e, 'e');
    if (w2 <= w) w2 += 1440;
    while (e <= w2) e += 1440;
    return { w2: (w2 - w) / 60, e: (e - w) / 60 };
  }
  const along = (a, b, t) => a.v * Math.pow(b.v / a.v, (t - a.t) / (b.t - a.t));
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const formatHours = h => { const m = Math.round(h * 60); return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + String(m % 60).padStart(2, '0') + ' m' : ''); };
  function limit(measured, value) {
    const lo = measured / MAX_FACTOR, hi = measured * MAX_FACTOR;
    return value > hi ? { value: hi, capped: true } : value < lo ? { value: lo, capped: true } : { value, capped: false };
  }
  function sizeOf(measured, value) {
    const change = value / measured - 1, mag = Math.abs(change);
    return { change, size: mag < 1e-9 ? 'none' : mag < SIZE.small ? 'small' : mag < SIZE.moderate ? 'moderate' : 'large' };
  }

  function estimate(input) {
    if (!input || typeof input !== 'object' || !input.times || !input.readings) throw new Error('Enter three sample times and three readings.');
    const r = { w: reading(input.readings.w, 'w'), w2: reading(input.readings.w2, 'w2'), e: reading(input.readings.e, 'e') };
    const hours = hoursAfterFirst(input.times);
    if (hours.w2 < WINDOW.w2[0] || hours.w2 > WINDOW.w2[1])
      throw new Error('The second sample was taken ' + formatHours(hours.w2) + ' after the first. It must be between 1 and 4 hours after it.');
    if (hours.e < WINDOW.e[0] || hours.e > WINDOW.e[1])
      throw new Error('The evening sample was taken ' + formatHours(hours.e) + ' after the first. It must be between 8 and 20 hours after it.');
    const p0 = { t: 0, v: r.w }, p1 = { t: hours.w2, v: r.w2 }, p2 = { t: hours.e, v: r.e };
    const declining = p2.v < p1.v, rising = p1.v > p0.v;

    // +2h
    let w2, w2how;
    if (near(p1.t, TARGET.w2)) { w2 = p1.v; w2how = 'on-time'; }
    else if (p1.t > TARGET.w2) { if (declining) { w2 = along(p1, p2, TARGET.w2); w2how = 'traced-back'; } else { w2 = p1.v; w2how = 'kept-no-decline'; } }
    else { if (rising) { w2 = along(p0, p1, TARGET.w2); w2how = 'continued-rise'; } else { w2 = p1.v; w2how = 'kept-no-rise'; } }
    // +14h
    let e, ehow;
    if (near(p2.t, TARGET.e)) { e = p2.v; ehow = 'on-time'; }
    else { e = along(p1, p2, TARGET.e); ehow = p2.t > TARGET.e ? 'traced-back' : 'carried-forward'; }

    const w2l = limit(p1.v, w2), el = limit(p2.v, e);
    for (const [key, value] of [['w2', w2l.value], ['e', el.value]])
      if (!(value > 0) || value > MAX_READING) throw new Error('The estimated ' + labels[key] + ' value falls outside the allowed range. Check the readings and times.');
    const describe = (key, point, how, lim) => ({
      key, measured: point.v, takenAtHours: point.t, targetHours: TARGET[key], estimated: lim.value,
      method: how, capped: lim.capped, ...sizeOf(point.v, lim.value)
    });
    const adjustments = [
      { key: 'w', measured: r.w, takenAtHours: 0, targetHours: 0, estimated: r.w, method: 'on-time', capped: false, change: 0, size: 'none' },
      describe('w2', p1, w2how, w2l), describe('e', p2, ehow, el)
    ];
    return { method: METHOD, sample: { w: r.w, w2: w2l.value, e: el.value, eveningHours: TARGET.e }, adjustments, notes: storyNotes(r, w2l.value, el.value) };
  }

  // Plain checks on whether the final three numbers tell the usual morning-high, evening-low story.
  function storyNotes(r, w2, e) {
    const notes = [];
    if (w2 <= r.w) notes.push('No morning rise: the +2h value is not above the waking value.');
    if (e >= w2) notes.push('No evening fall: the evening value is not below the +2h value.');
    if (e > r.w) notes.push('Evening ends higher than waking.');
    return notes;
  }

  const fmtDefault = n => String(Math.round(n * 100) / 100);
  const pct = c => (c > 0 ? '+' : '−') + Math.round(Math.abs(c) * 100) + '%';
  // One line per adjusted sample, written for the admin.
  function summary(a, format) {
    const f = format || fmtDefault, at = formatHours(a.takenAtHours), to = formatHours(a.targetHours);
    const head = (a.key === 'w' ? 'First sample (waking)' : a.key === 'w2' ? 'Second sample' : 'Evening sample') + ' at ' + at + ': ' + f(a.measured);
    const tail = a.method === 'on-time' || a.size === 'none' ? '' : ' (' + pct(a.change) + ', ' + a.size + (a.capped ? ', capped at ×2' : '') + ')';
    switch (a.method) {
      case 'on-time': return head + '. On time, no change.';
      case 'traced-back': return head + '. Taken after ' + to + ', so traced back along this person’s own ' + (a.key === 'w2' ? 'decline' : 'afternoon trend') + ': ' + f(a.estimated) + ' at ' + to + tail + '.';
      case 'continued-rise': return head + '. Taken before ' + to + ', so the morning rise was continued: ' + f(a.estimated) + ' at ' + to + tail + '.';
      case 'carried-forward': return head + '. Taken before ' + to + ', so this person’s own afternoon trend was carried forward: ' + f(a.estimated) + ' at ' + to + tail + '.';
      case 'kept-no-decline': return head + '. Taken after ' + to + ', but the readings show no decline to trace back, so it is used as measured.';
      case 'kept-no-rise': return head + '. Taken before ' + to + ', but the readings show no morning rise to continue, so it is used as measured.';
      default: return head + '.';
    }
  }
  // The three final numbers as a short story, with real clock times.
  // Estimates are rounded in the story ("about 57"): two decimals would claim precision the estimate does not have.
  const rough = n => n >= 10 ? String(Math.round(n)) : n >= 1 ? String(Math.round(n * 10) / 10) : String(Number(n.toPrecision(2)));
  function story(result, times, format) {
    const f = format || fmtDefault, [, a2, ae] = result.adjustments, s = result.sample;
    const clock = h => { const m = (parseClock(times.w, 'w') + Math.round(h * 60)) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
    const part = (a, value) => a.method === 'on-time' || a.method.startsWith('kept') ? f(value) + ' at ' + clock(a.takenAtHours) : 'about ' + rough(value) + ' by ' + clock(a.targetHours) + ' (measured ' + f(a.measured) + ' at ' + clock(a.takenAtHours) + ')';
    const verb2 = s.w2 > s.w ? 'rose to ' : 'stayed near ', verbE = s.e < s.w2 ? 'fell to ' : 'stayed up at ';
    return 'Woke at ' + times.w + ' with ' + f(s.w) + ', ' + verb2 + part(a2, s.w2) + ', then ' + verbE + part(ae, s.e) + '.';
  }
  const api = Object.freeze({ METHOD, TARGET, WINDOW, MAX_FACTOR, SIZE, estimate, hoursAfterFirst, summary, story, formatHours });
  root.TraceTiming = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
