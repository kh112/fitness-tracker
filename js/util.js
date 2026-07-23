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

/** One decimal, no trailing '.0' stripping — 72 kg should read '72.0'. */
export function fmtKg(kg) {
  return kg.toFixed(1);
}

/** Signed, one decimal: '+0.4', '-1.2', '0.0'. */
export function fmtDelta(n) {
  const s = n.toFixed(1);
  return n > 0 ? `+${s}` : s;
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
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c);
  }
  return node;
}
