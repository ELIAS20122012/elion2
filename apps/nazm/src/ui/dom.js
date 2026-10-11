import { $$ } from '../core/util.js';

/** Bind delegated click / input / change / long-press handling on a view root.
 *  Markup opts in with data-act="name" (click), data-enter="name" (Enter key), data-input, data-change, data-hold. */
export function bindActions(root, { act = {}, input = {}, change = {}, hold = {} }) {
  let held = false;
  let timer;
  const target = (ev, attr) => {
    const el = ev.target.closest(`[${attr}]`);
    return el && root.contains(el) ? el : null;
  };

  root.addEventListener('click', (ev) => {
    if (held) { held = false; return; }
    const el = target(ev, 'data-act');
    if (!el) return;
    const fn = act[el.dataset.act];
    if (fn) fn(el, ev);
  });
  root.addEventListener('input', (ev) => {
    const el = target(ev, 'data-input');
    if (el && input[el.dataset.input]) input[el.dataset.input](el, ev);
  });
  root.addEventListener('change', (ev) => {
    const el = target(ev, 'data-change');
    if (el && change[el.dataset.change]) change[el.dataset.change](el, ev);
  });

  root.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing) return;
    const el = target(ev, 'data-enter');
    if (el && act[el.dataset.enter]) { ev.preventDefault(); act[el.dataset.enter](el, ev); }
  });

  const startHold = (ev) => {
    const el = target(ev, 'data-hold');
    held = false;
    if (!el || !hold[el.dataset.hold]) return;
    timer = setTimeout(() => { held = true; hold[el.dataset.hold](el, ev); }, 550);
  };
  const cancelHold = () => clearTimeout(timer);
  root.addEventListener('pointerdown', startHold);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((e) => root.addEventListener(e, cancelHold));
  root.addEventListener('contextmenu', (ev) => {
    const el = target(ev, 'data-hold');
    if (el && hold[el.dataset.hold]) { ev.preventDefault(); cancelHold(); held = true; hold[el.dataset.hold](el, ev); }
  });
  root.addEventListener('submit', (ev) => {
    const el = ev.target.closest('[data-submit]');
    if (el && act[el.dataset.submit]) { ev.preventDefault(); act[el.dataset.submit](el, ev); }
  });
}

/** Replace a root's HTML while keeping the caret in a focused `data-key` field. */
export function patchHTML(root, html) {
  const active = document.activeElement;
  const key = active && root.contains(active) ? active.getAttribute('data-key') : null;
  const sel = key && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  root.innerHTML = html;
  if (!key) return;
  const next = $$('[data-key]', root).find((el) => el.getAttribute('data-key') === key);
  if (!next) return;
  next.focus();
  if (sel) { try { next.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ } }
}

/** Scroll a freshly opened accordion card below the fixed header. */
export function scrollToCard(el) {
  if (!el) return;
  setTimeout(() => {
    const y = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }, 30);
}
