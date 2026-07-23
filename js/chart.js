/* A hand-rolled SVG line chart. No library, because this app has exactly one
 * chart shape (a value against time) and a charting library is bigger than the
 * rest of the app put together.
 *
 * The x axis is real elapsed time, not entry index — if you skip a fortnight,
 * the chart should show a fortnight-shaped gap rather than quietly closing it.
 */

import { fromISO, fmtDate } from './util.js';

const NS = 'http://www.w3.org/2000/svg';

function s(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Round numbers spanning [min, max] — roughly `target` of them. */
function niceTicks(min, max, target = 4) {
  const span = max - min;
  if (span <= 0) return [min];

  const mag = Math.pow(10, Math.floor(Math.log10(span / target)));
  const candidates = [0.5, 1, 2, 2.5, 5, 10].map((m) => m * mag);

  let step = candidates.find((v) => v >= span / target) ?? candidates.at(-1);
  const countFor = (st) => Math.floor(max / st) - Math.ceil(min / st) + 1;
  // Two gridlines on a chart reads as an accident. Step down once if needed.
  if (countFor(step) < 3) {
    const i = candidates.indexOf(step);
    if (i > 0) step = candidates[i - 1];
  }

  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

/**
 * @param {object} o
 * @param {{date: string, kg: number}[]} o.points  raw entries, ascending
 * @param {{date: string, avg: number}[]} o.avg    rolling average, ascending
 * @param {number} o.width
 * @param {number} o.height
 * @returns {SVGElement}
 */
export function weightChart({ points, avg, width, height = 210 }) {
  const PAD_L = 38, PAD_R = 12, PAD_T = 14, PAD_B = 26;
  const w = Math.max(width, 240);
  const plotW = w - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;

  const svg = s('svg', {
    class: 'chart',
    viewBox: `0 0 ${w} ${height}`,
    width: w,
    height,
    role: 'img',
    'aria-label': describe(points),
  });

  if (points.length === 0) return svg;

  /* ---- scales ---- */

  const times = points.map((p) => fromISO(p.date).getTime());
  const tMin = times[0];
  const tMax = times[times.length - 1];
  const tSpan = tMax - tMin || 1;

  const values = points.map((p) => p.kg).concat(avg.map((a) => a.avg));
  let vMin = Math.min(...values);
  let vMax = Math.max(...values);
  const headroom = Math.max((vMax - vMin) * 0.18, 0.6);
  vMin -= headroom;
  vMax += headroom;

  // A single point has no span to plot against — park it in the middle.
  const x = (t) => (points.length === 1
    ? PAD_L + plotW / 2
    : PAD_L + ((t - tMin) / tSpan) * plotW);
  const y = (v) => PAD_T + (1 - (v - vMin) / (vMax - vMin)) * plotH;

  /* ---- gridlines + y labels ---- */

  for (const tick of niceTicks(vMin, vMax, 4)) {
    const ty = y(tick);
    svg.append(s('line', {
      x1: PAD_L, x2: w - PAD_R, y1: ty, y2: ty,
      stroke: 'var(--line-soft)', 'stroke-width': 1,
    }));
    const label = s('text', {
      x: PAD_L - 8, y: ty + 4,
      'text-anchor': 'end',
      fill: 'var(--ink-faint)',
      'font-size': 11,
      'font-weight': 600,
    });
    label.textContent = String(tick);
    svg.append(label);
  }

  /* ---- x labels: first, middle, last (as many as fit) ---- */

  const xLabels = points.length === 1
    ? [points[0]]
    : [points[0], points[Math.floor((points.length - 1) / 2)], points[points.length - 1]];

  const seen = new Set();
  xLabels.forEach((p, i) => {
    if (seen.has(p.date)) return;
    seen.add(p.date);
    const px = x(fromISO(p.date).getTime());
    const anchor = i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle';
    const label = s('text', {
      x: px, y: height - 7,
      'text-anchor': points.length === 1 ? 'middle' : anchor,
      fill: 'var(--ink-faint)',
      'font-size': 11,
      'font-weight': 600,
    });
    label.textContent = fmtDate(p.date);
    svg.append(label);
  });

  /* ---- raw daily dots ---- */

  for (const p of points) {
    svg.append(s('circle', {
      cx: x(fromISO(p.date).getTime()),
      cy: y(p.kg),
      r: 2.6,
      fill: 'var(--ink-faint)',
    }));
  }

  /* ---- rolling average line: the actual signal ---- */

  if (avg.length > 1) {
    const d = avg
      .map((a, i) => `${i === 0 ? 'M' : 'L'}${x(fromISO(a.date).getTime()).toFixed(1)},${y(a.avg).toFixed(1)}`)
      .join(' ');
    svg.append(s('path', {
      d,
      fill: 'none',
      stroke: 'var(--accent)',
      'stroke-width': 2.75,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }));
  }

  /* ---- head of the line ---- */

  const last = avg[avg.length - 1] ?? { date: points[points.length - 1].date, avg: points[points.length - 1].kg };
  const hx = x(fromISO(last.date).getTime());
  const hy = y(last.avg);
  svg.append(s('circle', { cx: hx, cy: hy, r: 5.5, fill: 'var(--bg)' }));
  svg.append(s('circle', { cx: hx, cy: hy, r: 3.5, fill: 'var(--accent)' }));

  return svg;
}

/**
 * A tiny inline trend line — no axes, no labels, just the shape.
 * Used one per measurement so a list of them reads as a set of trends.
 *
 * @param {{date: string, value: number}[]} points ascending
 */
export function sparkline(points, { width = 78, height = 26, color = 'var(--accent)' } = {}) {
  const svg = s('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width, height,
    'aria-hidden': 'true',
    style: 'display:block;overflow:visible',
  });
  if (points.length === 0) return svg;

  const pad = 3;
  const times = points.map((p) => fromISO(p.date).getTime());
  const tMin = times[0];
  const tSpan = (times[times.length - 1] - tMin) || 1;

  const values = points.map((p) => p.value);
  const vMin = Math.min(...values);
  const vSpan = (Math.max(...values) - vMin) || 1;

  const x = (t) => (points.length === 1 ? width / 2 : ((t - tMin) / tSpan) * width);
  const y = (v) => height - pad - ((v - vMin) / vSpan) * (height - pad * 2);

  if (points.length === 1) {
    svg.append(s('circle', { cx: width / 2, cy: height / 2, r: 3, fill: color }));
    return svg;
  }

  svg.append(s('path', {
    d: points.map((p, i) =>
      `${i === 0 ? 'M' : 'L'}${x(times[i]).toFixed(1)},${y(p.value).toFixed(1)}`).join(' '),
    fill: 'none',
    stroke: color,
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }));
  svg.append(s('circle', {
    cx: x(times[times.length - 1]),
    cy: y(values[values.length - 1]),
    r: 2.8,
    fill: color,
  }));
  return svg;
}

function describe(points) {
  if (!points.length) return 'Weight chart, no entries yet';
  const first = points[0];
  const last = points[points.length - 1];
  return `Weight chart, ${points.length} entries from ${fmtDate(first.date)} ` +
         `to ${fmtDate(last.date)}, ${first.kg.toFixed(1)} to ${last.kg.toFixed(1)} kilograms`;
}
