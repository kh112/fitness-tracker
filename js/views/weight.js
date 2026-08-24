/* Weight view — the app's home screen.
 *
 * Layout priority, top to bottom: what you weigh now, how it's trending, then
 * the raw entries. The log action lives in the top-right of the nav bar.
 */

import * as db from '../db.js';
import { weightChart } from '../chart.js';
import { toast, confirmDialog, sheet, sheetHead, navAction, icon } from '../ui.js';
import {
  el, mount, todayISO, addDays, daysBetween, fmtDate, fmtDateRelative,
  fmtKg, fmtDelta, isValidISO, rollingAverage, parseDecimal,
} from '../util.js';

const RANGES = [
  { key: '30', label: '30d', days: 30 },
  { key: '90', label: '90d', days: 90 },
  { key: 'all', label: 'All', days: null },
];

let rangeKey = '30';
let rows = [];          // all entries, ascending
let chartHost = null;   // element the chart is drawn into

export async function render(view) {
  rows = await db.listWeights();

  mount(view,
    el('h1', { class: 'large-title', text: 'Weight' }),
    el('div', { class: 'stack' },
      heroSection(),
      chartSection(),
      entriesSection(),
    ),
  );

  navAction('Log weight', () => openSheet(null));
  drawChart();
  observeChart();
}

/* ------------------------------------------------------------------ hero */

function heroSection() {
  if (rows.length === 0) {
    return el('section', { class: 'panel empty' },
      el('strong', {}, 'No weigh-ins yet'),
      'Step on the scale, tap Log weight. One entry a day is plenty.',
    );
  }

  const latest = rows[rows.length - 1];
  const avg = rollingAverage(rows, 7);
  const latestAvg = avg[avg.length - 1].avg;
  const change = sinceStart(avg);

  return el('section', { class: 'panel hero' },
    el('div', {},
      el('div', { class: 'hero__reading' },
        el('span', { class: 'hero__value', text: fmtKg(latest.kg) }),
        el('span', { class: 'hero__unit', text: 'kg' }),
      ),
      el('div', { class: 'hero__meta', style: 'margin-top:8px' },
        `${fmtDateRelative(latest.date)} · 7-day average ${fmtKg(latestAvg)} kg`),
    ),
    el('div', { class: 'hero__stats' },
      statTile('Average per day', change.perDay, 2, 'kg/day'),
      statTile(`Since ${fmtDate(rows[0].date)}`, change.total, 1, 'kg'),
    ),
  );
}

/**
 * Change since the first weigh-in, as a total and as a daily rate.
 *
 * The far end is the 7-day average rather than today's raw reading, so one
 * dehydrated morning can't read as progress. The near end is the first entry
 * itself — the trailing average of a single point *is* that point — which is
 * the honest reading of "since the start": it's the number you'd get comparing
 * the app's first row to its last. The cost is that a bad first weigh-in
 * skews every since-the-start figure for good, which is a fair trade against
 * a starting point you can't reconcile with your own log.
 *
 * Both are null until there are two entries on different days, because a rate
 * over a zero-day span is a division by zero wearing a label.
 */
function sinceStart(avg) {
  if (avg.length < 2) return { total: null, perDay: null };

  const first = avg[0];
  const last = avg[avg.length - 1];
  const total = last.avg - first.avg;
  const days = daysBetween(first.date, last.date);

  return { total, perDay: days > 0 ? total / days : null };
}

function statTile(label, delta, digits, unit) {
  // Threshold scales with the precision shown, so a tile reading '-0.02' is
  // never coloured as flat and one reading '0.0' is never coloured as a loss.
  const epsilon = 0.5 * Math.pow(10, -digits);
  const dir = delta === null ? 'flat'
    : delta > epsilon ? 'up'
    : delta < -epsilon ? 'down'
    : 'flat';

  return el('div', { class: 'stat' },
    el('div', { class: 'stat__label', text: label }),
    el('div', {
      class: `stat__value stat__value--${dir}`,
      text: delta === null ? '—' : `${fmtDelta(delta, digits)} ${unit}`,
    }),
  );
}

/* ----------------------------------------------------------------- chart */

function chartSection() {
  if (rows.length === 0) {
    chartHost = null;
    return null;
  }

  chartHost = el('div', { class: 'chart__wrap' });

  return el('section', { class: 'section' },
    el('div', { class: 'section__head' },
      el('h2', { class: 'section__title', text: 'Trend' }),
      el('div', { class: 'segmented', role: 'group', 'aria-label': 'Chart range' },
        RANGES.map((r) =>
          el('button', {
            type: 'button',
            'aria-pressed': String(r.key === rangeKey),
            onclick: () => setRange(r.key),
          }, r.label),
        ),
      ),
    ),
    el('div', { class: 'panel' },
      chartHost,
      el('div', { class: 'chart-legend' },
        el('span', {}, el('i', { class: 'dot' }), '  daily'),
        el('span', {}, el('i', {}), '  7-day average'),
      ),
    ),
  );
}

function setRange(key) {
  rangeKey = key;
  for (const btn of document.querySelectorAll('.segmented button')) {
    btn.setAttribute('aria-pressed',
      String(RANGES.find((r) => r.label === btn.textContent).key === key));
  }
  drawChart();
}

function visibleRows() {
  const range = RANGES.find((r) => r.key === rangeKey);
  if (!range.days || rows.length === 0) return rows;
  const cutoff = addDays(rows[rows.length - 1].date, -range.days);
  const windowed = rows.filter((r) => r.date >= cutoff);
  // Never render an empty chart just because the range is short.
  return windowed.length ? windowed : rows.slice(-1);
}

let lastChartWidth = 0;

function drawChart() {
  if (!chartHost) return;
  const width = chartHost.clientWidth || 358;
  lastChartWidth = width;

  const points = visibleRows();
  // The average is computed over *all* history so the line entering the
  // window is already warmed up, then clipped to what's on screen.
  const fullAvg = rollingAverage(rows, 7);
  const from = points[0]?.date;
  const avg = from ? fullAvg.filter((a) => a.date >= from) : [];

  mount(chartHost, weightChart({ points, avg, width }));
}

/* Redraw on layout change — rotating the phone, or the container resizing for
   any other reason. A `window.resize` listener misses container-only changes,
   and the chart is drawn at real pixel width rather than scaled, so a stale
   width means blurry, wrongly-sized axis text. */
const chartResize = new ResizeObserver((entries) => {
  const width = Math.round(entries[0].contentRect.width);
  if (width && width !== lastChartWidth) drawChart();
});

function observeChart() {
  chartResize.disconnect();
  if (chartHost) chartResize.observe(chartHost);
}

// Belt and braces: ResizeObserver delivery is tied to the rendering loop, which
// some contexts throttle. These fire as plain events. The width guard means
// whichever arrives first wins and the other is a no-op.
function redrawIfResized() {
  if (chartHost && chartHost.clientWidth && chartHost.clientWidth !== lastChartWidth) {
    drawChart();
  }
}
window.addEventListener('resize', redrawIfResized);
window.addEventListener('orientationchange', () => setTimeout(redrawIfResized, 150));

/* --------------------------------------------------------------- entries */

function entriesSection() {
  if (rows.length === 0) return null;

  const newestFirst = [...rows].reverse();

  return el('section', { class: 'section' },
    el('div', { class: 'section__head' },
      el('h2', { class: 'section__title', text: 'Entries' }),
      el('span', { class: 'entry__sub', text: `${rows.length} total` }),
    ),
    el('ul', { class: 'panel entries' },
      newestFirst.map((row, i) => {
        const prev = newestFirst[i + 1];
        const change = prev ? row.kg - prev.kg : null;

        return el('li', { class: 'entry' },
          el('button', {
            class: 'entry__main',
            type: 'button',
            onclick: () => openSheet(row),
            'aria-label': `Edit ${fmtDate(row.date)}, ${fmtKg(row.kg)} kilograms`,
          },
            el('span', {},
              el('div', { class: 'entry__date', text: fmtDateRelative(row.date) }),
              change !== null
                ? el('div', { class: 'entry__sub', text: `${fmtDelta(change)} kg` })
                : el('div', { class: 'entry__sub', text: 'first entry' }),
            ),
            el('span', { class: 'entry__kg', text: `${fmtKg(row.kg)} kg` }),
          ),
          el('button', {
            class: 'icon-btn',
            type: 'button',
            'aria-label': `Delete entry for ${fmtDate(row.date)}`,
            onclick: () => removeEntry(row),
          }, icon('trash')),
        );
      }),
    ),
  );
}

/* ------------------------------------------------------------------- log */

/**
 * @param {{date: string, kg: number}|null} existing editing an entry, or null to add
 */
function openSheet(existing) {
  const isEdit = Boolean(existing);
  const originalDate = existing?.date ?? null;

  const dateInput = el('input', {
    type: 'date',
    id: 'w-date',
    value: existing?.date ?? todayISO(),
    max: todayISO(),
    required: true,
  });

  // type=text, not number: a comma decimal makes a number input report an
  // empty value. See parseDecimal in util.js.
  const kgInput = el('input', {
    type: 'text',
    id: 'w-kg',
    inputmode: 'decimal',
    placeholder: '0.0',
    value: existing ? fmtKg(existing.kg) : '',
  });

  const error = el('div', { class: 'field__error', role: 'alert' });

  // novalidate: the browser's own validation bubble is a transient tooltip that
  // is easy to miss on a phone. We validate below and write the reason into a
  // line of text that stays put.
  const form = el('form', { class: 'sheet__inner', novalidate: true },
    sheetHead(isEdit ? 'Edit weigh-in' : 'Log weight', () => dismiss()),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'w-kg', text: 'Weight (kg)' }),
      kgInput,
    ),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'w-date', text: 'Date' }),
      dateInput,
    ),
    error,
    el('div', { class: 'sheet__actions' },
      el('button', { class: 'btn btn--primary btn--block', type: 'submit' },
        isEdit ? 'Save changes' : 'Save'),
      isEdit
        ? el('button', {
            class: 'btn btn--block btn--danger', type: 'button',
            onclick: async () => { dismiss(); await removeEntry(existing); },
          }, 'Delete entry')
        : null,
    ),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';

    const date = dateInput.value;
    const kg = parseDecimal(kgInput.value);

    if (!isValidISO(date)) { error.textContent = 'Pick a valid date.'; return; }
    if (date > todayISO()) { error.textContent = "That's in the future."; return; }
    if (!Number.isFinite(kg) || kg < 20 || kg > 400) {
      error.textContent = 'Enter a weight between 20 and 400 kg.';
      kgInput.focus();
      return;
    }

    // One entry per day: warn before clobbering a different day's reading.
    if (date !== originalDate) {
      const clash = await db.getWeight(date);
      if (clash) {
        const ok = await confirmDialog({
          title: `Replace ${fmtDate(date)}?`,
          body: `That day already has ${fmtKg(clash.kg)} kg logged. Saving replaces it.`,
          confirmLabel: 'Replace',
        });
        if (!ok) return;
      }
    }

    await db.putWeight({ date, kg: Math.round(kg * 10) / 10 });
    // Moving an entry to another date shouldn't leave a copy behind.
    if (isEdit && originalDate !== date) await db.deleteWeight(originalDate);

    dismiss();
    await render(document.getElementById('view'));
    toast(isEdit ? 'Entry updated' : `Logged ${fmtKg(kg)} kg`);
  });

  const { dismiss } = sheet(form);
  if (!isEdit) kgInput.focus();
}

async function removeEntry(row) {
  const ok = await confirmDialog({
    title: `Delete ${fmtDate(row.date)}?`,
    body: `${fmtKg(row.kg)} kg. This can't be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;

  await db.deleteWeight(row.date);
  await render(document.getElementById('view'));
  toast('Entry deleted');
}
