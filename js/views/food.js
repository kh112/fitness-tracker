/* Calorie intake.
 *
 * Same speed argument as the exercise log: you log this several times a day,
 * often one-handed, so the second helping of something you've eaten before must
 * be near-instant. Foods remember the calories you last gave them, and tapping
 * a suggestion fills that number in — one tap to pick, one to save.
 *
 * Deliberately not built: a food database, barcode scanning, or anything that
 * needs a network. Those need an API key and a backend, and this app has
 * neither by design. You type your own numbers, the same way you type your own
 * training plan.
 */

import * as db from '../db.js';
import { dailyBars } from '../chart.js';
import { toast, confirmDialog, sheet, sheetHead, navAction, icon } from '../ui.js';
import {
  el, mount, todayISO, addDays, fmtDate, fmtDateRelative, isValidISO,
} from '../util.js';

const HISTORY_DAYS = 14;

let entries = [];
let foods = [];
let foodById = new Map();
let target = null;
let viewDate = todayISO();

export async function render(view) {
  [entries, foods, target] = await Promise.all([
    db.listFoodEntries(),
    db.listFoods(),
    db.getMeta('calorieTarget', null),
  ]);
  foodById = new Map(foods.map((f) => [f.id, f]));

  const forDay = entries.filter((e) => e.date === viewDate);
  const total = forDay.reduce((sum, e) => sum + e.kcal, 0);

  mount(view,
    el('h1', { class: 'large-title', text: 'Nutrition' }),
    el('div', { class: 'stack' },
      heroSection(total, forDay),
      trendSection(),
      mealsSection(forDay),
    ),
  );

  navAction('Log food', () => openSheet(null));
}

/* ------------------------------------------------------------------- hero */

function heroSection(total, forDay) {
  const remaining = target === null ? null : target - total;
  const pct = target ? Math.min(100, (total / target) * 100) : 0;

  return el('section', { class: 'panel hero' },
    el('div', {},
      el('div', { class: 'row-between' },
        el('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Previous day',
          onclick: () => shiftDay(-1),
        }, icon('chevronLeft')),
        el('div', { class: 'hero__meta', style: 'font-weight:600',
          text: fmtDateRelative(viewDate) }),
        el('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Next day',
          disabled: viewDate >= todayISO(),
          onclick: () => shiftDay(1),
        }, icon('chevronRight')),
      ),
      el('div', { class: 'hero__reading', style: 'margin-top:6px' },
        el('span', { class: 'hero__value', text: total.toLocaleString() }),
        el('span', { class: 'hero__unit', text: 'kcal' }),
      ),
      el('div', { class: 'hero__meta', style: 'margin-top:8px',
        text: forDay.length
          ? `${forDay.length} item${forDay.length === 1 ? '' : 's'} logged`
          : 'Nothing logged for this day' }),
    ),

    target
      ? el('div', {},
          el('div', { class: 'progress' },
            el('i', { style: `width:${pct}%` + (total > target ? ';background:var(--t-tempo)' : '') })),
          el('div', { class: 'hero__meta', style: 'margin-top:8px',
            text: remaining >= 0
              ? `${remaining.toLocaleString()} kcal left of ${target.toLocaleString()}`
              : `${Math.abs(remaining).toLocaleString()} kcal over ${target.toLocaleString()}` }),
        )
      : null,

    el('div', { class: 'hero__stats' },
      el('div', { class: 'stat' },
        el('div', { class: 'stat__label', text: `${HISTORY_DAYS}-day average` }),
        el('div', { class: 'stat__value', text: `${averageIntake().toLocaleString()} kcal` }),
      ),
      el('button', {
        class: 'stat', type: 'button',
        style: 'text-align:left;cursor:pointer;font:inherit;color:inherit',
        onclick: () => openTargetSheet(),
      },
        el('div', { class: 'stat__label', text: 'Daily target' }),
        el('div', { class: 'stat__value',
          text: target ? target.toLocaleString() : 'Set one' }),
      ),
    ),
  );
}

function shiftDay(n) {
  const next = addDays(viewDate, n);
  if (next > todayISO()) return;
  viewDate = next;
  render(document.getElementById('view'));
}

/** Mean over days that actually have entries — an unlogged day isn't a zero. */
function averageIntake() {
  const totals = dailyTotals().filter((d) => d.value > 0);
  if (!totals.length) return 0;
  return Math.round(totals.reduce((s, d) => s + d.value, 0) / totals.length);
}

function dailyTotals() {
  const byDate = new Map();
  for (const entry of entries) {
    byDate.set(entry.date, (byDate.get(entry.date) ?? 0) + entry.kcal);
  }
  const out = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const date = addDays(todayISO(), -i);
    out.push({ date, value: byDate.get(date) ?? 0, isToday: i === 0 });
  }
  return out;
}

/* ------------------------------------------------------------------ trend */

function trendSection() {
  if (entries.length === 0) return null;
  const host = el('div', { class: 'chart__wrap' });

  // Drawn after mount so the container has a real width to measure.
  queueMicrotask(() => {
    mount(host, dailyBars({
      days: dailyTotals(),
      target,
      width: host.clientWidth || 342,
    }));
  });

  return el('section', { class: 'section' },
    el('div', { class: 'section__head' },
      el('h2', { class: 'section__title', text: `Last ${HISTORY_DAYS} days` }),
      foods.length
        ? el('button', {
          class: 'section__action', type: 'button', onclick: () => openFoodManager(),
          }, 'Foods')
        : null,
    ),
    el('div', { class: 'panel' }, host),
  );
}

/* ------------------------------------------------------------------ meals */

function mealsSection(forDay) {
  if (forDay.length === 0) {
    return el('section', { class: 'panel empty' },
      el('strong', {}, 'Nothing logged yet'),
      'Tap Log food. Anything you have eaten before autocompletes with the '
      + 'calories you gave it last time.',
    );
  }

  return el('section', { class: 'section' },
    db.MEALS.map((meal) => {
      const items = forDay.filter((e) => e.meal === meal.key);
      if (items.length === 0) return null;
      const mealTotal = items.reduce((s, e) => s + e.kcal, 0);

      return el('div', { class: 'panel', style: 'margin-bottom:10px' },
        el('div', { class: 'row-between', style: 'margin-bottom:2px' },
          el('div', { class: 'section__title', text: meal.label }),
          el('div', { class: 'entry__sub', text: `${mealTotal.toLocaleString()} kcal` }),
        ),
        items.map(entryRow),
      );
    }),
  );
}

function entryRow(entry) {
  const name = foodById.get(entry.foodId)?.name ?? 'Unknown food';
  return el('div', { class: 'entry' },
    el('button', {
      class: 'entry__main', type: 'button',
      onclick: () => openSheet(entry),
      'aria-label': `Edit ${name}, ${entry.kcal} calories`,
    },
      el('span', { class: 'entry__date', text: name }),
      el('span', { class: 'entry__kg', text: `${entry.kcal.toLocaleString()}` }),
    ),
    el('button', {
      class: 'icon-btn', type: 'button',
      'aria-label': `Delete ${name}`,
      onclick: () => removeEntry(entry, name),
    }, icon('trash')),
  );
}

async function removeEntry(entry, name) {
  await db.deleteFoodEntry(entry.id);
  await render(document.getElementById('view'));
  toast(`Removed ${name}`);
}

/* ------------------------------------------------------------------ sheet */

/** @param {object|null} existing an entry to edit, or null to add a new one */
function openSheet(existing) {
  const isEdit = Boolean(existing);
  let meal = existing?.meal ?? guessMeal();

  const nameInput = el('input', {
    type: 'text', id: 'f-name', placeholder: 'e.g. Porridge with banana',
    autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'false',
    value: existing ? (foodById.get(existing.foodId)?.name ?? '') : '',
  });

  const kcalInput = el('input', {
    type: 'number', id: 'f-kcal', inputmode: 'numeric', step: '1',
    min: '0', max: '10000', placeholder: '0',
    value: existing ? String(existing.kcal) : '',
  });

  const dateInput = el('input', {
    type: 'date', id: 'f-date', value: existing?.date ?? viewDate, max: todayISO(),
  });

  const suggestions = el('div', { class: 'chips' });
  const mealPicker = el('div', { class: 'picker' });
  const error = el('div', { class: 'field__error', role: 'alert' });

  function renderMeals() {
    mount(mealPicker,
      db.MEALS.map((m) =>
        el('button', {
          type: 'button',
          'aria-pressed': String(m.key === meal),
          onclick: () => { meal = m.key; renderMeals(); },
        }, m.label),
      ),
    );
  }

  function renderSuggestions() {
    const typed = nameInput.value.trim().toLowerCase();
    const matches = foods
      .filter((f) => !typed || f.name.toLowerCase().includes(typed))
      .slice(0, 8);

    mount(suggestions,
      matches.map((f) =>
        el('button', {
          class: 'chip', type: 'button',
          onclick: () => {
            nameInput.value = f.name;
            // The remembered figure is the whole point — fill it in, but leave
            // it editable, since portions vary.
            if (f.lastKcal !== null && f.lastKcal !== undefined) {
              kcalInput.value = String(f.lastKcal);
            }
            renderSuggestions();
            kcalInput.focus();
            kcalInput.select();
          },
        }, f.name,
          f.lastKcal != null
            ? el('span', { class: 'chip__kcal', text: String(f.lastKcal) })
            : null,
        ),
      ),
    );
    suggestions.hidden = matches.length === 0;
  }

  nameInput.addEventListener('input', renderSuggestions);

  const form = el('form', { class: 'sheet__inner', novalidate: true },
    sheetHead(isEdit ? 'Edit item' : 'Log food', () => dismiss()),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'f-name', text: 'Food' }), nameInput),
    suggestions,
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'f-kcal', text: 'Calories (kcal)' }),
      kcalInput),
    el('div', { class: 'field' },
      el('span', { class: 'field__label', text: 'Meal' }), mealPicker),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'f-date', text: 'Date' }), dateInput),
    error,
    el('div', { class: 'sheet__actions' },
      el('button', { class: 'btn btn--primary btn--block', type: 'submit' },
        isEdit ? 'Save changes' : 'Save'),
      isEdit
        ? el('button', {
            class: 'btn btn--block btn--danger', type: 'button',
            onclick: async () => {
              const name = foodById.get(existing.foodId)?.name ?? 'item';
              dismiss();
              await removeEntry(existing, name);
            },
          }, 'Delete item')
        : null,
    ),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';

    const name = nameInput.value.trim();
    const rawKcal = kcalInput.value.trim();
    const kcal = Number(rawKcal);
    const date = dateInput.value;

    if (!name) { error.textContent = 'Give the food a name.'; nameInput.focus(); return; }
    // Checked before the numeric test on purpose: Number('') is 0, so a blank
    // field would otherwise sail through as a valid zero-calorie item.
    if (rawKcal === '') {
      error.textContent = 'Enter the calories.';
      kcalInput.focus();
      return;
    }
    if (!Number.isFinite(kcal) || !Number.isInteger(kcal) || kcal < 0 || kcal > 10000) {
      error.textContent = 'Calories must be a whole number between 0 and 10,000.';
      kcalInput.focus();
      return;
    }
    if (!isValidISO(date) || date > todayISO()) {
      error.textContent = 'Pick a valid date, today or earlier.'; return;
    }

    const food = await db.ensureFood(name, kcal);
    await db.putFoodEntry({
      ...(existing ?? {}),
      date, foodId: food.id, kcal, meal,
    });

    viewDate = date;
    dismiss();
    await render(document.getElementById('view'));
    toast(isEdit ? 'Item updated' : `Logged ${name}, ${kcal} kcal`);
  });

  renderMeals();
  renderSuggestions();
  const { dismiss } = sheet(form);
  if (!isEdit) nameInput.focus();
}

/** Best guess at which meal you're logging, from the clock. */
function guessMeal() {
  const hour = new Date().getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

/* ----------------------------------------------------------------- target */

function openTargetSheet() {
  const input = el('input', {
    type: 'number', id: 't-kcal', inputmode: 'numeric', step: '10',
    min: '500', max: '10000', placeholder: 'e.g. 2400',
    value: target ? String(target) : '',
  });
  const error = el('div', { class: 'field__error', role: 'alert' });

  const form = el('form', { class: 'sheet__inner', novalidate: true },
    sheetHead('Daily target', () => dismiss()),
    el('div', { class: 'muted-note' },
      'A flat number for every day. Marathon blocks push energy needs up a lot on '
      + 'long-run days, so treat this as a rough reference rather than a rule — '
      + 'training hard on a target set for rest days is how people end up injured.'),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 't-kcal', text: 'Target (kcal)' }),
      input),
    error,
    el('div', { class: 'sheet__actions' },
      el('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Save'),
      target
        ? el('button', {
            class: 'btn btn--block btn--ghost', type: 'button',
            onclick: async () => {
              dismiss();
              await db.setMeta('calorieTarget', null);
              await render(document.getElementById('view'));
              toast('Target removed');
            },
          }, 'Remove target')
        : null,
    ),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';

    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 500 || value > 10000) {
      error.textContent = 'Enter a target between 500 and 10,000 kcal.';
      return;
    }

    await db.setMeta('calorieTarget', Math.round(value));
    dismiss();
    await render(document.getElementById('view'));
    toast('Target saved');
  });

  const { dismiss } = sheet(form);
  input.focus();
}

/* Manage the remembered food list — rename is not offered, because a rename
   would silently rewrite the label on every past entry. Delete is explicit
   about taking its entries with it. */
function openFoodManager() {
  const list = el('div', {});

  function renderList() {
    mount(list,
      foods.length
        ? foods.map((food) => {
            const uses = entries.filter((e) => e.foodId === food.id).length;
            return el('div', { class: 'switch-row' },
              el('div', { class: 'switch-row__name' }, food.name,
                el('small', {}, `${food.lastKcal ?? '—'} kcal · used ${uses} time${uses === 1 ? '' : 's'}`)),
              el('button', {
                class: 'icon-btn', type: 'button',
                'aria-label': `Forget ${food.name}`,
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: `Forget ${food.name}?`,
                    body: `This also deletes ${uses} logged entr${uses === 1 ? 'y' : 'ies'} that used it.`,
                    confirmLabel: 'Forget it',
                    danger: true,
                  });
                  if (!ok) return;
                  await db.deleteFood(food.id);
                  foods = await db.listFoods();
                  entries = await db.listFoodEntries();
                  renderList();
                },
              }, icon('trash')),
            );
          })
        : el('div', { class: 'muted-note', style: 'padding:14px 0' },
            'No foods remembered yet.'),
    );
  }

  const inner = el('div', { class: 'sheet__inner' },
    sheetHead('Remembered foods', () => finish()),
    el('div', { class: 'panel', style: 'padding:0 14px' }, list),
    el('div', { class: 'sheet__actions' },
      el('button', {
        class: 'btn btn--primary btn--block', type: 'button', onclick: () => finish(),
      }, 'Done'),
    ),
  );

  async function finish() {
    dismiss();
    await render(document.getElementById('view'));
  }

  renderList();
  const { dismiss } = sheet(inner);
}
