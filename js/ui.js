/* Shared bits of chrome: toasts, confirm dialogs, icons. */

import { el } from './util.js';

let toastTimer;

export function toast(message, ms = 2600) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.dataset.show = 'false'; }, ms);
}

/**
 * Show `inner` as a modal bottom sheet.
 *
 * Cleanup is explicit rather than hung off the dialog's `close` event: not
 * every engine fires `close` for a programmatic `close()` call, and a dialog
 * that closes without being removed leaves a detached node behind every time
 * you log a weight. `onDismiss` runs exactly once, however the sheet went away.
 *
 * @returns {{dialog: HTMLDialogElement, dismiss: () => void}}
 */
export function sheet(inner, onDismiss) {
  const dialog = el('dialog', { class: 'sheet' }, inner);
  let gone = false;

  const dismiss = () => {
    if (gone) return;
    gone = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    onDismiss?.();
  };

  // Escape key. preventDefault so there's a single path out, ours.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });

  document.body.append(dialog);
  dialog.showModal();
  return { dialog, dismiss };
}

/**
 * Native <dialog> confirm. Resolves true/false.
 * Used for destructive or overwriting actions — never for anything routine.
 */
export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;

    const inner = el('div', { class: 'sheet__inner' },
      el('div', { class: 'sheet__head' }, el('h2', { class: 'sheet__title', text: title })),
      body ? el('p', { class: 'hero__meta', text: body, style: 'margin:0' }) : null,
      el('div', { class: 'sheet__actions' },
        el('button', {
          class: `btn btn--block ${danger ? 'btn--danger' : 'btn--primary'}`,
          type: 'button',
          onclick: () => { answer = true; dismiss(); },
        }, confirmLabel),
        el('button', {
          class: 'btn btn--block btn--ghost',
          type: 'button',
          onclick: () => dismiss(),
        }, 'Cancel'),
      ),
    );

    const { dismiss } = sheet(inner, () => resolve(answer));
  });
}

export function icon(name) {
  const paths = {
    plus: 'M12 5v14M5 12h14',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    close: 'M6 6l12 12M18 6L6 18',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name]);
  svg.append(path);
  return svg;
}
