/* IndexedDB wrapper.
 *
 * Schema note (a deliberate change from the brief's sketch): the `weights`
 * store is keyed on `date`, not a synthetic `id`. The rule "one entry per day"
 * is then enforced by the database itself rather than by whichever bit of UI
 * code remembers to check. `put` on an existing date replaces it, which is
 * exactly the overwrite behaviour we want — the confirm prompt lives in the UI.
 *
 * Stores get added in later versions as the features land. Each migration step
 * is guarded by `oldVersion` so upgrading from any earlier version works.
 */

const DB_NAME = 'fitness-tracker';
const DB_VERSION = 1;

const STORE_WEIGHTS = 'weights';
const STORE_META = 'meta';

let dbPromise = null;

function migrate(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore(STORE_WEIGHTS, { keyPath: 'date' });
    db.createObjectStore(STORE_META, { keyPath: 'key' });
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

    req.onupgradeneeded = (event) => migrate(req.result, event.oldVersion);
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

/* ------------------------------------------------------------- weights */

/** All weight entries, oldest first. */
export function listWeights() {
  return run(STORE_WEIGHTS, 'readonly', (s) => s.getAll()).then((rows) =>
    (rows || []).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  );
}

export function getWeight(date) {
  return run(STORE_WEIGHTS, 'readonly', (s) => s.get(date));
}

/** Insert or replace the entry for `date`. */
export function putWeight(entry) {
  const record = { date: entry.date, kg: Number(entry.kg) };
  return run(STORE_WEIGHTS, 'readwrite', (s) => s.put(record)).then(() => record);
}

export function deleteWeight(date) {
  return run(STORE_WEIGHTS, 'readwrite', (s) => s.delete(date));
}

/* ---------------------------------------------------------------- meta */

export function getMeta(key, fallback = null) {
  return run(STORE_META, 'readonly', (s) => s.get(key)).then((row) =>
    row === undefined ? fallback : row.value
  );
}

export function setMeta(key, value) {
  return run(STORE_META, 'readwrite', (s) => s.put({ key, value }));
}
