/* Savings: where money is kept and how much. Pure data logic — no DOM. */
import { S } from '../core/store.js';
import { uid } from '../core/util.js';
import { today } from '../core/dates.js';

export const list = () => S.savings;
export const findSaving = (id) => S.savings.find((x) => x.id === id);
export const total = () => S.savings.reduce((s, x) => s + x.amount, 0);

export function saveSaving(existing, { place, amount }) {
  const x = existing || { id: uid(), date: today() };
  Object.assign(x, { place, amount });
  if (!existing) S.savings.push(x);
  return x;
}

export function removeSaving(id) {
  const i = S.savings.findIndex((x) => x.id === id);
  return i < 0 ? null : { item: S.savings.splice(i, 1)[0], index: i };
}
