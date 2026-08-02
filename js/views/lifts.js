/* Exercise log.
 *
 * The whole design target is one sentence from the brief: repeat entry must be
 * fast, because you're standing in a gym between sets. So:
 *
 *   - Tapping a known exercise prefills the sets from last time. Most sessions
 *     repeat the previous one, or add a rep or 2.5kg to it. Starting from a
 *     blank grid and retyping five identical rows is the thing to avoid.
 *   - Last time's numbers stay on screen while you edit, so you never navigate
 *     away to check what you lifted.
 *   - Adding a set copies the row above it.
 */

import * as db from '../db.js';
import { toast, confirmDialog, sheet, sheetHead, navAction, icon } from '../ui.js';
import {
  el, mount, todayISO, fmtDate, fmtDateRelative, fmtKg, isValidISO, round1,
  parseDecimal,
} from '../util.js';

let sets = [];            // every workoutSet row
let exercises = [];       // every exercise
let byId = new Map();     // exerciseId -> exercise

export async function render(view) {
  [sets, exercises] = await Promise.all([db.listAllSets(), db.listExercises()]);
  byId = new Map(exercises.map((e) => [e.id, e]));

  const days = groupByDate(sets);
  const today = todayISO();
  const todayGroups = days.get(today) ?? [];
  const past = [...days.entries()].filter(([date]) => date !== today).reverse();

  mount(view,
    el('h1', { class: 'large-title', text: 'Lifts' }),
    el('div', { class: 'stack' },
      todaySection(todayGroups, today),
      past.length
        ? el('section', { class: 'section' },
            el('div', { class: 'section__head' },
              el('h2', { class: 'section__title', text: 'Earlier' }),
              el('span', { class: 'entry__sub', text: `${past.length} sessions` }),
            ),
            past.map(([date, groups]) => sessionCard(date, groups)),
          )
        : null,
      sets.length === 0
        ? el('section', { class: 'panel empty' },
            el('strong', {}, 'No lifts logged yet'),
            'Tap Log exercise. Names you use are remembered, so the second time is fast.',
          )
        : null,
    ),
  );

  navAction('Log exercise', () => openSheet(null));
}

/** Map<date, [{exercise, sets}]> in date order. */
function groupByDate(rows) {
  const days = new Map();
  for (const row of rows) {
    if (!days.has(row.date)) days.set(row.date, new Map());
    const perExercise = days.get(row.date);
    if (!perExercise.has(row.exerciseId)) perExercise.set(row.exerciseId, []);
    perExercise.get(row.exerciseId).push(row);
  }

  const out = new Map();
  for (const [date, perExercise] of [...days.entries()].sort()) {
    out.set(date, [...perExercise.entries()].map(([exerciseId, list]) => ({
      exerciseId,
      exercise: byId.get(exerciseId),
      sets: list.sort((a, b) => a.setIndex - b.setIndex),
    })));
  }
  return out;
}

/** '5×60 · 5×60 · 4×62.5 kg', or '3×12 bodyweight'. */
function summarise(list) {
  const parts = list.map((s) => (s.kg === undefined
    ? `${s.reps}`
    : `${s.reps}×${fmtKg(s.kg)}`));
  return list.every((s) => s.kg === undefined)
    ? `${parts.join(' · ')} reps · bodyweight`
    : `${parts.join(' · ')} kg`;
}

function volume(list) {
  return list.reduce((sum, s) => sum + (s.kg ?? 0) * s.reps, 0);
}

function todaySection(groups, today) {
  return el('section', { class: 'section' },
    el('div', { class: 'section__head' },
      el('h2', { class: 'section__title', text: 'Today' }),
      groups.length
        ? el('span', { class: 'entry__sub',
            text: `${groups.reduce((n, g) => n + g.sets.length, 0)} sets · ${Math.round(groups.reduce((v, g) => v + volume(g.sets), 0))} kg volume` })
        : null,
    ),
    groups.length
      ? el('div', { class: 'panel' }, groups.map((g) => exerciseRow(today, g)))
      : el('div', { class: 'panel muted-note', style: 'text-align:center;padding:22px' },
          'Nothing logged today.'),
  );
}

function sessionCard(date, groups) {
  return el('div', { class: 'panel', style: 'margin-bottom:10px' },
    el('div', { class: 'row-between', style: 'margin-bottom:4px' },
      el('div', { class: 'entry__date', text: fmtDateRelative(date) }),
      el('div', { class: 'entry__sub',
        text: `${groups.reduce((n, g) => n + g.sets.length, 0)} sets` }),
    ),
    groups.map((g) => exerciseRow(date, g)),
  );
}

function exerciseRow(date, group) {
  const name = group.exercise?.name ?? 'Unknown exercise';
  return el('div', { class: 'entry' },
    el('button', {
      class: 'entry__main',
      type: 'button',
      onclick: () => openSheet({ date, exerciseId: group.exerciseId, sets: group.sets }),
      'aria-label': `Edit ${name} on ${fmtDate(date)}`,
    },
      el('span', {},
        el('div', { class: 'entry__date', text: name }),
        el('div', { class: 'entry__sub', text: summarise(group.sets) }),
      ),
    ),
    el('button', {
      class: 'icon-btn', type: 'button',
      'aria-label': `Delete ${name} on ${fmtDate(date)}`,
      onclick: () => removeGroup(date, group),
    }, icon('trash')),
  );
}

async function removeGroup(date, group) {
  const name = group.exercise?.name ?? 'this exercise';
  const ok = await confirmDialog({
    title: `Delete ${name}?`,
    body: `${group.sets.length} sets on ${fmtDate(date)}. This can't be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await db.deleteSets(date, group.exerciseId);
  await render(document.getElementById('view'));
  toast('Exercise deleted');
}

/* ------------------------------------------------------------------ sheet */

/**
 * @param {{date: string, exerciseId: number, sets: object[]}|null} existing
 */
function openSheet(existing) {
  const isEdit = Boolean(existing);
  let exerciseId = existing?.exerciseId ?? null;

  const nameInput = el('input', {
    type: 'text',
    id: 'ex-name',
    placeholder: 'e.g. Back squat',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    spellcheck: 'false',
    value: existing ? (byId.get(existing.exerciseId)?.name ?? '') : '',
  });

  const suggestions = el('div', { class: 'chips' });
  const recall = el('div', {});
  const setList = el('div', { class: 'sets' });
  const error = el('div', { class: 'field__error', role: 'alert' });

  const dateInput = el('input', {
    type: 'date', id: 'ex-date',
    value: existing?.date ?? todayISO(),
    max: todayISO(),
  });

  /* ---- set rows ---- */

  let rows = existing
    ? existing.sets.map((s) => ({ reps: String(s.reps), kg: s.kg === undefined ? '' : fmtKg(s.kg) }))
    : [{ reps: '', kg: '' }];

  function renderSets() {
    mount(setList, 
      el('div', { class: 'set-head' },
        el('span', {}, 'Set'), el('span', {}, 'Reps'), el('span', {}, 'kg'), el('span', {}),
      ),
      rows.map((row, i) =>
        el('div', { class: 'set-row' },
          el('span', { class: 'set-row__n', text: String(i + 1) }),
          el('input', {
            type: 'number', inputmode: 'numeric', step: '1', min: '1', max: '999',
            placeholder: 'reps', value: row.reps,
            'aria-label': `Set ${i + 1} reps`,
            oninput: (e) => { rows[i].reps = e.target.value; },
          }),
          el('input', {
            type: 'text', inputmode: 'decimal',
            placeholder: 'body', value: row.kg,
            'aria-label': `Set ${i + 1} weight in kilograms, leave blank for bodyweight`,
            oninput: (e) => { rows[i].kg = e.target.value; },
          }),
          rows.length > 1
            ? el('button', {
                class: 'icon-btn', type: 'button',
                'aria-label': `Remove set ${i + 1}`,
                onclick: () => { rows.splice(i, 1); renderSets(); },
              }, icon('close'))
            : el('span', {}),
        ),
      ),
      el('button', {
        class: 'btn btn--block', type: 'button',
        onclick: () => {
          // Copy the row above: the next set is usually the same or close.
          const last = rows[rows.length - 1] ?? { reps: '', kg: '' };
          rows.push({ reps: last.reps, kg: last.kg });
          renderSets();
          setList.querySelectorAll('.set-row input')[(rows.length - 1) * 2]?.focus();
        },
      }, '+ Add set'),
    );
  }

  /* ---- autocomplete + recall ---- */

  function renderSuggestions() {
    const typed = nameInput.value.trim().toLowerCase();
    const matches = exercises
      .filter((e) => !typed || e.name.toLowerCase().includes(typed))
      .slice(0, 8);

    mount(suggestions, 
      matches.map((e) =>
        el('button', {
          class: 'chip', type: 'button',
          'aria-pressed': String(e.id === exerciseId),
          onclick: () => pick(e, { prefill: !isEdit }),
        }, e.name),
      ),
    );
    suggestions.hidden = matches.length === 0;
  }

  async function pick(exercise, { prefill }) {
    nameInput.value = exercise.name;
    exerciseId = exercise.id;
    renderSuggestions();
    const history = await showRecall(exercise.id);

    // Starting a fresh entry for a known exercise: begin from last session
    // rather than an empty grid.
    if (prefill && history.length) {
      rows = history[0].sets.map((s) => ({
        reps: String(s.reps),
        kg: s.kg === undefined ? '' : fmtKg(s.kg),
      }));
      renderSets();
    }
  }

  /** Show the last two sessions for this exercise. Returns them, newest first. */
  async function showRecall(id) {
    const rowsForExercise = await db.listSetsForExercise(id);
    const perDate = new Map();
    for (const row of rowsForExercise) {
      if (!perDate.has(row.date)) perDate.set(row.date, []);
      perDate.get(row.date).push(row);
    }

    const sessions = [...perDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .filter(([date]) => !(isEdit && date === existing.date))
      .slice(0, 2)
      .map(([date, list]) => ({ date, sets: list.sort((a, b) => a.setIndex - b.setIndex) }));

    mount(recall, 
      sessions.length
        ? el('div', { class: 'recall' },
            el('div', { class: 'recall__label', text: 'Last time' }),
            sessions.map((s) =>
              el('div', {},
                el('span', { class: 'recall__sets', text: summarise(s.sets) }),
                el('span', { class: 'entry__sub', text: `  — ${fmtDateRelative(s.date)}` }),
              ),
            ),
          )
        : null,
    );
    return sessions;
  }

  nameInput.addEventListener('input', () => {
    const typed = nameInput.value.trim().toLowerCase();
    const exact = exercises.find((e) => e.name.toLowerCase() === typed);
    exerciseId = exact ? exact.id : null;
    renderSuggestions();
    if (exact) showRecall(exact.id); else mount(recall);
  });

  /* ---- assemble ---- */

  const form = el('form', { class: 'sheet__inner', novalidate: true },
    sheetHead(isEdit ? 'Edit exercise' : 'Log exercise', () => dismiss()),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'ex-name', text: 'Exercise' }),
      nameInput,
    ),
    suggestions,
    recall,
    setList,
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'ex-date', text: 'Date' }),
      dateInput,
    ),
    error,
    el('div', { class: 'sheet__actions' },
      el('button', { class: 'btn btn--primary btn--block', type: 'submit' },
        isEdit ? 'Save changes' : 'Save'),
    ),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';

    const name = nameInput.value.trim();
    const date = dateInput.value;

    if (!name) { error.textContent = 'Give the exercise a name.'; nameInput.focus(); return; }
    if (!isValidISO(date) || date > todayISO()) {
      error.textContent = 'Pick a valid date, today or earlier.';
      return;
    }

    const clean = [];
    for (const row of rows) {
      const reps = Number(row.reps);
      if (!row.reps.trim()) continue;                    // blank row: skip it
      if (!Number.isInteger(reps) || reps < 1 || reps > 999) {
        error.textContent = 'Reps must be a whole number between 1 and 999.';
        return;
      }
      let kg = null;
      if (String(row.kg).trim() !== '') {
        kg = parseDecimal(row.kg);
        if (!Number.isFinite(kg) || kg < 0 || kg > 999) {
          error.textContent = 'Weight must be between 0 and 999 kg, or blank for bodyweight.';
          return;
        }
        kg = round1(kg);
      }
      clean.push({ reps, kg });
    }

    if (clean.length === 0) {
      error.textContent = 'Add at least one set with a rep count.';
      return;
    }

    const exercise = await db.ensureExercise(name);

    // Editing and renaming to a different exercise: drop the old grouping so
    // the sets don't end up filed under both names.
    if (isEdit && existing.exerciseId !== exercise.id) {
      await db.deleteSets(existing.date, existing.exerciseId);
    }
    if (isEdit && existing.date !== date) {
      await db.deleteSets(existing.date, existing.exerciseId);
    }

    await db.replaceSets(date, exercise.id, clean);

    dismiss();
    await render(document.getElementById('view'));
    toast(isEdit ? 'Exercise updated' : `Logged ${clean.length} sets of ${exercise.name}`);
  });

  const { dismiss } = sheet(form);

  renderSets();
  renderSuggestions();
  if (isEdit) showRecall(existing.exerciseId);
  else nameInput.focus();
}
