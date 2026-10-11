/* The single source of truth: one JSON document persisted in localStorage.
   `S` is one stable object; replacing the document rewrites its contents in place. */
import { config } from './config.js';
import { seed, emptyState } from './seed.js';
import { fromLegacy } from './legacy.js';

export const STORAGE_KEY = 'daily-order-v2';

export const S = {};
let memFallback = null;
const listeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return memFallback; }
}

export function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch { memFallback = S; }
}

function syncConfig() {
  config.calendar = S.profile.calendar || 'gregorian';
  config.currency = S.profile.currency || '€';
  config.privacy = !!S.privacy;
}

/** Fill in fields that older saved documents don't have. */
export function migrate(state) {
  state.profile = state.profile || {};
  /* Dates are Gregorian now; documents saved before this switch are moved over once. */
  if (!state.profile.calendar || !state.ui || !state.ui.gregorian) state.profile.calendar = 'gregorian';
  state.profile.currency = state.profile.currency || '€';
  state.wallet = state.wallet || {};
  state.gym = state.gym || {};
  state.tasks = state.tasks || [];
  state.habits = state.habits || [];
  state.blocks = state.blocks || [];
  state.tx = state.tx || [];
  state.weekly = state.weekly || {};
  if (!state.monthly) state.monthly = fromLegacy(state); // loans/bills → plain monthly payments, once
  state.savings = state.savings || [];
  state.appointments = state.appointments || [];
  state.shopping = state.shopping || [];
  state.wallet.catBudgets = state.wallet.catBudgets || {};
  if (!state.accounts) {
    state.accounts = [
      { id: 'main', name: 'حساب بانکی', type: 'bank', opening: state.wallet.startBalance || 0 },
      { id: 'cash', name: 'کیف پول نقد', type: 'cash', opening: 0 },
    ];
  }
  /* UI memory used to live in several places; gather it under `ui`. */
  const ui = state.ui = state.ui || {};
  ui.gregorian = true;
  ui.open = ui.open || {};
  ui.sub = Object.assign({}, state.wallet.accSub, ui.tasksSub, ui.sub);
  if (ui.tasksOpen !== undefined && ui.open.tasks === undefined) ui.open.tasks = ui.tasksOpen;
  if (state.wallet.accOpen !== undefined && ui.open.wallet === undefined) ui.open.wallet = state.wallet.accOpen;
  delete ui.tasksOpen; delete ui.tasksSub; delete state.wallet.accOpen; delete state.wallet.accSub;
  state.tasks.forEach((t) => { if (!t.priority) t.priority = 'med'; });
  return state;
}

function setDocument(next) {
  Object.keys(S).forEach((k) => delete S[k]);
  Object.assign(S, migrate(next));
}

export function init() {
  const stored = read();
  setDocument(stored && stored.v ? stored : emptyState());
  syncConfig();
  save();
  return S;
}

/** Replace the whole document (import, reset, bfcache restore). */
export function replaceState(next) {
  setDocument(next);
  syncConfig();
  save();
  refresh();
}

export function resetToSample() {
  replaceState(seed());
}

export function clearAll() {
  const keep = { profile: S.profile };
  replaceState(Object.assign(emptyState(), keep));
}

export function reloadFromStorage() {
  const stored = read();
  if (stored && stored.v) replaceState(stored);
}

/* ---- change notification ---- */
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function refresh() {
  listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
}

/** Persist and re-render. Call after every mutation. */
export function commit() {
  syncConfig();
  save();
  refresh();
}

/** Persist without re-rendering (text being typed, background flags). */
export function persist() {
  syncConfig();
  save();
}
