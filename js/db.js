/* IndexedDB wrapper.
 *
 * Schema note (a deliberate change from the brief's sketch): the `weights`
 * store is keyed on `date`, not a synthetic `id`. The rule "one entry per day"
 * is then enforced by the database itself rather than by whichever bit of UI
 * code remembers to check. `put` on an existing date replaces it, which is
 * exactly the overwrite behaviour we want — the confirm prompt lives in the UI.
 *
 * Every other store uses an auto-incrementing `id`, because those genuinely can
 * have many rows per day.
 *
 * Migrations are guarded by `oldVersion` so upgrading from any earlier version
 * works. Never renumber or reuse a version.
 */

const DB_NAME = 'fitness-tracker';
const DB_VERSION = 3;

/** Every store, in the order export/import walks them. Parents before children:
 *  restoring exercises before workoutSets keeps foreign keys meaningful. */
export const STORES = [
  'weights',
  'measurementFields',
  'measurements',
  'exercises',
  'workoutSets',
  'foods',
  'foodEntries',
  'plans',
  'plannedSessions',
  'completedSessions',
  'meta',
];

export const DEFAULT_MEASUREMENT_FIELDS = ['Chest', 'Waist', 'Hips', 'Thigh', 'Upper arm'];

let dbPromise = null;

function migrate(db, oldVersion, tx) {
  if (oldVersion < 1) {
    db.createObjectStore('weights', { keyPath: 'date' });
    db.createObjectStore('meta', { keyPath: 'key' });
  }

  if (oldVersion < 2) {
    const auto = { keyPath: 'id', autoIncrement: true };

    // Exercise names are matched case-insensitively, so the unique index is on
    // a normalised key rather than on `name` — otherwise "Squat" and "squat"
    // become two exercises and the history for each is half the story.
    const exercises = db.createObjectStore('exercises', auto);
    exercises.createIndex('key', 'key', { unique: true });

    const sets = db.createObjectStore('workoutSets', auto);
    sets.createIndex('date', 'date');
    sets.createIndex('exerciseId', 'exerciseId');
    sets.createIndex('exercise_date', ['exerciseId', 'date']);

    const fields = db.createObjectStore('measurementFields', auto);
    fields.createIndex('order', 'order');

    const measurements = db.createObjectStore('measurements', auto);
    measurements.createIndex('date', 'date');
    measurements.createIndex('fieldId', 'fieldId');
    measurements.createIndex('field_date', ['fieldId', 'date']);

    db.createObjectStore('plans', auto);

    const planned = db.createObjectStore('plannedSessions', auto);
    planned.createIndex('planId', 'planId');
    planned.createIndex('plan_week', ['planId', 'weekIndex']);

    const completed = db.createObjectStore('completedSessions', auto);
    completed.createIndex('date', 'date');
    completed.createIndex('plannedSessionId', 'plannedSessionId');

    // Seed the default measurement fields. They are ordinary rows, so they can
    // be hidden or renamed like any other.
    const fieldStore = tx.objectStore('measurementFields');
    DEFAULT_MEASUREMENT_FIELDS.forEach((name, i) => {
      fieldStore.add({ name, active: true, order: i });
    });
  }

  if (oldVersion < 3) {
    const auto = { keyPath: 'id', autoIncrement: true };

    // Same normalised-key trick as exercises: "Porridge" and "porridge" are one
    // food with one remembered calorie count, not two.
    const foods = db.createObjectStore('foods', auto);
    foods.createIndex('key', 'key', { unique: true });

    const entries = db.createObjectStore('foodEntries', auto);
    entries.createIndex('date', 'date');
    entries.createIndex('foodId', 'foodId');
  }
}

export function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }

    req.onupgradeneeded = (event) => migrate(req.result, event.oldVersion, req.transaction);
    req.onsuccess = () => {
      const db = req.result;
      // If another tab opens a newer version, step aside so it isn't blocked.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error('Database upgrade blocked — close other tabs of this app.'));
  });

  // Don't cache a rejected promise; a retry should get a fresh attempt.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

/* ------------------------------------------------------------- primitives */

/** Run `fn(store)` in a transaction and resolve with fn's request result. */
async function run(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;

    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export const all = (store) => run(store, 'readonly', (s) => s.getAll());
export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const put = (store, record) => run(store, 'readwrite', (s) => s.put(record));
export const remove = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const clear = (store) => run(store, 'readwrite', (s) => s.clear());

/** Insert and resolve with the new auto-generated id. */
export const add = (store, record) => run(store, 'readwrite', (s) => s.add(record));

export const byIndex = (store, index, query) =>
  run(store, 'readonly', (s) => s.index(index).getAll(query));

/** Write many records in ONE transaction — all of them land, or none do. */
export async function bulkPut(store, records) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const record of records) os.put(record);
    tx.oncomplete = () => resolve(records.length);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

/** Delete every row whose `index` equals `value`. */
export async function removeByIndex(store, index, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const cursorReq = tx.objectStore(store).index(index).openCursor(IDBKeyRange.only(value));
    let n = 0;
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      cursor.delete();
      n++;
      cursor.continue();
    };
    tx.oncomplete = () => resolve(n);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/* ------------------------------------------------------------------ weights */

export function listWeights() {
  return all('weights').then((rows) => (rows || []).sort(byDate));
}

export const getWeight = (date) => get('weights', date);

export function putWeight(entry) {
  const record = { date: entry.date, kg: Number(entry.kg) };
  return put('weights', record).then(() => record);
}

export const deleteWeight = (date) => remove('weights', date);

/* ---------------------------------------------------------------- exercises */

const exerciseKey = (name) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export function listExercises() {
  return all('exercises').then((rows) =>
    (rows || []).sort((a, b) => a.name.localeCompare(b.name)));
}

/** Find an existing exercise by name, or create it. Case-insensitive. */
export async function ensureExercise(name) {
  const clean = name.trim().replace(/\s+/g, ' ');
  const key = exerciseKey(clean);
  const existing = (await byIndex('exercises', 'key', key))[0];
  if (existing) return existing;

  const id = await add('exercises', { name: clean, key });
  return { id, name: clean, key };
}

export const listSetsForExercise = (exerciseId) =>
  byIndex('workoutSets', 'exerciseId', exerciseId).then((rows) => rows.sort(byDate));

export const listSetsOnDate = (date) =>
  byIndex('workoutSets', 'date', date)
    .then((rows) => rows.sort((a, b) => a.setIndex - b.setIndex));

export const listAllSets = () => all('workoutSets').then((rows) => rows.sort(byDate));

/** Replace every set logged for one exercise on one date. */
export async function replaceSets(date, exerciseId, sets) {
  const existing = await byIndex('workoutSets', 'exercise_date', [exerciseId, date]);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workoutSets', 'readwrite');
    const store = tx.objectStore('workoutSets');
    for (const row of existing) store.delete(row.id);
    sets.forEach((set, i) => {
      const record = { date, exerciseId, setIndex: i, reps: set.reps };
      if (set.kg !== null && set.kg !== undefined && set.kg !== '') record.kg = Number(set.kg);
      store.add(record);
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export async function deleteSets(date, exerciseId) {
  const existing = await byIndex('workoutSets', 'exercise_date', [exerciseId, date]);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workoutSets', 'readwrite');
    const store = tx.objectStore('workoutSets');
    for (const row of existing) store.delete(row.id);
    tx.oncomplete = () => resolve(existing.length);
    tx.onerror = () => reject(tx.error);
  });
}

/* --------------------------------------------------------------- calories */

export const MEALS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch',     label: 'Lunch' },
  { key: 'dinner',    label: 'Dinner' },
  { key: 'snack',     label: 'Snacks' },
];

const foodKey = (name) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export function listFoods() {
  return all('foods').then((rows) =>
    (rows || []).sort((a, b) => a.name.localeCompare(b.name)));
}

/**
 * Find or create a food, remembering the calories last used for it.
 * The remembered figure is what makes the second helping two taps.
 */
export async function ensureFood(name, kcal) {
  const clean = name.trim().replace(/\s+/g, ' ');
  const key = foodKey(clean);
  const existing = (await byIndex('foods', 'key', key))[0];

  if (existing) {
    if (kcal !== undefined && kcal !== null && existing.lastKcal !== kcal) {
      await put('foods', { ...existing, lastKcal: kcal });
    }
    return { ...existing, lastKcal: kcal ?? existing.lastKcal };
  }

  const record = { name: clean, key, lastKcal: kcal ?? null };
  const id = await add('foods', record);
  return { ...record, id };
}

export const listFoodEntries = () =>
  all('foodEntries').then((rows) => rows.sort(byDate));

export const listFoodEntriesOnDate = (date) =>
  byIndex('foodEntries', 'date', date);

export async function putFoodEntry(entry) {
  if (entry.id) {
    await put('foodEntries', entry);
    return entry;
  }
  const id = await add('foodEntries', entry);
  return { ...entry, id };
}

export const deleteFoodEntry = (id) => remove('foodEntries', id);

/** Delete a food and every entry that used it. */
export async function deleteFood(foodId) {
  await removeByIndex('foodEntries', 'foodId', foodId);
  await remove('foods', foodId);
}

/* ------------------------------------------------------------- measurements */

export function listMeasurementFields() {
  return all('measurementFields').then((rows) =>
    (rows || []).sort((a, b) => a.order - b.order));
}

export async function addMeasurementField(name) {
  const fields = await listMeasurementFields();
  const order = fields.length ? Math.max(...fields.map((f) => f.order)) + 1 : 0;
  const id = await add('measurementFields', { name: name.trim(), active: true, order });
  return { id, name: name.trim(), active: true, order };
}

export const putMeasurementField = (field) => put('measurementFields', field);

export const listMeasurements = () => all('measurements').then((rows) => rows.sort(byDate));

export const listMeasurementsForField = (fieldId) =>
  byIndex('measurements', 'fieldId', fieldId).then((rows) => rows.sort(byDate));

/** Write one date's readings; a blank value deletes that field's entry. */
export async function saveMeasurements(date, values) {
  const existing = await byIndex('measurements', 'date', date);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('measurements', 'readwrite');
    const store = tx.objectStore('measurements');

    for (const [fieldId, cm] of Object.entries(values)) {
      const id = Number(fieldId);
      const prev = existing.find((row) => row.fieldId === id);
      if (cm === null || cm === '' || cm === undefined) {
        if (prev) store.delete(prev.id);
      } else if (prev) {
        store.put({ ...prev, cm: Number(cm) });
      } else {
        store.add({ date, fieldId: id, cm: Number(cm) });
      }
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export const deleteMeasurementsOnDate = (date) => removeByIndex('measurements', 'date', date);

/* --------------------------------------------------------------------- plan */

/** There is only ever one plan; the store keeps a row so it can be replaced. */
export async function getPlan() {
  const rows = await all('plans');
  return rows[0] ?? null;
}

export async function savePlan(plan) {
  if (plan.id) {
    await put('plans', plan);
    return plan;
  }
  const id = await add('plans', plan);
  return { ...plan, id };
}

export async function deletePlan(planId) {
  const sessions = await byIndex('plannedSessions', 'planId', planId);
  const completed = await all('completedSessions');
  const plannedIds = new Set(sessions.map((s) => s.id));

  for (const c of completed) {
    // Keep unplanned runs and detach the rest — a deleted plan shouldn't erase
    // the record of runs you actually did.
    if (c.plannedSessionId && plannedIds.has(c.plannedSessionId)) {
      await put('completedSessions', { ...c, plannedSessionId: null });
    }
  }
  for (const s of sessions) await remove('plannedSessions', s.id);
  await remove('plans', planId);
}

export const listPlannedSessions = (planId) =>
  byIndex('plannedSessions', 'planId', planId);

export async function putPlannedSession(session) {
  if (session.id) {
    await put('plannedSessions', session);
    return session;
  }
  const id = await add('plannedSessions', session);
  return { ...session, id };
}

export const deletePlannedSession = (id) => remove('plannedSessions', id);

export const listCompletedSessions = () =>
  all('completedSessions').then((rows) => rows.sort(byDate));

export async function putCompletedSession(session) {
  if (session.id) {
    await put('completedSessions', session);
    return session;
  }
  const id = await add('completedSessions', session);
  return { ...session, id };
}

export const deleteCompletedSession = (id) => remove('completedSessions', id);

/* ---------------------------------------------------------------- meta */

export function getMeta(key, fallback = null) {
  return get('meta', key).then((row) => (row === undefined ? fallback : row.value));
}

export const setMeta = (key, value) => put('meta', { key, value });
