/* Weight view — the app's home screen.
 *
 * Layout priority, top to bottom: what you weigh now, how it's trending, then
 * the raw entries. The log button is a fixed FAB so "log the thing I just did"
 * is one tap from launch, regardless of scroll position.
 */

import * as db from '../db.js';
import { weightChart } from '../chart.js';
import { toast, confirmDialog, sheet, icon } from '../ui.js';
import {
  el, todayISO, addDays, daysBetween, fmtDate, fmtDateRelative,
  fmtKg, fmtDelta, isValidISO, rollingAverage,
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

  view.replaceChildren(
    el('div', { class: 'stack' },
      heroSection(),
      chartSection(),
      entriesSection(),
    ),
    fab(),
  );

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
      statTile('Last 7 days', deltaOver(avg, 7)),
      statTile('Last 30 days', deltaOver(avg, 30)),
    ),
  );
}

/**
 * Change in the 7-day average over the last `days`. Comparing averages rather
 * than raw readings keeps a single dehydrated morning from reading as progress.
 * Returns null when there's no entry old enough to compare against.
 */
function deltaOver(avg, days) {
  if (avg.length < 2) return null;
  const end = avg[avg.length - 1];
  const target = addDays(end.date, -days);

  let start = null;
  for (const point of avg) {
    if (point.date <= target) start = point;
    else break;
  }
  // Nothing that old — fall back to the oldest point, but only if the span is
  // at least half the window, otherwise the number is noise wearing a label.
  if (!start) {
    const oldest = avg[0];
    if (daysBetween(oldest.date, end.date) < days / 2) return null;
    start = oldest;
  }
  return end.avg - start.avg;
}

function statTile(label, delta) {
  const dir = delta === null ? 'flat'
    : delta > 0.05 ? 'up'
    : delta < -0.05 ? 'down'
    : 'flat';

  return el('div', { class: 'stat' },
    el('div', { class: 'stat__label', text: label }),
    el('div', {
      class: `stat__value stat__value--${dir}`,
      text: delta === null ? '—' : `${fmtDelta(delta)} kg`,
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
      el('div', { class: 'range', role: 'group', 'aria-label': 'Chart range' },
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
  for (const btn of document.querySelectorAll('.range button')) {
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

  chartHost.replaceChildren(weightChart({ points, avg, width }));
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

function fab() {
  return el('button', {
    class: 'fab',
    type: 'button',
    onclick: () => openSheet(null),
  }, icon('plus'), 'Log weight');
}

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

  const kgInput = el('input', {
    type: 'number',
    id: 'w-kg',
    inputmode: 'decimal',
    step: '0.1',
    min: '20',
    max: '400',
    placeholder: '0.0',
    value: existing ? fmtKg(existing.kg) : '',
    required: true,
  });

  const error = el('div', { class: 'field__error', role: 'alert' });

  // novalidate: the browser's own validation bubble is a transient tooltip that
  // is easy to miss on a phone. We validate below and write the reason into a
  // line of text that stays put.
  const form = el('form', { class: 'sheet__inner', novalidate: true },
    el('div', { class: 'sheet__head' },
      el('h2', { class: 'sheet__title', text: isEdit ? 'Edit weigh-in' : 'Log weight' }),
      el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'Close',
        onclick: () => dismiss(),
      }, icon('close')),
    ),
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
    const kg = Number(kgInput.value);

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
