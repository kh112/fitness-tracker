/* Data screen — export, import, and the storage-safety story.
 *
 * The export button is the whole reason this screen sits on the tab bar rather
 * than in a settings menu: it's the only backstop against iOS quietly evicting
 * the database, and a backup you have to go hunting for won't get made.
 */

import * as backup from '../backup.js';
import { toast, confirmDialog, sheet, icon } from '../ui.js';
import { el, mount, fmtDateRelative, todayISO } from '../util.js';

export async function render(view) {
  const [days, counts] = await Promise.all([
    backup.daysSinceExport(),
    countAll(),
  ]);

  mount(view, 
    el('div', { class: 'stack' },
      reminderBanner(days),

      el('section', { class: 'section' },
        el('h2', { class: 'section__title', text: 'Backup' }),
        el('div', { class: 'panel stack' },
          el('div', { class: 'muted-note' },
            'Everything lives on this device — there is no copy on a server. '
            + 'Downloading a backup now and then is the only way to be safe against '
            + 'a lost phone or the browser clearing its storage.'),
          el('button', {
            class: 'btn btn--primary btn--block', type: 'button',
            onclick: doExport,
          }, icon('data'), '  Download my data'),
          el('div', { class: 'muted-note',
            text: days === null
              ? 'You have never exported.'
              : days === 0 ? 'Last exported today.'
              : `Last exported ${days} day${days === 1 ? '' : 's'} ago.` }),
        ),
      ),

      el('section', { class: 'section' },
        el('h2', { class: 'section__title', text: 'Restore' }),
        el('div', { class: 'panel stack' },
          el('div', { class: 'muted-note' },
            'Import a backup file. This replaces everything currently in the app, '
            + 'so use it on a new phone or to undo a mistake — not to merge two sets '
            + 'of data.'),
          el('label', { class: 'btn btn--block filesel' },
            icon('upload'), '  Choose a backup file',
            el('input', {
              type: 'file', accept: 'application/json,.json',
              onchange: (e) => handleFile(e.target),
            }),
          ),
        ),
      ),

      el('section', { class: 'section' },
        el('h2', { class: 'section__title', text: "What's stored" }),
        el('div', { class: 'panel' }, summaryRows(counts)),
      ),
    ),
  );
}

function reminderBanner(days) {
  // The brief asks for a gentle nudge after about a month.
  if (days === null || days < 30) return null;
  return el('div', { class: 'banner' },
    el('div', { class: 'banner__body' },
      el('strong', {}, `It's been ${days} days since your last backup`),
      'A quick download keeps your training log safe if anything happens to this phone.',
    ),
  );
}

function summaryRows(counts) {
  const labels = {
    weights: 'Weigh-ins',
    measurements: 'Measurement readings',
    workoutSets: 'Exercise sets',
    foodEntries: 'Food entries',
    completedSessions: 'Runs completed',
    plannedSessions: 'Planned sessions',
  };
  const entries = Object.entries(labels)
    .map(([key, label]) => [label, counts[key] ?? 0]);

  return entries.map(([label, n]) =>
    el('div', { class: 'switch-row' },
      el('div', { class: 'switch-row__name', text: label }),
      el('div', { class: 'stat__value', style: 'font-size:18px', text: String(n) }),
    ),
  );
}

async function countAll() {
  const b = await backup.buildBackup();
  return b.counts;
}

async function doExport() {
  try {
    const filename = await backup.downloadBackup();
    toast(`Saved ${filename}`);
    await render(document.getElementById('view'));
  } catch (err) {
    console.error(err);
    toast('Export failed — try again');
  }
}

/* -------------------------------------------------------------- import */

async function handleFile(inputEl) {
  const file = inputEl.files?.[0];
  inputEl.value = '';                    // let the same file be re-picked later
  if (!file) return;

  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    toast("Couldn't read that file — is it the right one?");
    return;
  }

  const check = backup.validateBackup(parsed);
  if (!check.ok) { toast(check.error); return; }

  const total = backup.totalRows(check.backup);
  const when = check.backup.exportedAt
    ? fmtDateRelative(check.backup.exportedAt.slice(0, 10))
    : 'an unknown date';

  const ok = await confirmDialog({
    title: 'Replace everything?',
    body: `This backup holds ${total} record${total === 1 ? '' : 's'} from ${when}. `
        + 'Importing it wipes what is in the app now and puts this in its place.',
    confirmLabel: 'Replace all data',
    danger: true,
  });
  if (!ok) return;

  try {
    await backup.restoreBackup(check.backup);
    toast('Backup restored');
    await render(document.getElementById('view'));
  } catch (err) {
    console.error(err);
    toast('Restore failed — nothing was changed');
  }
}
