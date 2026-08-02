/* Export and import of the entire database as one JSON file.
 *
 * This carries more weight than a normal feature: iOS can evict a web app's
 * storage after a stretch of disuse, and there is no server copy to fall back
 * on. The export IS the backup. So the button is on the tab bar, not buried in
 * settings, and a reminder appears if it's been a while.
 *
 * Import is the other half — an export you can't restore is a placebo. Restore
 * replaces everything, after an explicit confirm, and reassigns ids on the way
 * in so a file exported from one install drops cleanly into another without
 * colliding with whatever ids already exist.
 */

import * as db from './db.js';

const FORMAT = 'fitness-tracker-backup';
const FORMAT_VERSION = 1;

/** Build the full backup object. */
export async function buildBackup() {
  const data = {};
  for (const store of db.STORES) {
    data[store] = await db.all(store);
  }
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    appDbVersion: 3,
    exportedAt: new Date().toISOString(),
    counts: Object.fromEntries(db.STORES.map((s) => [s, (data[s] ?? []).length])),
    data,
  };
}

/** Trigger a download of the backup. Returns the filename used. */
export async function downloadBackup() {
  const backup = await buildBackup();
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `training-backup-${stamp}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  await db.setMeta('lastExport', new Date().toISOString());
  return filename;
}

/** Total rows across all stores, for a human-readable confirm. */
export function totalRows(backup) {
  return Object.values(backup.counts ?? {}).reduce((a, b) => a + b, 0);
}

/**
 * Validate a parsed backup. Returns { ok, error?, backup? }.
 * Deliberately strict about the envelope so a wrong file can't half-import.
 */
export function validateBackup(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: "That doesn't look like a backup file." };
  }
  if (parsed.format !== FORMAT) {
    return { ok: false, error: 'Not a Training backup file — the format tag is missing.' };
  }
  if (!parsed.data || typeof parsed.data !== 'object') {
    return { ok: false, error: 'The file has no data in it.' };
  }
  if ((parsed.formatVersion ?? 1) > FORMAT_VERSION) {
    return {
      ok: false,
      error: 'This backup came from a newer version of the app than the one installed.',
    };
  }
  for (const store of db.STORES) {
    if (parsed.data[store] !== undefined && !Array.isArray(parsed.data[store])) {
      return { ok: false, error: `The "${store}" section is corrupt.` };
    }
  }
  return { ok: true, backup: parsed };
}

/**
 * Replace all data with the contents of a validated backup.
 *
 * Ids are remapped rather than trusted: cross-references (a workoutSet's
 * exerciseId, a plannedSession's planId, and so on) are rewritten to the new
 * ids as each store is rebuilt. `weights` and `meta` keep their natural keys
 * (date / key) and aren't remapped.
 */
export async function restoreBackup(backup) {
  const src = backup.data;

  // Wipe first, in child-before-parent order isn't required since we clear all.
  for (const store of db.STORES) await db.clear(store);

  // date-keyed and key-keyed stores: straight copy.
  if (src.weights?.length) await db.bulkPut('weights', src.weights);
  if (src.meta?.length) await db.bulkPut('meta', src.meta);

  // For each auto-increment store, insert without the old id and remember the
  // old->new mapping so children can be rewired.
  const remap = {};

  async function reinsert(store, records, rewrite) {
    remap[store] = new Map();
    for (const record of records ?? []) {
      const { id: oldId, ...rest } = record;
      const patched = rewrite ? rewrite(rest) : rest;
      const newId = await db.add(store, patched);
      if (oldId !== undefined) remap[store].set(oldId, newId);
    }
  }

  await reinsert('exercises', src.exercises);
  await reinsert('measurementFields', src.measurementFields);
  await reinsert('foods', src.foods);
  await reinsert('plans', src.plans);

  await reinsert('workoutSets', src.workoutSets, (r) => ({
    ...r, exerciseId: remap.exercises.get(r.exerciseId) ?? r.exerciseId,
  }));
  await reinsert('foodEntries', src.foodEntries, (r) => ({
    ...r, foodId: remap.foods.get(r.foodId) ?? r.foodId,
  }));
  await reinsert('measurements', src.measurements, (r) => ({
    ...r, fieldId: remap.measurementFields.get(r.fieldId) ?? r.fieldId,
  }));
  await reinsert('plannedSessions', src.plannedSessions, (r) => ({
    ...r, planId: remap.plans.get(r.planId) ?? r.planId,
  }));
  await reinsert('completedSessions', src.completedSessions, (r) => ({
    ...r,
    plannedSessionId: r.plannedSessionId == null
      ? null
      : remap.plannedSessions.get(r.plannedSessionId) ?? null,
  }));

  return backup.counts ?? {};
}

/** Days since the last export, or null if never exported. */
export async function daysSinceExport() {
  const last = await db.getMeta('lastExport', null);
  if (!last) return null;
  const ms = Date.now() - new Date(last).getTime();
  return Math.floor(ms / 86400000);
}

export async function hasAnyData() {
  for (const store of db.STORES) {
    if (store === 'measurementFields' || store === 'meta') continue;
    const rows = await db.all(store);
    if (rows && rows.length) return true;
  }
  return false;
}
