/* Body measurements.
 *
 * Logged every week or two, so nothing here counts days since the last entry or
 * nags about a gap — the brief is explicit that infrequent is normal, not a
 * failure state. The screen leads with each measurement's direction of travel
 * rather than with how recent it is.
 *
 * The field list is data, not code: the five defaults are seeded rows and can be
 * hidden or added to. Hiding rather than deleting, so a field you stop tracking
 * doesn't take its history with it.
 */

import * as db from '../db.js';
import { sparkline } from '../chart.js';
import { toast, confirmDialog, sheet, sheetHead, icon } from '../ui.js';
import {
  el, mount, todayISO, fmtDate, fmtDateRelative, fmtDelta, isValidISO, round1,
} from '../util.js';

let fields = [];
let rows = [];

export async function render(view) {
  [fields, rows] = await Promise.all([
    db.listMeasurementFields(),
    db.listMeasurements(),
  ]);

  const active = fields.filter((f) => f.active);
  const byDate = groupByDate(rows);
  const dates = [...byDate.keys()].sort().reverse();

  mount(view,
    el('h1', { class: 'large-title', text: 'Body' }),
    el('div', { class: 'stack' },
      el('section', { class: 'section' },
        el('div', { class: 'section__head' },
          el('h2', { class: 'section__title', text: 'Trends' }),
          el('button', {
            class: 'section__action', type: 'button',
            onclick: () => openFieldEditor(),
            }, 'Edit fields'),
        ),
        active.length === 0
          ? el('div', { class: 'panel empty' },
              el('strong', {}, 'No measurements turned on'),
              'Use Edit fields to switch some back on or add your own.')
          : el('div', { class: 'panel' }, active.map(trendRow)),
      ),

      dates.length
        ? el('section', { class: 'section' },
            el('div', { class: 'section__head' },
              el('h2', { class: 'section__title', text: 'History' }),
              el('span', { class: 'entry__sub', text: `${dates.length} entries` }),
            ),
            el('ul', { class: 'panel entries' },
              dates.map((date) => historyRow(date, byDate.get(date))),
            ),
          )
        : el('section', { class: 'panel empty' },
            el('strong', {}, 'Nothing measured yet'),
            'Tape measure, same time of day, same spot each time. '
            + 'Every week or two is plenty.'),
    ),
    el('button', {
      class: 'fab', type: 'button', onclick: () => openSheet(null),
    }, icon('plus'), 'Log measurements'),
  );
}

/** Map<date, Map<fieldId, row>> */
function groupByDate(list) {
  const out = new Map();
  for (const row of list) {
    if (!out.has(row.date)) out.set(row.date, new Map());
    out.get(row.date).set(row.fieldId, row);
  }
  return out;
}

function historyFor(fieldId) {
  return rows.filter((r) => r.fieldId === fieldId);   // already date-sorted
}

/* ------------------------------------------------------------- trends */

function trendRow(field) {
  const history = historyFor(field.id);

  if (history.length === 0) {
    return el('div', { class: 'trend-row' },
      el('div', { class: 'trend-row__name' }, field.name,
        el('div', { class: 'trend-row__sub', text: 'No readings yet' })),
      el('div', { class: 'trend-row__val', text: '—' }),
    );
  }

  const latest = history[history.length - 1];
  const first = history[0];
  const change = latest.cm - first.cm;
  const dir = change > 0.05 ? 'up' : change < -0.05 ? 'down' : 'flat';

  return el('div', { class: 'trend-row' },
    el('div', { class: 'trend-row__name' }, field.name,
      el('div', { class: 'trend-row__sub',
        text: history.length > 1
          ? `${history.length} readings · since ${fmtDate(first.date)}`
          : `First reading ${fmtDate(first.date)}` }),
    ),
    el('div', { class: 'trend-row__spark' },
      sparkline(history.map((r) => ({ date: r.date, value: r.cm })),
        { color: 'var(--accent)' })),
    el('div', { class: 'trend-row__val' },
      `${latest.cm.toFixed(1)}`,
      history.length > 1
        ? el('div', { class: `trend-row__delta stat__value--${dir}`,
            text: `${fmtDelta(change)} cm` })
        : el('div', { class: 'trend-row__delta entry__sub', text: 'cm' }),
    ),
  );
}

function historyRow(date, perField) {
  const named = [...perField.entries()]
    .map(([fieldId, row]) => {
      const field = fields.find((f) => f.id === fieldId);
      return field ? `${field.name} ${row.cm.toFixed(1)}` : null;
    })
    .filter(Boolean);

  return el('li', { class: 'entry' },
    el('button', {
      class: 'entry__main', type: 'button',
      onclick: () => openSheet(date),
      'aria-label': `Edit measurements for ${fmtDate(date)}`,
    },
      el('span', {},
        el('div', { class: 'entry__date', text: fmtDateRelative(date) }),
        el('div', { class: 'entry__sub', text: named.join(' · ') || 'No values' }),
      ),
    ),
    el('button', {
      class: 'icon-btn', type: 'button',
      'aria-label': `Delete measurements for ${fmtDate(date)}`,
      onclick: () => removeDate(date),
    }, icon('trash')),
  );
}

async function removeDate(date) {
  const ok = await confirmDialog({
    title: `Delete ${fmtDate(date)}?`,
    body: "Every measurement recorded on that date. This can't be undone.",
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await db.deleteMeasurementsOnDate(date);
  await render(document.getElementById('view'));
  toast('Measurements deleted');
}

/* -------------------------------------------------------------- sheet */

/** @param {string|null} date an existing date to edit, or null for a new entry */
function openSheet(date) {
  const isEdit = Boolean(date);
  const active = fields.filter((f) => f.active);
  const existing = isEdit
    ? new Map(rows.filter((r) => r.date === date).map((r) => [r.fieldId, r]))
    : new Map();

  const dateInput = el('input', {
    type: 'date', id: 'm-date', value: date ?? todayISO(), max: todayISO(),
  });
  const error = el('div', { class: 'field__error', role: 'alert' });
  const inputs = new Map();

  const fieldRows = active.map((field) => {
    const history = historyFor(field.id).filter((r) => r.date !== date);
    const last = history[history.length - 1];

    const input = el('input', {
      type: 'number', inputmode: 'decimal', step: '0.1', min: '1', max: '300',
      id: `m-${field.id}`,
      // Last reading as placeholder rather than as a value: prefilling would
      // silently record a measurement you never actually took.
      placeholder: last ? `last ${last.cm.toFixed(1)}` : '—',
      value: existing.has(field.id) ? existing.get(field.id).cm.toFixed(1) : '',
    });
    inputs.set(field.id, input);

    return el('div', { class: 'field' },
      el('label', { class: 'field__label', for: `m-${field.id}`,
        text: `${field.name} (cm)` }),
      input,
    );
  });

  const form = el('form', { class: 'sheet__inner', novalidate: true },
    sheetHead(isEdit ? `Edit ${fmtDate(date)}` : 'Log measurements', () => dismiss()),
    el('div', { class: 'muted-note' }, 'Leave anything you did not measure blank.'),
    fieldRows,
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'm-date', text: 'Date' }), dateInput),
    error,
    el('div', { class: 'sheet__actions' },
      el('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Save'),
    ),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';

    const newDate = dateInput.value;
    if (!isValidISO(newDate) || newDate > todayISO()) {
      error.textContent = 'Pick a valid date, today or earlier.'; return;
    }

    const values = {};
    let filled = 0;
    for (const [fieldId, input] of inputs) {
      const raw = input.value.trim();
      if (raw === '') { values[fieldId] = null; continue; }
      const cm = Number(raw);
      if (!Number.isFinite(cm) || cm < 1 || cm > 300) {
        error.textContent = 'Measurements must be between 1 and 300 cm.';
        input.focus();
        return;
      }
      values[fieldId] = round1(cm);
      filled++;
    }

    if (filled === 0 && !isEdit) {
      error.textContent = 'Fill in at least one measurement.'; return;
    }

    // Moving an entry to another date shouldn't leave a copy behind.
    if (isEdit && newDate !== date) await db.deleteMeasurementsOnDate(date);
    await db.saveMeasurements(newDate, values);

    dismiss();
    await render(document.getElementById('view'));
    toast(isEdit ? 'Measurements updated' : `Logged ${filled} measurements`);
  });

  const { dismiss } = sheet(form);
  if (!isEdit) inputs.values().next().value?.focus();
}

/* ------------------------------------------------------- field editor */

function openFieldEditor() {
  const list = el('div', {});
  const newName = el('input', {
    type: 'text', id: 'f-new', placeholder: 'e.g. Calf', autocomplete: 'off',
  });
  const error = el('div', { class: 'field__error', role: 'alert' });

  function renderList() {
    mount(list, 
      fields.map((field) => {
        const count = historyFor(field.id).length;
        return el('div', { class: 'switch-row' },
          el('div', { class: 'switch-row__name' }, field.name,
            el('small', {}, count
              ? `${count} reading${count === 1 ? '' : 's'}`
              : 'No readings yet')),
          el('button', {
            class: 'switch', type: 'button', role: 'switch',
            'aria-checked': String(Boolean(field.active)),
            'aria-label': `Track ${field.name}`,
            onclick: async (event) => {
              field.active = !field.active;
              event.currentTarget.setAttribute('aria-checked', String(field.active));
              await db.putMeasurementField(field);
            },
          }),
        );
      }),
    );
  }

  const form = el('form', { class: 'sheet__inner', novalidate: true },
    sheetHead('Measurements tracked', () => finish()),
    el('div', { class: 'muted-note' },
      'Switching one off hides it from logging and from the trends list. '
      + 'Its history is kept, so switching it back on brings everything with it.'),
    el('div', { class: 'panel', style: 'padding:0 14px' }, list),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'f-new', text: 'Add a measurement' }),
      newName),
    error,
    el('div', { class: 'sheet__actions' },
      el('button', { class: 'btn btn--block', type: 'submit' }, 'Add'),
      el('button', {
        class: 'btn btn--primary btn--block', type: 'button', onclick: () => finish(),
      }, 'Done'),
    ),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';

    const name = newName.value.trim();
    if (!name) { error.textContent = 'Give it a name first.'; newName.focus(); return; }
    if (fields.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      error.textContent = 'You already track that one.'; return;
    }

    const field = await db.addMeasurementField(name);
    fields.push(field);
    newName.value = '';
    renderList();
    toast(`Added ${field.name}`);
  });

  async function finish() {
    dismiss();
    await render(document.getElementById('view'));
  }

  renderList();
  const { dismiss } = sheet(form);
}
