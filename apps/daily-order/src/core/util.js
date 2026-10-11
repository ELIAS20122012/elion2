export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const sum = (list, pick = (x) => x) => list.reduce((s, x) => s + pick(x), 0);
