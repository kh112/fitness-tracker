/* Small shared helpers. Dates are handled as plain 'YYYY-MM-DD' strings
   everywhere in this app — never Date objects in storage. A Date carries a
   timezone, and "the day I weighed myself" doesn't. */

/** Today, local time, as YYYY-MM-DD. */
export function todayISO() {
  return toISO(new Date());
}

export function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse 'YYYY-MM-DD' into a local-midnight Date (for arithmetic only). */
export function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidISO(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return toISO(fromISO(iso)) === iso;
}

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function daysBetween(isoA, isoB) {
  return Math.round((fromISO(isoB) - fromISO(isoA)) / 86400000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '23 Jul' — or '23 Jul 24' when the year isn't the current one. */
export function fmtDate(iso) {
  const d = fromISO(iso);
  const thisYear = new Date().getFullYear();
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === thisYear
    ? base
    : `${base} ${String(d.getFullYear()).slice(2)}`;
}

/** 'Today' / 'Yesterday' / 'Monday' (within a week) / '23 Jul'. */
export function fmtDateRelative(iso) {
  const diff = daysBetween(iso, todayISO());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) {
    return fromISO(iso).toLocaleDateString(undefined, { weekday: 'long' });
  }
  return fmtDate(iso);
}

/* Weeks start on Monday throughout this app. */
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 0 = Monday … 6 = Sunday. */
export function dayOfWeek(iso) {
  return (fromISO(iso).getDay() + 6) % 7;
}

/** The Monday of the week containing `iso`. */
export function startOfWeek(iso) {
  return addDays(iso, -dayOfWeek(iso));
}

/** '12–18 Aug' / '29 Sep – 5 Oct' — a week's date span, compactly. */
export function fmtWeekSpan(mondayISO) {
  const end = addDays(mondayISO, 6);
  const a = fromISO(mondayISO);
  const b = fromISO(end);
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}`
    : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}

/** One decimal, no trailing '.0' stripping — 72 kg should read '72.0'. */
export function fmtKg(kg) {
  return kg.toFixed(1);
}

/** Distances drop a pointless '.0': 10 km, not 10.0 km; but 10.5 km stays. */
export function fmtKm(km) {
  const n = Number(km) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Round to one decimal without floating-point crumbs. */
export function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

/**
 * Parse a decimal the user typed, accepting a comma or a dot.
 *
 * This exists because `<input type="number">` is locale-hostile: on a keyboard
 * whose decimal key is a comma — which is most of Europe, including here —
 * typing "79,2" makes the input *invalid*, and reading `.value` returns an
 * empty string. Not "79", not "79.2". Nothing. The number silently disappears
 * on the way out of the field.
 *
 * So every decimal field in this app is `type="text"` with
 * `inputmode="decimal"` (which still raises the numeric keypad) and comes
 * through here instead.
 *
 * @param {string} raw
 * @returns {number} NaN when the text isn't a plain number
 */
export function parseDecimal(raw) {
  const text = String(raw ?? '').trim().replace(',', '.');
  if (text === '') return NaN;
  // Reject anything that isn't purely a number — Number() is far too generous
  // ("0x10", "1e5" all parse), and a typo should fail loudly. A trailing
  // separator is allowed: "79," is what you have after typing the comma but
  // before the decimal, and it should mean 79 rather than an error.
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return NaN;
  return Number(text);
}

/**
 * Signed, fixed decimals: '+0.4', '-1.2', '0.0'.
 * `digits` goes to 2 for rates, where a day's worth of change is small enough
 * that one decimal rounds most of it away.
 */
export function fmtDelta(n, digits = 1) {
  // Round first, then sign. Going the other way prints '-0.0' for a change
  // too small to show, which reads as a loss that isn't there.
  const rounded = Number(n.toFixed(digits));
  const magnitude = Math.abs(rounded).toFixed(digits);
  if (rounded > 0) return `+${magnitude}`;
  if (rounded < 0) return `-${magnitude}`;
  return magnitude;
}

/**
 * Trailing rolling average over a *calendar* window, not over the last N
 * entries. If you skip three days the average still means "the last week",
 * which is the whole point of having it.
 *
 * @param {{date: string, kg: number}[]} rows sorted ascending by date
 * @param {number} windowDays
 * @returns {{date: string, avg: number}[]} one point per input row
 */
export function rollingAverage(rows, windowDays = 7) {
  const out = [];
  let start = 0;
  let sum = 0;

  for (let i = 0; i < rows.length; i++) {
    sum += rows[i].kg;
    const cutoff = addDays(rows[i].date, -(windowDays - 1));
    while (rows[start].date < cutoff) {
      sum -= rows[start].kg;
      start++;
    }
    out.push({ date: rows[i].date, avg: sum / (i - start + 1) });
  }
  return out;
}

/** Debounce, trailing edge. */
export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Flatten a children list: nested arrays in, renderable nodes out, with
 * null/undefined/false dropped so `cond ? el(...) : null` works inline.
 */
function flatten(children) {
  return children
    .flat(Infinity)
    .filter((c) => c !== null && c !== undefined && c !== false);
}

/** Build an element: el('div', {class: 'x'}, 'text', childNode). */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  node.append(...flatten(children));
  return node;
}

/**
 * Replace a node's contents, accepting the same loose children as `el()`.
 *
 * Native replaceChildren() takes Nodes and strings only: hand it an array and
 * it stringifies it, hand it null and you get the text "null". Every re-render
 * in this app goes through here instead.
 */
export function mount(node, ...children) {
  node.replaceChildren(...flatten(children));
  return node;
}
