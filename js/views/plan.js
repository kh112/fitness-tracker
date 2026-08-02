/* Marathon training plan.
 *
 * You type your own plan — nothing here generates one. Weeks are derived from
 * the start date and the race date rather than being a fixed "16 week plan",
 * so a block of any length works.
 *
 * Planned and actual are stored separately and both survive: a planned session
 * is never overwritten by what you actually ran. A completed session can also
 * exist with no planned session behind it, because sometimes you just go for a
 * run that wasn't on the plan and that shouldn't be unrecordable.
 */

import * as db from '../db.js';
import { toast, confirmDialog, sheet, sheetHead, navAction, icon } from '../ui.js';
import {
  el, mount, todayISO, addDays, daysBetween, startOfWeek, fmtDate,
  fmtWeekSpan, fmtKm, isValidISO, round1, DAY_NAMES, parseDecimal,
} from '../util.js';

export const TYPES = [
  { key: 'easy',      label: 'Easy',       hasKm: true },
  { key: 'tempo',     label: 'Tempo',      hasKm: true },
  { key: 'intervals', label: 'Intervals',  hasKm: true },
  { key: 'long',      label: 'Long',       hasKm: true },
  { key: 'cross',     label: 'Cross-train', hasKm: false },
  { key: 'rest',      label: 'Rest',       hasKm: false },
];

const typeOf = (key) => TYPES.find((t) => t.key === key) ?? TYPES[0];

const DEFAULT_RACE_DATE = '2026-10-18';

let plan = null;
let planned = [];
let completed = [];
const expanded = new Set();     // week indexes the user has opened

export async function render(view) {
  plan = await db.getPlan();

  if (!plan) {
    mount(view,
      el('h1', { class: 'large-title', text: 'Training' }),
      setupScreen());
    return;
  }

  [planned, completed] = await Promise.all([
    db.listPlannedSessions(plan.id),
    db.listCompletedSessions(),
  ]);

  const weeks = buildWeeks();
  const current = weeks.find((w) => w.isCurrent);
  if (current && expanded.size === 0) expanded.add(current.index);

  mount(view,
    el('h1', { class: 'large-title', text: 'Training' }),
    el('div', { class: 'stack' },
      countdownPanel(weeks),
      el('section', { class: 'section' },
        el('div', { class: 'section__head' },
          el('h2', { class: 'section__title', text: 'Weeks' }),
          el('button', {
            class: 'section__action', type: 'button',
            onclick: () => openPlanSettings(),
            }, 'Plan settings'),
        ),
        el('div', {}, weeks.map(weekCard)),
      ),
    ),
  );

  navAction('Log a run', () => openCompletion(null, null));
}

/* ------------------------------------------------------------ structure */

/** Weeks from the plan's start Monday through the week containing race day. */
function buildWeeks() {
  const start = startOfWeek(plan.startDate);
  const raceMonday = startOfWeek(plan.raceDate);
  const count = Math.max(1, Math.round(daysBetween(start, raceMonday) / 7) + 1);
  const thisMonday = startOfWeek(todayISO());

  const plannedByKey = new Map();
  for (const session of planned) {
    plannedByKey.set(`${session.weekIndex}:${session.dayOfWeek}`, session);
  }
  const completedByDate = new Map();
  for (const done of completed) {
    if (!completedByDate.has(done.date)) completedByDate.set(done.date, []);
    completedByDate.get(done.date).push(done);
  }

  const weeks = [];
  for (let i = 0; i < count; i++) {
    const monday = addDays(start, i * 7);
    const days = DAY_NAMES.map((_, d) => {
      const date = addDays(monday, d);
      return {
        date,
        dayOfWeek: d,
        planned: plannedByKey.get(`${i}:${d}`) ?? null,
        completed: completedByDate.get(date) ?? [],
      };
    });

    weeks.push({
      index: i,
      monday,
      days,
      isCurrent: monday === thisMonday,
      isRaceWeek: monday === raceMonday,
      plannedKm: days.reduce((sum, day) => sum + (day.planned?.km ?? 0), 0),
      actualKm: days.reduce(
        (sum, day) => sum + day.completed.reduce((s, c) => s + (c.km ?? 0), 0), 0),
    });
  }
  return weeks;
}

/* ------------------------------------------------------------- setup */

function setupScreen() {
  const name = el('input', { type: 'text', id: 'p-name', value: 'Marathon block' });
  const race = el('input', { type: 'date', id: 'p-race', value: DEFAULT_RACE_DATE });
  const start = el('input', { type: 'date', id: 'p-start', value: startOfWeek(todayISO()) });
  const error = el('div', { class: 'field__error', role: 'alert' });
  const preview = el('div', { class: 'muted-note' });

  function updatePreview() {
    if (!isValidISO(race.value) || !isValidISO(start.value)) { preview.textContent = ''; return; }
    const weeks = Math.round(daysBetween(startOfWeek(start.value), startOfWeek(race.value)) / 7) + 1;
    const days = daysBetween(todayISO(), race.value);
    preview.textContent = weeks > 0
      ? `${weeks} weeks, ${days} days from today to race day.`
      : 'Race day is before the start date.';
  }
  race.addEventListener('input', updatePreview);
  start.addEventListener('input', updatePreview);

  const form = el('form', { class: 'panel stack', novalidate: true },
    el('div', {},
      el('h2', { style: 'font-size:20px;margin-bottom:6px' }, 'Set up your plan'),
      el('div', { class: 'muted-note' },
        'You fill in the sessions yourself, week by week. Weeks are worked out '
        + 'from these two dates, so a block of any length is fine.'),
    ),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'p-name', text: 'Name' }), name),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'p-race', text: 'Race day' }), race),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'p-start', text: 'Start of week 1' }), start),
    preview,
    error,
    el('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Create plan'),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';

    if (!isValidISO(race.value) || !isValidISO(start.value)) {
      error.textContent = 'Both dates are required.'; return;
    }
    if (daysBetween(start.value, race.value) < 0) {
      error.textContent = 'Race day has to come after the start.'; return;
    }

    await db.savePlan({
      name: name.value.trim() || 'Marathon block',
      raceDate: race.value,
      startDate: startOfWeek(start.value),   // always a Monday
    });
    await render(document.getElementById('view'));
    toast('Plan created');
  });

  updatePreview();
  return form;
}

/* ---------------------------------------------------------- countdown */

function countdownPanel(weeks) {
  const days = daysBetween(todayISO(), plan.raceDate);
  const totalPlanned = weeks.reduce((s, w) => s + w.plannedKm, 0);
  const totalActual = weeks.reduce((s, w) => s + w.actualKm, 0);

  const elapsed = daysBetween(plan.startDate, todayISO());
  const span = Math.max(1, daysBetween(plan.startDate, plan.raceDate));
  const pct = Math.max(0, Math.min(100, (elapsed / span) * 100));

  const currentWeek = weeks.find((w) => w.isCurrent);

  return el('section', { class: 'panel hero' },
    el('div', {},
      el('div', { class: 'countdown' },
        days > 0
          ? [el('span', { class: 'countdown__n', text: String(days) }),
             el('span', { class: 'countdown__unit', text: days === 1 ? 'day to go' : 'days to go' })]
          : days === 0
            ? [el('span', { class: 'countdown__n', text: 'Race' }),
               el('span', { class: 'countdown__unit', text: 'day. Good luck.' })]
            : [el('span', { class: 'countdown__n', text: String(-days) }),
               el('span', { class: 'countdown__unit', text: 'days since race day' })],
      ),
      el('div', { class: 'hero__meta', style: 'margin-top:10px' },
        `${plan.name} · ${fmtDate(plan.raceDate)}`
        + (currentWeek ? ` · week ${currentWeek.index + 1} of ${weeks.length}` : '')),
    ),
    days > 0 ? el('div', { class: 'progress' }, el('i', { style: `width:${pct}%` })) : null,
    el('div', { class: 'hero__stats' },
      el('div', { class: 'stat' },
        el('div', { class: 'stat__label', text: 'Planned total' }),
        el('div', { class: 'stat__value', text: `${fmtKm(totalPlanned)} km` }),
      ),
      el('div', { class: 'stat' },
        el('div', { class: 'stat__label', text: 'Actual so far' }),
        el('div', { class: 'stat__value', text: `${fmtKm(totalActual)} km` }),
      ),
    ),
  );
}

/* --------------------------------------------------------------- weeks */

function weekCard(week) {
  const isOpen = expanded.has(week.index);

  const head = el('button', {
    class: 'week__head', type: 'button',
    'aria-expanded': String(isOpen),
    onclick: () => {
      if (expanded.has(week.index)) expanded.delete(week.index);
      else expanded.add(week.index);
      render(document.getElementById('view'));
    },
  },
    el('span', {},
      el('div', { class: 'week__name' },
        `Week ${week.index + 1}`,
        week.isRaceWeek ? el('span', { class: 'week__tag', text: '  race week' }) : null,
        week.isCurrent && !week.isRaceWeek
          ? el('span', { class: 'week__tag', text: '  this week' }) : null,
      ),
      el('div', { class: 'week__dates', text: fmtWeekSpan(week.monday) }),
    ),
    el('span', { class: 'week__km' },
      `${fmtKm(week.actualKm)} / ${fmtKm(week.plannedKm)}`,
      el('small', {}, 'km actual / planned'),
    ),
  );

  return el('div', { class: `week ${week.isCurrent ? 'week--current' : ''}` },
    head,
    isOpen
      ? el('div', { class: 'days' },
          week.days.map((day) => dayRow(week, day)),
          week.plannedKm === 0 && week.index > 0
            ? el('div', { style: 'padding:10px 14px' },
                el('button', {
                  class: 'btn btn--block', type: 'button',
                  style: 'min-height:44px;font-size:14px',
                  onclick: () => copyWeek(week.index - 1, week.index),
                }, `Copy week ${week.index} into this week`))
            : null,
        )
      : null,
  );
}

function dayRow(week, day) {
  const isToday = day.date === todayISO();
  const type = day.planned ? typeOf(day.planned.type) : null;
  const linked = day.completed.find((c) => c.plannedSessionId === day.planned?.id);
  const extras = day.completed.filter((c) => c.plannedSessionId !== day.planned?.id);
  const actualKm = day.completed.reduce((s, c) => s + (c.km ?? 0), 0);

  return el('div', { class: `day ${isToday ? 'day--today' : ''}` },
    el('button', {
      class: 'day__main', type: 'button',
      onclick: () => openPlannedEditor(week, day),
      'aria-label': `${DAY_NAMES[day.dayOfWeek]} ${fmtDate(day.date)}, `
        + (day.planned ? `planned ${type.label}` : 'nothing planned'),
    },
      el('span', { class: 'day__dow', text: DAY_NAMES[day.dayOfWeek] }),
      el('span', { class: 'day__body' },
        day.planned
          ? el('span', { class: `badge badge--${day.planned.type}`, text: type.label })
          : el('span', { class: 'day__empty', text: 'Nothing planned' }),
        day.planned && type.hasKm
          ? el('div', { class: 'day__km', text: `${fmtKm(day.planned.km)} km planned` })
          : null,
        day.completed.length
          ? el('div', { class: 'day__actual' },
              `✓ ${fmtKm(actualKm)} km`
              + (extras.length && day.planned ? ' (incl. unplanned)' : '')
              + (linked?.notes ? ` — ${linked.notes}` : ''))
          : null,
      ),
    ),
    day.planned && type.hasKm
      ? el('button', {
          class: `tick ${linked ? 'tick--done' : ''}`, type: 'button',
          'aria-label': linked
            ? `Edit completed run on ${fmtDate(day.date)}`
            : `Mark ${fmtDate(day.date)} done`,
          onclick: () => openCompletion(day.planned, linked ?? null, day.date),
        }, icon('check'))
      : null,
  );
}

async function copyWeek(fromIndex, toIndex) {
  const source = planned.filter((s) => s.weekIndex === fromIndex);
  if (!source.length) { toast(`Week ${fromIndex + 1} is empty`); return; }

  for (const session of source) {
    await db.putPlannedSession({
      planId: plan.id,
      weekIndex: toIndex,
      dayOfWeek: session.dayOfWeek,
      type: session.type,
      km: session.km,
    });
  }
  await render(document.getElementById('view'));
  toast(`Copied ${source.length} sessions`);
}

/* ------------------------------------------------- planned session sheet */

function openPlannedEditor(week, day) {
  const existing = day.planned;
  let type = existing?.type ?? 'easy';

  const kmField = el('div', { class: 'field' });
  const kmInput = el('input', {
    type: 'text', inputmode: 'decimal',
    id: 'pl-km', placeholder: '0', value: existing?.km ? fmtKm(existing.km) : '',
  });
  const picker = el('div', { class: 'picker' });
  const error = el('div', { class: 'field__error', role: 'alert' });

  function renderPicker() {
    mount(picker, 
      TYPES.map((t) =>
        el('button', {
          class: `badge--${t.key}`, type: 'button',
          'aria-pressed': String(t.key === type),
          onclick: () => { type = t.key; renderPicker(); syncKm(); },
        }, el('span', { class: `badge badge--${t.key}`, text: t.label })),
      ),
    );
  }

  function syncKm() {
    kmField.hidden = !typeOf(type).hasKm;
  }

  kmField.append(
    el('label', { class: 'field__label', for: 'pl-km', text: 'Planned distance (km)' }),
    kmInput,
  );

  const form = el('form', { class: 'sheet__inner', novalidate: true },
    sheetHead(`${DAY_NAMES[day.dayOfWeek]} ${fmtDate(day.date)}`, () => dismiss()),
    el('div', { class: 'field' },
      el('span', { class: 'field__label', text: 'Session type' }), picker),
    kmField,
    error,
    el('div', { class: 'sheet__actions' },
      el('button', { class: 'btn btn--primary btn--block', type: 'submit' },
        existing ? 'Save' : 'Add to plan'),
      existing
        ? el('button', {
            class: 'btn btn--block btn--danger', type: 'button',
            onclick: async () => {
              dismiss();
              await db.deletePlannedSession(existing.id);
              await render(document.getElementById('view'));
              toast('Removed from plan');
            },
          }, 'Remove from plan')
        : null,
    ),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';

    let km = 0;
    if (typeOf(type).hasKm) {
      km = parseDecimal(kmInput.value);
      if (!Number.isFinite(km) || km <= 0 || km > 200) {
        error.textContent = 'Enter a distance between 0 and 200 km.';
        return;
      }
      km = round1(km);
    }

    await db.putPlannedSession({
      ...(existing ?? {}),
      planId: plan.id,
      weekIndex: week.index,
      dayOfWeek: day.dayOfWeek,
      type,
      km,
    });

    dismiss();
    await render(document.getElementById('view'));
    toast(existing ? 'Session updated' : 'Added to plan');
  });

  renderPicker();
  syncKm();
  const { dismiss } = sheet(form);
}

/* ------------------------------------------------------ completion sheet */

/**
 * @param {object|null} plannedSession the session being ticked off, if any
 * @param {object|null} existing       an already-recorded completion
 * @param {string} [date]              date when marking a planned session done
 */
function openCompletion(plannedSession, existing, date) {
  const kmInput = el('input', {
    type: 'text', inputmode: 'decimal',
    id: 'c-km', placeholder: '0',
    value: existing ? fmtKm(existing.km) : (plannedSession ? fmtKm(plannedSession.km) : ''),
  });
  const dateInput = el('input', {
    type: 'date', id: 'c-date',
    value: existing?.date ?? date ?? todayISO(),
  });
  const notes = el('textarea', {
    id: 'c-notes', rows: '2', placeholder: 'How did it feel? (optional)',
  });
  notes.value = existing?.notes ?? '';
  const error = el('div', { class: 'field__error', role: 'alert' });

  const title = existing ? 'Edit run'
    : plannedSession ? 'Mark done'
    : 'Log a run';

  const form = el('form', { class: 'sheet__inner', novalidate: true },
    sheetHead(title, () => dismiss()),
    plannedSession
      ? el('div', { class: 'recall' },
          el('div', { class: 'recall__label', text: 'Planned' }),
          el('span', { class: 'recall__sets',
            text: `${typeOf(plannedSession.type).label} · ${fmtKm(plannedSession.km)} km` }),
        )
      : null,
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'c-km', text: 'Actual distance (km)' }),
      kmInput),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'c-date', text: 'Date' }), dateInput),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'c-notes', text: 'Notes' }), notes),
    error,
    el('div', { class: 'sheet__actions' },
      el('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Save'),
      existing
        ? el('button', {
            class: 'btn btn--block btn--danger', type: 'button',
            onclick: async () => {
              dismiss();
              await db.deleteCompletedSession(existing.id);
              await render(document.getElementById('view'));
              toast('Run removed');
            },
          }, 'Delete this run')
        : null,
    ),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';

    const km = parseDecimal(kmInput.value);
    if (!Number.isFinite(km) || km <= 0 || km > 200) {
      error.textContent = 'Enter a distance between 0 and 200 km.'; return;
    }
    if (!isValidISO(dateInput.value)) {
      error.textContent = 'Pick a valid date.'; return;
    }

    await db.putCompletedSession({
      ...(existing ?? {}),
      plannedSessionId: existing?.plannedSessionId ?? plannedSession?.id ?? null,
      date: dateInput.value,
      km: round1(km),
      notes: notes.value.trim() || null,
    });

    dismiss();
    await render(document.getElementById('view'));
    toast(existing ? 'Run updated' : 'Run logged');
  });

  const { dismiss } = sheet(form);
  if (!existing) kmInput.focus();
}

/* -------------------------------------------------------- plan settings */

function openPlanSettings() {
  const name = el('input', { type: 'text', id: 's-name', value: plan.name });
  const race = el('input', { type: 'date', id: 's-race', value: plan.raceDate });
  const start = el('input', { type: 'date', id: 's-start', value: plan.startDate });
  const error = el('div', { class: 'field__error', role: 'alert' });

  const form = el('form', { class: 'sheet__inner', novalidate: true },
    sheetHead('Plan settings', () => dismiss()),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 's-name', text: 'Name' }), name),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 's-race', text: 'Race day' }), race),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 's-start', text: 'Start of week 1' }), start),
    el('div', { class: 'muted-note' },
      'Moving the start date shifts which calendar dates your weeks land on. '
      + 'The sessions themselves stay in the same week and weekday.'),
    error,
    el('div', { class: 'sheet__actions' },
      el('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Save'),
      el('button', {
        class: 'btn btn--block btn--danger', type: 'button',
        onclick: async () => {
          dismiss();
          const ok = await confirmDialog({
            title: 'Delete this plan?',
            body: 'Planned sessions go with it. Runs you actually completed are kept '
                + 'and become unplanned runs.',
            confirmLabel: 'Delete plan',
            danger: true,
          });
          if (!ok) return;
          await db.deletePlan(plan.id);
          expanded.clear();
          await render(document.getElementById('view'));
          toast('Plan deleted');
        },
      }, 'Delete plan'),
    ),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';

    if (!isValidISO(race.value) || !isValidISO(start.value)) {
      error.textContent = 'Both dates are required.'; return;
    }
    if (daysBetween(start.value, race.value) < 0) {
      error.textContent = 'Race day has to come after the start.'; return;
    }

    await db.savePlan({
      ...plan,
      name: name.value.trim() || plan.name,
      raceDate: race.value,
      startDate: startOfWeek(start.value),
    });

    dismiss();
    await render(document.getElementById('view'));
    toast('Plan updated');
  });

  const { dismiss } = sheet(form);
}
